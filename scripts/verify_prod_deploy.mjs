/**
 * Verifica despliegue en producción: Worker URL, cooldown 5 min, panel operativo,
 * filtros de dos niveles (59 instrumentos) y badge de confirmación Data912.
 * Uso: node scripts/verify_prod_deploy.mjs
 */
import { chromium } from "playwright";

const BASE = "https://pablopoletti.github.io/cotizaciones/";
const CONFIG_JS = `${BASE}js/config.js`;
const PANEL_TOTAL = 59;
const PANEL_VIGENTES = 57;

const FILTER_EXPECTATIONS = [
  { tipo: "todos", subtipo: null, count: PANEL_VIGENTES, label: "sin filtro (vigentes)" },
  { tipo: "on", subtipo: null, count: 25, label: "ON corporativa" },
  {
    tipo: "on",
    subtipo: "Telecomunicaciones",
    count: 4,
    tickers: ["TLCFO", "TLCMO", "TLCPO", "TLCTO"],
    label: "ON + sector Telecom",
  },
  {
    tipo: "on",
    subtipo: "Gas natural",
    count: 4,
    tickers: ["TSC3O", "TSC4O", "TTC9O", "TTCDO"],
    label: "ON + sector Gas natural",
  },
  { tipo: "Soberano USD", subtipo: null, count: 10, label: "Soberano USD" },
  { tipo: "Soberano ARS", subtipo: null, count: 11, label: "Soberano ARS" },
  { tipo: "Provincial", subtipo: null, count: 7, label: "Provincial" },
  { tipo: "BCRA", subtipo: null, count: 3, label: "BCRA" },
  { tipo: "CEDEAR", subtipo: null, count: 1, label: "CEDEAR" },
];

async function fetchConfigFromProd() {
  const res = await fetch(`${CONFIG_JS}?v=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar config.js: HTTP ${res.status}`);
  const text = await res.text();
  const cdMatch = text.match(/DISPATCH_COOLDOWN_MS:\s*(\d+)/);
  const urlMatch = text.match(/DISPATCH_WORKER_URL:\s*"([^"]*)"/);
  if (!cdMatch) throw new Error("DISPATCH_COOLDOWN_MS no encontrado en config.js de prod");
  return { cooldownMs: Number(cdMatch[1]), workerUrl: urlMatch?.[1] || "" };
}

async function openCotizacionesConFiltros(page) {
  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#sectores-container .inst-card", { timeout: 30000 });
  await page.click('button[data-tab="cotizaciones"]');
  await page.waitForTimeout(400);
  const filterPanel = page.locator("details.filter-panel");
  if (!(await filterPanel.evaluate((el) => el.open))) {
    await filterPanel.locator("summary").click();
  }
}

async function applyFilter(page, tipo, subtipo) {
  await page.selectOption("#filtro-tipo", tipo);
  await page.waitForTimeout(400);
  if (subtipo) {
    await page.waitForSelector("#filtro-subtipo-wrap:not(.hidden)", { timeout: 5000 });
    await page.selectOption("#filtro-subtipo", subtipo);
    await page.waitForTimeout(400);
  }
}

async function readVisibleCards(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll("#sectores-container .inst-card")];
    return {
      count: cards.length,
      tickers: cards.map((c) => c.dataset.ticker).filter(Boolean).sort(),
      miniKpi: document.querySelector(".kpi-chip strong")?.textContent?.trim(),
      tipoCambio: document.getElementById("tipo-cambio-meta")?.textContent?.trim() || "",
      confirmBadges: document.querySelectorAll(".badge--confirm").length,
    };
  });
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

async function verifyFiltersTwoLevel(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await openCotizacionesConFiltros(page);

  const results = [];
  for (const exp of FILTER_EXPECTATIONS) {
    await applyFilter(page, exp.tipo, exp.subtipo);
    const visible = await readVisibleCards(page);
    const tickersOk = exp.tickers
      ? exp.tickers.every((t) => visible.tickers.includes(t)) && visible.tickers.length === exp.count
      : visible.count === exp.count;
    results.push({
      ...exp,
      visible: visible.count,
      tickers: visible.tickers,
      ok: tickersOk && visible.count === exp.count,
    });
  }

  await applyFilter(page, "todos", null);
  const vencidosCheck = await page.evaluate(() => {
    const cb = document.getElementById("filtro-mostrar-vencidos");
    if (cb) cb.click();
    return document.querySelectorAll("#sectores-container .inst-card").length;
  });
  await page.waitForTimeout(400);

  const resumen = await page.evaluate(() => {
    const btn = document.querySelector('button[data-tab="resumen"]');
    btn?.click();
    return {
      conversionSection: !document.getElementById("seccion-conversion-ars")?.classList.contains("hidden"),
      conversionRows: document.querySelectorAll("#tabla-conversion-ars tbody tr").length,
    };
  });
  await page.waitForTimeout(500);
  const resumenAfter = await page.evaluate(() => ({
    conversionSection: !document.getElementById("seccion-conversion-ars")?.classList.contains("hidden"),
    conversionRows: document.querySelectorAll("#tabla-conversion-ars tbody tr").length,
    tipoCambio: document.getElementById("tipo-cambio-meta")?.textContent?.includes("/") ?? false,
  }));

  const allCards = await readVisibleCards(page);
  await page.close();

  return {
    results,
    allOk: results.every((r) => r.ok),
    vencidosVisible: vencidosCheck,
    vencidosOk: vencidosCheck === PANEL_TOTAL,
    resumenArsUsd: resumenAfter,
    confirmBadgesTotal: allCards.confirmBadges,
    tipoCambioHeaderOk: allCards.tipoCambio.includes("Oficial:") && allCards.tipoCambio.includes("MEP:"),
  };
}

async function verifyFichaFlow(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await openCotizacionesConFiltros(page);

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
    confirmBadge: !!document.querySelector(".ficha-hero__badges .badge--confirm"),
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

async function verifyWorkerCors(workerUrl) {
  const badPost = await fetch(workerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://otro-sitio.com" },
    body: "{}",
  });
  const badBody = await badPost.json().catch(() => ({}));
  const badPreflight = await fetch(workerUrl, {
    method: "OPTIONS",
    headers: { Origin: "https://otro-sitio.com", "Access-Control-Request-Method": "POST" },
  });
  return {
    postStatus: badPost.status,
    postError: badBody.error,
    preflightStatus: badPreflight.status,
    ok: badPost.status === 403 && badBody.error === "origin_not_allowed" && badPreflight.status === 403,
  };
}

async function verifyConteoDinamico(browser) {
  const page = await browser.newPage();
  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#sectores-container .inst-card", { timeout: 30000 });
  const texts = await page.evaluate(() => ({
    meta: document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
    historico: document.getElementById("historico-universo-count")?.textContent?.trim() || "",
  }));
  await page.close();
  const ok =
    texts.meta.includes("59 instrumentos") &&
    texts.meta.includes("57 vigentes") &&
    !texts.meta.includes("47 instrumentos") &&
    texts.historico.includes("59 instrumentos") &&
    texts.historico.includes("57 vigentes");
  return { ...texts, ok };
}

async function main() {
  const config = await fetchConfigFromProd();
  const workerCors = await verifyWorkerCors(config.workerUrl);
  const browser = await chromium.launch({ headless: true });
  const conteoDinamico = await verifyConteoDinamico(browser);
  const panel = await verifyPanel(browser);
  const filters = await verifyFiltersTwoLevel(browser);
  const fichaFlow = await verifyFichaFlow(browser);
  await browser.close();

  const checks = {
    url: BASE,
    workerUrl: config.workerUrl,
    cooldownMs: config.cooldownMs,
    cooldownOk: config.cooldownMs === 300000,
    workerUrlOk: config.workerUrl.includes("cotizaciones-dispatch.lic-poletti.workers.dev/dispatch"),
    workerCors,
    workerCorsOk: workerCors.ok,
    conteoDinamico,
    conteoDinamicoOk: conteoDinamico.ok,
    panelCardsOk: panel.cards === PANEL_VIGENTES,
    filtersTwoLevel: filters,
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
  if (!checks.workerCorsOk) {
    console.error("FAIL: Worker no rechaza Origin no autorizado", workerCors);
    process.exit(1);
  }
  if (!checks.conteoDinamicoOk) {
    console.error("FAIL: meta/disclaimer sin conteo dinámico 59/57", conteoDinamico);
    process.exit(1);
  }
  if (!checks.panelCardsOk) {
    console.error(`FAIL: se esperaban ${PANEL_VIGENTES} cards vigentes, obtuvo ${panel.cards}`);
    process.exit(1);
  }
  if (!filters.vencidosOk) {
    console.error(`FAIL: con «Mostrar vencidos» se esperaban ${PANEL_TOTAL}, obtuvo ${filters.vencidosVisible}`);
    process.exit(1);
  }
  if (!filters.allOk) {
    console.error("FAIL: filtros de dos niveles no coinciden con expectativas");
    filters.results.filter((r) => !r.ok).forEach((r) => console.error(`  - ${r.label}: esperado ${r.count}, visible ${r.visible}`, r.tickers));
    process.exit(1);
  }
  if (!filters.tipoCambioHeaderOk) {
    console.error("FAIL: header tipo de cambio sin formato compra/venta");
    process.exit(1);
  }
  if (!filters.resumenArsUsd.conversionSection || filters.resumenArsUsd.conversionRows < 5) {
    console.error("FAIL: tabla conversión ARS→USD ref. MEP ausente o incompleta en Resumen");
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

  console.log(
    `OK: prod con ${PANEL_VIGENTES} vigentes (${PANEL_TOTAL} con vencidos), filtros 2 niveles, DolarAPI, badge confirmación (${filters.confirmBadgesTotal} visibles).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
