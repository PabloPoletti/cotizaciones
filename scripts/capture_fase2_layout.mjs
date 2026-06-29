/**
 * Capturas de layout por pestaña (desktop + mobile).
 * Uso: node scripts/capture_fase2_layout.mjs [cotiz|analisis|resumen|calc|obs|tabla|all]
 */
import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdir } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = join(__dirname, "../docs");
const OUT = join(__dirname, "out");
const arg = process.argv[2] || "all";

function serveDocs(port) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let path = req.url?.split("?")[0] || "/";
      if (path === "/") path = "/index.html";
      const file = join(DOCS, path.replace(/^\//, "").replace(/\.\./g, ""));
      try {
        const body = readFileSync(file);
        const ext = file.split(".").pop();
        const types = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml" };
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(port, () => resolve(server));
  });
}

async function loadPanel(page, tab) {
  await page.click(`button[data-tab="${tab}"]`);
  await page.waitForTimeout(600);
}

async function shot(browser, base, name, setup) {
  const files = [];
  for (const suffix of ["desktop", "mobile"]) {
    const page = await browser.newPage({
      viewport: { width: suffix === "mobile" ? 390 : 1400, height: suffix === "mobile" ? 844 : 900 },
    });
    await page.goto(base, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector(".inst-card, #panel-resumen", { timeout: 30000 });
    const locator = await setup(page);
    const file = join(OUT, `fase2_${name}_${suffix}.png`);
    await locator.screenshot({ path: file });
    files.push(`scripts/out/fase2_${name}_${suffix}.png`);
    await page.close();
  }
  return files;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await serveDocs(8779);
  const base = `http://127.0.0.1:8779/`;
  const browser = await chromium.launch({ headless: true });
  const shots = [];

  if (arg === "all" || arg === "cotiz") {
    shots.push(
      ...(await shot(browser, base, "cotiz_cards", async (page) => {
        await loadPanel(page, "cotizaciones");
        await page.waitForSelector(".sector", { timeout: 15000 });
        return page.locator("#panel-cotizaciones");
      }))
    );
  }

  if (arg === "all" || arg === "tabla") {
    shots.push(
      ...(await shot(browser, base, "tabla", async (page) => {
        await loadPanel(page, "cotizaciones");
        await page.click("#btn-vista-tabla");
        await page.waitForTimeout(500);
        return page.locator("#tabla-container");
      }))
    );
  }

  if (arg === "all" || arg === "analisis") {
    shots.push(
      ...(await shot(browser, base, "analisis", async (page) => {
        await loadPanel(page, "analisis");
        await page.waitForTimeout(800);
        return page.locator("#panel-analisis");
      }))
    );
  }

  if (arg === "all" || arg === "resumen") {
    shots.push(
      ...(await shot(browser, base, "resumen", async (page) => {
        await loadPanel(page, "resumen");
        await page.waitForTimeout(500);
        return page.locator("#panel-resumen");
      }))
    );
  }

  if (arg === "all" || arg === "calc") {
    shots.push(
      ...(await shot(browser, base, "calc", async (page) => {
        await loadPanel(page, "calculadora");
        await page.waitForTimeout(400);
        return page.locator("#panel-calculadora");
      }))
    );
  }

  if (arg === "all" || arg === "obs") {
    shots.push(
      ...(await shot(browser, base, "obs", async (page) => {
        await loadPanel(page, "observaciones");
        await page.waitForTimeout(400);
        return page.locator("#panel-observaciones");
      }))
    );
  }

  await browser.close();
  server.close();
  console.log(JSON.stringify({ ok: true, shots }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
