/**
 * Revisión local del panel ampliado (47 instrumentos).
 * Uso: node scripts/review_local.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const BASE = "http://localhost:8080/";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots", "review-local");
mkdirSync(OUT, { recursive: true });

async function reviewViewport(page, name, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  const load = await page.evaluate(() => ({
    count: document.querySelectorAll("#sectores-container .inst-card, #tabla-container tbody tr").length,
    cards: document.querySelectorAll("#sectores-container .inst-card").length,
    ultima: document.getElementById("ultima-actualizacion")?.textContent?.trim(),
    errores: document.querySelectorAll(".inst-card--error").length,
  }));

  // Filtro Provincial + USD (pestaña Cotizaciones)
  await page.click('button[data-tab="cotizaciones"]');
  await page.waitForTimeout(400);
  const filterPanel = page.locator("details.filter-panel");
  if (!(await filterPanel.evaluate((el) => el.open))) {
    await filterPanel.locator("summary").click();
  }
  await page.selectOption("#filtro-tipo", "Provincial");
  await page.selectOption("#filtro-moneda", "USD");
  await page.waitForTimeout(400);
  const filtroProvUsd = await page.evaluate(() => ({
    cards: document.querySelectorAll("#sectores-container .inst-card").length,
    tickers: [...document.querySelectorAll("#sectores-container .inst-card")].map(
      (c) => c.dataset.ticker
    ),
    miniKpi: document.getElementById("cotiz-mini-kpi")?.textContent?.replace(/\s+/g, " ").trim(),
  }));

  await page.selectOption("#filtro-tipo", "todos");
  await page.selectOption("#filtro-moneda", "todos");

  // Resumen
  await page.click('button[data-tab="resumen"]');
  await page.waitForTimeout(600);
  const resumen = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#resumen-kpis .kpi-card")].map((el) => ({
      label: el.querySelector("span")?.textContent?.trim(),
      value: el.querySelector("strong")?.textContent?.trim(),
      note: el.querySelector("small")?.textContent?.trim() || null,
    }));
    return { cards, count: cards.length };
  });
  await page.screenshot({ path: join(OUT, `${name}-resumen.png`), fullPage: true });

  // Análisis
  await page.click('button[data-tab="analisis"]');
  await page.waitForTimeout(2000);
  const analisis = await page.evaluate(() => {
    const bar = window.Chart?.getChart("chart-tir-barras");
    const scatter = window.Chart?.getChart("chart-scatter");
    return {
      barLabels: bar?.data?.labels?.length ?? 0,
      barCanvasH: document.getElementById("chart-tir-barras")?.parentElement?.offsetHeight,
      scatterPoints: scatter?.data?.datasets?.reduce((n, d) => n + d.data.length, 0) ?? 0,
      scatterCanvasH: document.getElementById("chart-scatter")?.parentElement?.offsetHeight,
    };
  });
  await page.screenshot({ path: join(OUT, `${name}-analisis.png`), fullPage: true });

  // Cotizaciones tabla
  await page.click('button[data-tab="cotizaciones"]');
  await page.waitForTimeout(400);
  await page.click("#btn-vista-tabla");
  await page.waitForTimeout(400);
  const tabla = await page.evaluate(() => ({
    filas: document.querySelectorAll("#tabla-container tbody tr").length,
  }));
  await page.screenshot({ path: join(OUT, `${name}-tabla.png`), fullPage: true });

  await page.click("#btn-vista-cards");
  await page.screenshot({ path: join(OUT, `${name}-cotiz-cards.png`), fullPage: true });

  return { load, filtroProvUsd, resumen, analisis, tabla };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const desktop = await reviewViewport(page, "desktop-1400", 1400, 900);
  const mobile = await reviewViewport(page, "mobile-375", 375, 812);

  const report = { desktop, mobile, timestamp: new Date().toISOString() };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
