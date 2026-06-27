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

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

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

  // Probar calculadora: asignar 100% al primer instrumento
  await page.click('button[data-tab="calculadora"]');
  await page.waitForTimeout(500);

  const calcInputs = page.locator("#calc-body .pct-input");
  const count = await calcInputs.count();
  if (count > 0) {
    await calcInputs.first().fill("100");
    await page.waitForTimeout(300);
  }

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
    checks,
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
