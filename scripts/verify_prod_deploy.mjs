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

  await page.locator("details.config-panel > summary").click();
  await page.waitForTimeout(300);

  const ui = await page.evaluate(() => {
    const btn = document.getElementById("btn-actualizar");
    return {
      actualizarVisible: !!btn,
      actualizarDisabled: btn?.disabled ?? null,
      cards: document.querySelectorAll("#sectores-container .inst-card").length,
      ultimaActualizacion: document.getElementById("ultima-actualizacion")?.textContent?.trim(),
      fichaShell: !!document.getElementById("ficha-instrumento"),
      fichaScript: typeof window.CotizFicha !== "undefined",
    };
  });

  await page.close();
  return ui;
}

async function verifyFichaFlow(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#sectores-container .inst-card", { timeout: 30000 });

  await page.click('button[data-tab="cotizaciones"]');
  await page.waitForTimeout(400);

  const filterPanel = page.locator("details.filter-panel");
  if (!(await filterPanel.evaluate((el) => el.open))) {
    await filterPanel.locator("summary").click();
  }

  await page.selectOption("#filtro-tipo", "Soberano USD");
  await page.selectOption("#filtro-moneda", "USD");
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => ({
    tipo: document.getElementById("filtro-tipo")?.value,
    moneda: document.getElementById("filtro-moneda")?.value,
    cards: document.querySelectorAll("#sectores-container .inst-card").length,
    firstTicker: document.querySelector("#sectores-container .inst-card")?.dataset?.ticker || null,
  }));

  if (!before.firstTicker) {
    await page.close();
    throw new Error("Sin cards visibles tras aplicar filtro Soberano USD + USD");
  }

  await page.click(`#sectores-container .inst-card[data-ticker="${before.firstTicker}"]`);
  await page.waitForSelector("#ficha-instrumento:not(.hidden)", { timeout: 15000 });

  const ficha = await page.evaluate(() => ({
    ticker: document.querySelector(".ficha-hero__ticker")?.textContent?.trim(),
    manualAlert: !!document.querySelector(".ficha-manual-alert")?.textContent?.includes("info_fija.json"),
    liveBadges: document.querySelectorAll(".ficha-badge--live").length,
    calcBadge: !!document.querySelector(".ficha-badge--calc"),
    filtrosActivos: document.getElementById("ficha-filtros-activos")?.textContent?.trim(),
    listaHidden: document.getElementById("cotiz-lista-view")?.classList.contains("hidden"),
  }));

  await page.click("#btn-ficha-volver");
  await page.waitForSelector("#cotiz-lista-view:not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    tipo: document.getElementById("filtro-tipo")?.value,
    moneda: document.getElementById("filtro-moneda")?.value,
    cards: document.querySelectorAll("#sectores-container .inst-card").length,
    fichaHidden: document.getElementById("ficha-instrumento")?.classList.contains("hidden"),
  }));

  await page.close();

  return {
    before,
    ficha,
    after,
    filtrosPreservados:
      after.tipo === before.tipo &&
      after.moneda === before.moneda &&
      after.cards === before.cards &&
      after.fichaHidden &&
      ficha.listaHidden,
    tickerCoincide: ficha.ticker === before.firstTicker,
    manualAlertOk: ficha.manualAlert,
    badgesOk: ficha.liveBadges >= 2 && ficha.calcBadge,
  };
}

async function main() {
  const config = await fetchConfigFromProd();
  const browser = await chromium.launch({ headless: true });
  const panel = await verifyPanel(browser);
  const fichaFlow = await verifyFichaFlow(browser);
  await browser.close();

  const checks = {
    url: BASE,
    workerUrl: config.workerUrl,
    cooldownMs: config.cooldownMs,
    cooldownOk: config.cooldownMs === 300000,
    workerUrlOk: config.workerUrl.includes("cotizaciones-dispatch.lic-poletti.workers.dev/dispatch"),
    panelCardsOk: panel.cards >= 47,
    fichaShellOk: panel.fichaShell && panel.fichaScript,
    fichaFlow,
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
    console.error(`FAIL: se esperaban al menos 47 cards, obtuvo ${panel.cards}`);
    process.exit(1);
  }
  if (!checks.fichaShellOk) {
    console.error("FAIL: ficha no cargada en prod (shell o CotizFicha ausente)");
    process.exit(1);
  }
  if (!fichaFlow.filtrosPreservados) {
    console.error("FAIL: filtros no preservados al volver de la ficha");
    process.exit(1);
  }
  if (!fichaFlow.tickerCoincide || !fichaFlow.manualAlertOk || !fichaFlow.badgesOk) {
    console.error("FAIL: flujo ficha incompleto o advertencias ausentes");
    process.exit(1);
  }

  console.log("OK: prod desplegado con cooldown 5 min, panel operativo y ficha verificada.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
