/**
 * Verificación visual del panel en navegador real (Playwright).
 * Uso: node scripts/verify_panel.mjs
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const URL = "https://pablopoletti.github.io/cotizaciones/";
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots");

const consoleErrors = [];
const consoleWarnings = [];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") consoleErrors.push(text);
    if (msg.type() === "warning") consoleWarnings.push(text);
  });
  page.on("pageerror", (err) => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  await page.goto(`${URL}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  // Configuración GitHub: botón Probar token visible y reacciona sin PAT
  await page.locator("details.config-panel summary").click();
  await page.waitForTimeout(300);
  const tokenUi = await page.evaluate(async () => {
    const btn = document.getElementById("btn-probar-token");
    const btnActualizar = document.getElementById("btn-actualizar");
    const status = document.getElementById("status-actualizar");
    if (!btn) return { probarTokenVisible: false, probarTokenWorks: false, actualizarVisible: !!btnActualizar };
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    const msg = status?.textContent?.trim() || "";
    return {
      probarTokenVisible: true,
      probarTokenWorks: msg.includes("PAT") || msg.includes("Token OK") || msg.includes("token"),
      statusAfterClick: msg,
      actualizarVisible: !!btnActualizar,
    };
  });

  const checks = await page.evaluate(() => {
    const ultima = document.getElementById("ultima-actualizacion")?.textContent?.trim();
    const loading = document.getElementById("loading");
    const banner = document.getElementById("alerta-fetch-status");
    const sectores = document.querySelectorAll("#sectores-container .sector");
    const filas = document.querySelectorAll("#sectores-container tbody tr");
    const etiquetasCierre = document.querySelectorAll(".precio-ref");
    const calcFilas = document.querySelectorAll("#calc-body tr");
    const tirPond = document.getElementById("tir-ponderada")?.textContent?.trim();

    return {
      ultimaActualizacion: ultima,
      loadingVisible: loading ? !loading.classList.contains("hidden") : null,
      loadingText: loading?.textContent?.trim(),
      bannerVisible: banner ? !banner.classList.contains("hidden") : false,
      bannerText: banner?.textContent?.trim(),
      bannerClass: banner?.className,
      numSectores: sectores.length,
      numCards: document.querySelectorAll("#sectores-container .inst-card").length,
      numFilasTabla: filas.length,
      numEtiquetasCierre: etiquetasCierre.length,
      numFilasCalculadora: calcFilas.length,
      tirPonderada: tirPond,
      titulo: document.title,
    };
  });

  await page.screenshot({
    path: join(OUT_DIR, "panel-cotizaciones-tabla.png"),
    fullPage: true,
  });

  // Filtros Provincial + USD
  await page.click('button[data-tab="cotizaciones"]');
  await page.waitForTimeout(400);
  const filterPanel = page.locator("details.filter-panel");
  if (!(await filterPanel.evaluate((el) => el.open))) {
    await filterPanel.locator("summary").click();
  }
  await page.selectOption("#filtro-tipo", "Provincial");
  await page.selectOption("#filtro-moneda", "USD");
  await page.waitForTimeout(400);
  const filterProvUsd = await page.evaluate(() => ({
    cards: document.querySelectorAll("#sectores-container .inst-card").length,
    tickers: [...document.querySelectorAll("#sectores-container .inst-card")].map((c) => c.dataset.ticker),
  }));
  await page.selectOption("#filtro-tipo", "todos");
  await page.selectOption("#filtro-moneda", "todos");

  // Resumen KPIs por moneda
  await page.click('button[data-tab="resumen"]');
  await page.waitForTimeout(600);
  const resumenMoneda = await page.evaluate(() => ({
    kpiCards: document.querySelectorAll("#resumen-kpis .kpi-card").length,
    monedaKpis: [...document.querySelectorAll("#resumen-kpis .kpi-card--moneda")].map((el) => ({
      label: el.querySelector("span")?.textContent?.trim(),
      value: el.querySelector("strong")?.textContent?.trim(),
    })),
  }));

  // Probar calculadora: asignar 100% al primer instrumento
  await page.click('button[data-tab="calculadora"]');
  await page.waitForTimeout(500);

  const calcInputs = page.locator("#calc-body .pct-input");
  const count = await calcInputs.count();
  if (count > 0) {
    await calcInputs.first().fill("100");
    await page.waitForTimeout(300);
  }

  // Probar lógica de TIR con valores de prueba inyectados (sin modificar info_fija.json)
  await page.evaluate(() => {
    const inputs = document.querySelectorAll("#calc-body .pct-input");
    if (inputs.length >= 2) {
      inputs[0].value = "60";
      inputs[0].dataset.tir = "8.5";
      inputs[1].value = "40";
      inputs[1].dataset.tir = "10.0";
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.waitForTimeout(300);

  const calcResult = await page.evaluate(() => ({
    sumaPct: document.getElementById("suma-porcentajes")?.textContent?.trim(),
    tirPond: document.getElementById("tir-ponderada")?.textContent?.trim(),
    renta: document.getElementById("renta-anual")?.textContent?.trim(),
    filasCalc: document.querySelectorAll("#calc-body tr").length,
    calcWarning: document.getElementById("calc-warning")?.textContent?.trim(),
  }));

  await page.screenshot({
    path: join(OUT_DIR, "panel-calculadora-tab.png"),
    fullPage: true,
  });

  const report = {
    url: URL,
    tokenUi,
    checks,
    filterProvUsd,
    resumenMoneda,
    calcResult,
    consoleErrors,
    consoleWarnings,
    timestamp: new Date().toISOString(),
  };

  writeFileSync(join(OUT_DIR, "verify-report.json"), JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
