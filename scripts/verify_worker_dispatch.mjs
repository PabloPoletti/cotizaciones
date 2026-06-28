/**
 * Verifica Worker dispatch, cooldown 5 min y UI en producción.
 * Uso: node scripts/verify_worker_dispatch.mjs
 */
import { chromium } from "playwright";
import { execSync } from "child_process";

const BASE = "https://pablopoletti.github.io/cotizaciones/";
const WORKER_URL = "https://cotizaciones-dispatch.lic-poletti.workers.dev/dispatch";
const EXPECTED_COOLDOWN = 300000;

async function fetchConfigFromProd() {
  const res = await fetch(`${BASE}js/config.js?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`config.js HTTP ${res.status}`);
  const text = await res.text();
  const urlMatch = text.match(/DISPATCH_WORKER_URL:\s*"([^"]+)"/);
  const cdMatch = text.match(/DISPATCH_COOLDOWN_MS:\s*(\d+)/);
  return {
    workerUrl: urlMatch?.[1] || "",
    cooldownMs: cdMatch ? Number(cdMatch[1]) : null,
  };
}

function latestWorkflowRunBefore() {
  try {
    const out = execSync(
      'gh run list --workflow=actualizar.yml --limit 1 --json databaseId,status,conclusion,createdAt,event',
      { encoding: "utf8", cwd: process.cwd() }
    );
    return JSON.parse(out)[0] || null;
  } catch {
    return null;
  }
}

async function main() {
  const configProd = await fetchConfigFromProd();
  const runBefore = latestWorkflowRunBefore();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const networkRequests = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("workers.dev") || u.includes("api.github.com")) {
      networkRequests.push({ url: u, method: req.method() });
    }
  });

  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2000);

  const uiBeforeClick = await page.evaluate(() => {
    const mainPanel = document.querySelector("details.config-panel");
    const advanced = document.querySelector("details.config-panel__advanced");
    const cfg = window.CotizConfig || {};
    return {
      mainPanelOpen: mainPanel?.open ?? null,
      advancedOpen: advanced?.open ?? null,
      advancedExists: !!advanced,
      workerUrlInConfig: cfg.DISPATCH_WORKER_URL || "",
      cooldownMs: cfg.DISPATCH_COOLDOWN_MS || null,
    };
  });

  await page.click("#btn-actualizar");
  await page.waitForTimeout(4000);

  const afterClick = await page.evaluate(() => ({
    statusText: document.getElementById("status-actualizar")?.textContent?.trim() || "",
    btnDisabled: document.getElementById("btn-actualizar")?.disabled ?? null,
  }));

  await browser.close();

  await new Promise((r) => setTimeout(r, 8000));
  const runAfter = latestWorkflowRunBefore();

  const workerCalls = networkRequests.filter((r) => r.url.includes("workers.dev/dispatch"));
  const githubApiCalls = networkRequests.filter(
    (r) => r.url.includes("api.github.com") && r.method === "POST"
  );

  const workflowStarted =
    runAfter &&
    runBefore &&
    (runAfter.databaseId !== runBefore.databaseId ||
      (runAfter.status === "in_progress" || runAfter.status === "queued" || runAfter.status === "pending"));

  const report = {
    timestamp: new Date().toISOString(),
    configProd,
    configOk:
      configProd.workerUrl === WORKER_URL && configProd.cooldownMs === EXPECTED_COOLDOWN,
    uiBeforeClick,
    uiOk:
      uiBeforeClick.advancedExists &&
      uiBeforeClick.advancedOpen === false &&
      uiBeforeClick.workerUrlInConfig === WORKER_URL &&
      uiBeforeClick.cooldownMs === EXPECTED_COOLDOWN,
    networkRequests,
    workerCalls,
    githubApiCalls,
    dispatchOk: workerCalls.some((r) => r.method === "POST" && r.url.startsWith(WORKER_URL)),
    noDirectGithubDispatch: githubApiCalls.length === 0,
    afterClick,
    messageOk: /workflow iniciado/i.test(afterClick.statusText),
    runBefore: runBefore
      ? { id: runBefore.databaseId, status: runBefore.status, createdAt: runBefore.createdAt }
      : null,
    runAfter: runAfter
      ? { id: runAfter.databaseId, status: runAfter.status, createdAt: runAfter.createdAt }
      : null,
    workflowNewRun: workflowStarted,
  };

  report.allOk =
    report.configOk &&
    report.uiOk &&
    report.dispatchOk &&
    report.noDirectGithubDispatch &&
    report.messageOk &&
    report.workflowNewRun;

  console.log(JSON.stringify(report, null, 2));

  if (!report.allOk) {
    console.error("FAIL: verificación incompleta — ver reporte arriba.");
    process.exit(1);
  }
  console.log("OK: Worker conectado, UI correcta, dispatch verificado en Actions.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
