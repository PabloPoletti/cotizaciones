/**
 * Verifica despliegue en producción: Worker URL, cooldown 5 min, panel operativo.
 * Uso: node scripts/verify_prod_deploy.mjs
 */
import { chromium } from "playwright";

const BASE = "https://pablopoletti.github.io/cotizaciones/";
const CONFIG_JS = `${BASE}js/config.js`;

async function fetchConfigFromProd() {
  const res = await fetch(`${CONFIG_JS}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar config.js: HTTP ${res.status}`);
  const text = await res.text();
  const cdMatch = text.match(/DISPATCH_COOLDOWN_MS:\s*(\d+)/);
  const urlMatch = text.match(/DISPATCH_WORKER_URL:\s*"([^"]*)"/);
  if (!cdMatch) throw new Error("DISPATCH_COOLDOWN_MS no encontrado en config.js de prod");
  return { cooldownMs: Number(cdMatch[1]), workerUrl: urlMatch?.[1] || "" };
}

async function verifyPanel(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);

  await page.locator("details.config-panel").first().locator("summary").click();
  await page.waitForTimeout(300);

  const ui = await page.evaluate(() => {
    const btn = document.getElementById("btn-actualizar");
    const status = document.getElementById("status-actualizar");
    return {
      actualizarVisible: !!btn,
      actualizarDisabled: btn?.disabled ?? null,
      cards: document.querySelectorAll("#sectores-container .inst-card").length,
      ultimaActualizacion: document.getElementById("ultima-actualizacion")?.textContent?.trim(),
    };
  });

  await page.close();
  return ui;
}

async function main() {
  const config = await fetchConfigFromProd();
  const browser = await chromium.launch({ headless: true });
  const panel = await verifyPanel(browser);
  await browser.close();

  const checks = {
    url: BASE,
    workerUrl: config.workerUrl,
    cooldownMs: config.cooldownMs,
    cooldownOk: config.cooldownMs === 300000,
    workerUrlOk: config.workerUrl.includes("cotizaciones-dispatch.lic-poletti.workers.dev/dispatch"),
    panelCardsOk: panel.cards === 47,
    panel,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(checks, null, 2));

  if (!checks.cooldownOk) {
    console.error(`FAIL: cooldown esperado 300000, obtuvo ${config.cooldownMs}`);
    process.exit(1);
  }
  if (!checks.workerUrlOk) {
    console.error(`FAIL: worker URL en prod no coincide: ${config.workerUrl}`);
    process.exit(1);
  }
  if (!checks.panelCardsOk) {
    console.error(`FAIL: se esperaban 47 cards, obtuvo ${panel.cards}`);
    process.exit(1);
  }

  console.log("OK: prod desplegado con cooldown 5 min y panel operativo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
