/**
 * Mide tamaño de datos y tiempo de carga del panel (local o prod).
 * Uso: node scripts/measure_panel_perf.mjs [url]
 */
import { chromium } from "playwright";
import { statSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dir, "..", "docs", "data");
const BASE = process.argv[2] || "https://pablopoletti.github.io/cotizaciones/";

function fileKb(name) {
  const p = join(dataDir, name);
  return { name, kb: Math.round(statSync(p).size / 1024 * 10) / 10 };
}

async function measureLoad(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const t0 = Date.now();
  await page.goto(`${url}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 120000 });
  const networkIdleMs = Date.now() - t0;
  await page.waitForSelector("#sectores-container .inst-card", { timeout: 60000 });
  const cardsReadyMs = Date.now() - t0;
  const cards = await page.evaluate(() => document.querySelectorAll("#sectores-container .inst-card").length);
  const resources = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((r) => r.name.includes("/data/") || r.name.endsWith(".json"))
      .map((r) => ({
        name: r.name.split("/").pop()?.split("?")[0],
        durationMs: Math.round(r.duration),
        transferBytes: r.transferSize || 0,
      }))
  );
  await browser.close();
  return { networkIdleMs, cardsReadyMs, cards, resources };
}

async function main() {
  const files = ["cotizaciones.json", "historico_precios.json", "info_fija.json"].map(fileKb);
  const load = await measureLoad(BASE);
  console.log(JSON.stringify({ url: BASE, files, load, timestamp: new Date().toISOString() }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
