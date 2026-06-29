/**
 * Capturas de los 3 gráficos de Análisis (TIR barras, curva, drawdown).
 * Uso: node scripts/capture_chart_padding.mjs [--tag before|after]
 */
import { chromium } from "playwright";
import { mkdirSync, createReadStream, statSync } from "fs";
import { createServer } from "http";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const tag = process.argv.includes("--tag")
  ? process.argv[process.argv.indexOf("--tag") + 1]
  : "after";
const OUT = join(ROOT, "docs", "screenshots", "chart-padding", tag);
const PORT = Number(process.env.CAPTURE_PORT) || 0;

function serveStatic(root) {
  return createServer((req, res) => {
    let path = join(root, (req.url || "/").split("?")[0].replace(/^\//, "") || "index.html");
    if (path.endsWith("/")) path += "index.html";
    try {
      statSync(path);
    } catch {
      res.writeHead(404);
      res.end("404");
      return;
    }
    res.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/html" });
    createReadStream(path).pipe(res);
  });
}

async function shot(page, selector, name) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(600);
  await el.screenshot({ path: join(OUT, name) });
  console.log("OK", join(OUT, name));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = serveStatic(DOCS);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  await page.goto(`http://127.0.0.1:${port}/?v=${Date.now()}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForSelector("#loading.hidden, .inst-card", { timeout: 30000 }).catch(() => {});
  await page.click('button[data-tab="analisis"]');
  await page.waitForTimeout(2500);

  await shot(page, ".chart-card--tir-barras", "01-tir-barras.png");

  const canvas = page.locator("#chart-tir-barras");
  const cbox = await canvas.boundingBox();
  if (cbox) {
    await page.mouse.move(cbox.x + cbox.width * 0.72, cbox.y + cbox.height * 0.08);
    await page.waitForTimeout(400);
    await shot(page, ".chart-card--tir-barras", "01-tir-barras-tooltip.png");
  }

  await shot(page, ".chart-card:has(#chart-scatter)", "02-curva-tir-plazo.png");

  const sel = page.locator("#historico-ticker-select");
  if (await sel.count()) {
    await sel.selectOption({ index: 0 });
    await page.waitForTimeout(800);
  }
  await shot(page, "#drawdown-chart-wrap", "03-drawdown.png");

  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
