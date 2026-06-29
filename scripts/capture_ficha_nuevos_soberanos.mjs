/**
 * Capturas ficha AO27, AO28, AN29 — TIR, duración, próximo cupón.
 * Uso: node scripts/capture_ficha_nuevos_soberanos.mjs
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

async function extractFicha(page) {
  return page.evaluate(() => {
    const mercado = [...document.querySelectorAll(".ficha-section")].find((s) =>
      s.querySelector("h2")?.textContent?.includes("Mercado")
    );
    const sens = document.querySelector(".ficha-subsection--sensibilidad");
    const tirKpi = mercado?.querySelector(".ficha-kpi:nth-child(3) strong")?.textContent?.trim() || "";
    const tirLabel = mercado?.querySelector(".ficha-kpi:nth-child(3) .label")?.textContent?.trim() || "";
    const ytm = sens?.querySelector(".ficha-kpi strong")?.textContent?.trim() || "";
    const dur = sens?.querySelectorAll(".ficha-kpi strong")?.[1]?.textContent?.trim() || "";
    const plazos = [...document.querySelectorAll(".ficha-section--calc .ficha-kpi")];
    const proxKpi = plazos.find((k) => k.querySelector(".label")?.textContent?.includes("Próximo"));
    const proxTxt = proxKpi?.querySelector("strong")?.textContent?.trim() || "";
    const proxMeta = proxKpi?.querySelector(".meta")?.textContent?.trim() || "";
    return { tirLabel, tirMercado: tirKpi, ytm, duracion: dur, proximoCupon: proxTxt, proxMeta };
  });
}

async function captureFicha(page, base, ticker) {
  await page.goto(`${base}/?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#sectores-container .inst-card", { timeout: 30000 });
  await page.click(`button[data-ficha-ticker="${ticker}"]`);
  await page.waitForSelector("#ficha-instrumento:not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(900);
  const meta = await extractFicha(page);
  const filename = `ficha-${ticker}-nuevo.png`;
  await page.screenshot({ path: join(OUT, filename), fullPage: true });
  return { ...meta, screenshot: filename };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const port = 9878;
  const server = await startServer(port);
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const result = {};
  for (const ticker of ["AO27", "AO28", "AN29"]) {
    result[ticker] = await captureFicha(page, base, ticker);
    if (ticker !== "AN29") {
      await page.click("#btn-ficha-volver");
      await page.waitForSelector("#cotiz-lista-view:not(.hidden)");
    }
  }

  await browser.close();
  server.close();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
