/**
 * Cloudflare Worker: dispara workflow_dispatch de GitHub sin exponer el PAT al navegador.
 * Rate limit: 1 dispatch exitoso cada RATE_LIMIT_SECONDS (default 300).
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || (url.pathname !== "/dispatch" && url.pathname !== "/")) {
      return jsonResponse({ error: "Usá POST /dispatch" }, 404);
    }

    if (!env.GITHUB_TOKEN) {
      return jsonResponse({ error: "Worker sin GITHUB_TOKEN configurado" }, 500);
    }

    const rateLimit = parseInt(env.RATE_LIMIT_SECONDS || "300", 10);
    const kv = env.RATE_LIMIT_KV;
    const now = Math.floor(Date.now() / 1000);

    if (kv) {
      const lastRaw = await kv.get("last_dispatch_ok");
      if (lastRaw) {
        const elapsed = now - parseInt(lastRaw, 10);
        if (elapsed < rateLimit) {
          const wait = rateLimit - elapsed;
          return jsonResponse(
            {
              message: `Esperá ${wait}s antes de volver a actualizar (límite del servidor).`,
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
      return jsonResponse({ error: "dispatch_failed", message }, ghResp.status >= 500 ? 502 : ghResp.status);
    }

    if (kv) {
      await kv.put("last_dispatch_ok", String(now));
    }

    return jsonResponse({
      ok: true,
      message: "Workflow iniciado. Recargá el panel en unos minutos.",
    });
  },
};
