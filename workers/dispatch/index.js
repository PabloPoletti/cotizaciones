/**
 * Cloudflare Worker: dispara workflow_dispatch de GitHub sin exponer el PAT al navegador.
 * Rate limit: 1 dispatch exitoso cada RATE_LIMIT_SECONDS (default 300) por IP de origen.
 */

const ALLOWED_ORIGIN = "https://pablopoletti.github.io";

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (origin !== ALLOWED_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    Vary: "Origin",
  };
}

function jsonResponse(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      if (!cors["Access-Control-Allow-Origin"]) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || (url.pathname !== "/dispatch" && url.pathname !== "/")) {
      return jsonResponse(request, { error: "Usá POST /dispatch" }, 404);
    }

    const origin = request.headers.get("Origin");
    if (origin !== ALLOWED_ORIGIN) {
      return jsonResponse(request, { error: "origin_not_allowed" }, 403);
    }

    if (!env.GITHUB_TOKEN) {
      return jsonResponse(request, { error: "Worker sin GITHUB_TOKEN configurado" }, 500);
    }

    const rateLimit = parseInt(env.RATE_LIMIT_SECONDS || "300", 10);
    const kv = env.RATE_LIMIT_KV;
    const now = Math.floor(Date.now() / 1000);
    const ip = clientIp(request);
    const ipKey = `last_dispatch_ok:${ip}`;

    if (kv) {
      const lastRaw = await kv.get(ipKey);
      if (lastRaw) {
        const elapsed = now - parseInt(lastRaw, 10);
        if (elapsed < rateLimit) {
          const wait = rateLimit - elapsed;
          return jsonResponse(
            request,
            {
              message: `Esperá ${wait}s antes de volver a actualizar (límite por IP).`,
              retry_after_seconds: wait,
            },
            429
          );
        }
      }
    }

    const owner = env.GITHUB_OWNER || "PabloPoletti";
    const repo = env.GITHUB_REPO || "cotizaciones";
    const workflow = env.GITHUB_WORKFLOW || "actualizar.yml";

    const ghResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "cotizaciones-dispatch-worker",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (ghResp.status !== 204) {
      let message = `GitHub respondió HTTP ${ghResp.status}`;
      try {
        const err = await ghResp.json();
        if (err.message) message = err.message;
      } catch {
        const text = await ghResp.text();
        if (text) message = text.slice(0, 280);
      }
      return jsonResponse(
        request,
        { error: "dispatch_failed", message },
        ghResp.status >= 500 ? 502 : ghResp.status
      );
    }

    if (kv) {
      await kv.put(ipKey, String(now));
    }

    return jsonResponse(request, {
      ok: true,
      message: "Workflow iniciado. Recargá el panel en unos minutos.",
    });
  },
};
