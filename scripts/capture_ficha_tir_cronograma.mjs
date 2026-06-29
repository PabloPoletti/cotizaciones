/**
 * Capturas ficha Mercado y rendimiento — bonos canje 2020 (GD38, AL30).
 * Uso: node scripts/capture_ficha_tir_cronograma.mjs [suffix]
 * suffix: ej. "antes" | "despues" → ficha-GD38-{suffix}.png
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { extname } from "path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots");
const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

function startServer(port) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let p = req.url.split("?")[0];
      if (p === "/") p = "/index.html";
      const file = join(DOCS, p.replace(/^\//, ""));
      if (!existsSync(file)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      res.end(readFileSync(file));
    });
    server.listen(port, () => resolve(server));
  });
}

async function extractMercado(page) {
  return page.evaluate(() => {
    const sections = [...document.querySelectorAll(".ficha-section")];
    const mercado = sections.find((s) => s.querySelector("h2")?.textContent?.includes("Mercado"));
    const riesgo = sections.find((s) => s.querySelector("h2")?.textContent?.includes("Riesgo"));
    const sens = document.querySelector(".ficha-subsection--sensibilidad");
    const tirKpi = mercado?.querySelector(".ficha-kpi:nth-child(3) strong")?.textContent?.trim() || "";
    const ytmKpi = sens?.querySelector(".ficha-kpi strong")?.textContent?.trim() || "";
    return { tirMercado: tirKpi, ytmSensibilidad: ytmKpi, riesgoHead: riesgo?.querySelector("h2")?.textContent || "" };
  });
}

async function captureFicha(page, base, ticker, filename) {
  await page.goto(`${base}/?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#sectores-container .inst-card", { timeout: 30000 });
  await page.click(`button[data-ficha-ticker="${ticker}"]`);
  await page.waitForSelector("#ficha-instrumento:not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(900);
  const meta = await extractMercado(page);
  await page.screenshot({ path: join(OUT, filename), fullPage: true });
  return meta;
}

async function main() {
  const suffix = process.argv[2] || "captura";
  mkdirSync(OUT, { recursive: true });
  const port = 9877;
  const server = await startServer(port);
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const gd38 = await captureFicha(page, base, "GD38", `ficha-GD38-${suffix}.png`);
  await page.click("#btn-ficha-volver");
  await page.waitForSelector("#cotiz-lista-view:not(.hidden)");
  const al30 = await captureFicha(page, base, "AL30", `ficha-AL30-${suffix}.png`);

  await browser.close();
  server.close();

  console.log(JSON.stringify({ suffix, gd38, al30 }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
