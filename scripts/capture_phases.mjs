/**
 * Capturas por fase del panel (Playwright).
 * Uso local:  node scripts/capture_phases.mjs
 * Producción: node scripts/capture_phases.mjs --prod
 * URL custom:  PANEL_URL=https://... node scripts/capture_phases.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const PROD_URL = "https://pablopoletti.github.io/cotizaciones/";
const LOCAL_URL = "http://localhost:8765/";
const isProd = process.argv.includes("--prod");
const BASE = process.env.PANEL_URL || (isProd ? PROD_URL : LOCAL_URL);
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "screenshots",
  isProd || process.env.PANEL_URL?.includes("github.io") ? "fases-prod" : "fases"
);

const phases = [
  { id: "A-cotizaciones-cards", tab: "cotizaciones", wait: 2000 },
  { id: "A-cotizaciones-tabla", tab: "cotizaciones", action: "tabla", wait: 800 },
  { id: "B-analisis", tab: "analisis", wait: 2500 },
  { id: "C-resumen", tab: "resumen", wait: 1000 },
  { id: "D-calculadora", tab: "calculadora", action: "calc", wait: 1500 },
  { id: "E-observaciones", tab: "observaciones", wait: 1000 },
];

async function captureHistoricoEmpty(page, outDir) {
  await page.evaluate(() => {
    localStorage.removeItem("cotizaciones_historico_local_v1");
  });
  await page.click('button[data-tab="analisis"]');
  await page.waitForTimeout(800);
  const check = await page.evaluate(() => {
    const empty = document.getElementById("historico-empty");
    const meta = document.getElementById("historico-meta")?.textContent?.trim() || "";
    return {
      emptyVisible: empty ? !empty.classList.contains("hidden") : false,
      meta,
      chartHidden: document.getElementById("historico-chart-wrap")?.classList.contains("hidden"),
    };
  });
  await page.screenshot({
    path: join(outDir, "B-analisis-historico-vacio.png"),
    fullPage: true,
  });
  console.log("OK B-analisis-historico-vacio.png", check);
  return check;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  console.log("BASE URL:", BASE);
  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector(".inst-card, #sectores-container .sector, #loading.hidden", {
    timeout: 30000,
  }).catch(() => {});

  const emptyCheck = await captureHistoricoEmpty(page, OUT);
  if (!emptyCheck.emptyVisible || !emptyCheck.meta.includes("Sin historial todavía")) {
    errors.push(`Historico vacío: emptyVisible=${emptyCheck.emptyVisible}, meta=${emptyCheck.meta}`);
  }

  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector(".inst-card", { timeout: 30000 }).catch(() => {});

  for (const phase of phases) {
    if (phase.tab !== "cotizaciones") {
      await page.click(`button[data-tab="${phase.tab}"]`);
      await page.waitForTimeout(400);
    }
    if (phase.action === "tabla") {
      await page.click("#btn-vista-tabla");
      await page.waitForTimeout(300);
    }
    if (phase.action === "calc") {
      await page.selectOption("#preset-cartera", "balanceado");
      await page.click("#btn-aplicar-preset");
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(phase.wait);
    await page.screenshot({
      path: join(OUT, `${phase.id}.png`),
      fullPage: true,
    });
    console.log(`OK ${phase.id}.png`);
  }

  const assetCheck = await page.evaluate(async () => {
    const checks = {};
    for (const path of [
      "data/cotizaciones.json",
      "data/info_fija.json",
      "data/historico.json",
      "js/core.js",
    ]) {
      try {
        const r = await fetch(path, { cache: "no-store" });
        checks[path] = r.status;
      } catch {
        checks[path] = "error";
      }
    }
    return checks;
  });
  console.log("asset HTTP:", assetCheck);

  console.log("errors:", errors.length ? errors : "none");
  await browser.close();
  if (errors.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
