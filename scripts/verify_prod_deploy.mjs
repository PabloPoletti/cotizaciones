/**
 * Verifica despliegue en producción: cooldown 90s, panel operativo.
 * Uso: node scripts/verify_prod_deploy.mjs
 */
import { chromium } from "playwright";

const BASE = "https://pablopoletti.github.io/cotizaciones/";
const APP_JS = `${BASE}js/app.js`;

async function fetchAppJsCooldown() {
  const res = await fetch(`${APP_JS}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar app.js: HTTP ${res.status}`);
  const text = await res.text();
  const match = text.match(/DISPATCH_COOLDOWN_MS\s*=\s*(\d+)/);
  if (!match) throw new Error("DISPATCH_COOLDOWN_MS no encontrado en app.js de prod");
  return Number(match[1]);
}

async function verifyPanel(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);

  await page.locator("details.config-panel summary").click();
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
  const cooldownMs = await fetchAppJsCooldown();
  const browser = await chromium.launch({ headless: true });
  const panel = await verifyPanel(browser);
  await browser.close();

  const checks = {
    url: BASE,
    cooldownMs,
    cooldownOk: cooldownMs === 90000,
    panelCardsOk: panel.cards === 47,
    panel,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(checks, null, 2));

  if (!checks.cooldownOk) {
    console.error(`FAIL: cooldown esperado 90000, obtuvo ${cooldownMs}`);
    process.exit(1);
  }
  if (!checks.panelCardsOk) {
    console.error(`FAIL: se esperaban 47 cards, obtuvo ${panel.cards}`);
    process.exit(1);
  }

  console.log("OK: prod desplegado con cooldown 90s y panel operativo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
