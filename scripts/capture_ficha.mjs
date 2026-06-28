/**
 * Capturas de ficha de instrumento (local o prod).
 * Uso: node scripts/capture_ficha.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
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

async function captureFicha(page, base, ticker, filename) {
  await page.goto(`${base}/?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#sectores-container .inst-card", { timeout: 30000 });
  await page.click(`button[data-ficha-ticker="${ticker}"]`);
  await page.waitForSelector("#ficha-instrumento:not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(800);
  const checks = await page.evaluate((t) => {
    const manual = document.querySelector(".ficha-manual-alert")?.textContent?.trim() || "";
    const estimado = document.querySelector(".ficha-estimado")?.textContent?.trim() || "";
    const live = document.querySelector(".ficha-badge--live")?.textContent?.trim() || "";
    return { ticker: t, manual: manual.slice(0, 120), estimado, liveBadges: document.querySelectorAll(".ficha-badge--live").length };
  }, ticker);
  await page.screenshot({ path: join(OUT, filename), fullPage: true });
  return checks;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const port = 9876;
  const server = await startServer(port);
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const al30 = await captureFicha(page, base, "AL30", "ficha-AL30-bullet.png");
  await page.click("#btn-ficha-volver");
  await page.waitForSelector("#cotiz-lista-view:not(.hidden)");
  const ymcio = await captureFicha(page, base, "YMCIO", "ficha-YMCIO-parcial.png");

  await browser.close();
  server.close();

  console.log(JSON.stringify({ al30, ymcio, screenshots: ["ficha-AL30-bullet.png", "ficha-YMCIO-parcial.png"] }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
