/** Capturas del panel de filtros compacto — desktop y mobile. */
import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdir } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = join(__dirname, "../docs");
const OUT = join(__dirname, "out");

function serveDocs(port) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let path = req.url?.split("?")[0] || "/";
      if (path === "/") path = "/index.html";
      const file = join(DOCS, path.replace(/^\//, "").replace(/\.\./g, ""));
      try {
        const body = readFileSync(file);
        const ext = file.split(".").pop();
        const types = {
          html: "text/html",
          js: "text/javascript",
          css: "text/css",
          json: "application/json",
          svg: "image/svg+xml",
        };
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

async function capture(page, name, full = false) {
  await page.locator("#cotiz-toolbar").waitFor({ state: "visible", timeout: 30000 });
  if (full) {
    await page.locator("#panel-cotizaciones").screenshot({ path: join(OUT, name) });
  } else {
    await page.locator(".filter-panel").screenshot({ path: join(OUT, name) });
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const port = 8778;
  const server = await serveDocs(port);
  const base = `http://127.0.0.1:${port}/`;

  const browser = await chromium.launch({ headless: true });

  const desktop = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await desktop.goto(base, { waitUntil: "networkidle", timeout: 60000 });
  await desktop.waitForSelector(".inst-card", { timeout: 30000 });
  await capture(desktop, "filtros_desktop_1400.png");
  await capture(desktop, "cotiz_desktop_1400.png", true);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(base, { waitUntil: "networkidle", timeout: 60000 });
  await mobile.waitForSelector(".inst-card", { timeout: 30000 });
  await capture(mobile, "filtros_mobile_390.png");
  await capture(mobile, "cotiz_mobile_390.png", true);

  const checks = await desktop.evaluate(() => ({
    hasOrdenBtn: !!document.getElementById("btn-filtro-orden-dir"),
    hasDirSelectHidden: document.getElementById("filtro-orden-dir")?.classList.contains("visually-hidden"),
    kpiInSummary: !!document.querySelector(".filter-panel__head #cotiz-mini-kpi"),
    vencidosLabel: document.querySelector("#filtro-mostrar-vencidos + .checkbox-label__text, .checkbox-label--compact .checkbox-label__text")?.textContent?.trim(),
    filterRows: document.querySelectorAll(".filter-grid--main > .filter-cell:not(.hidden)").length,
  }));

  console.log(JSON.stringify({ ok: true, checks, files: ["scripts/out/filtros_desktop_1400.png", "scripts/out/filtros_mobile_390.png"] }, null, 2));

  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
