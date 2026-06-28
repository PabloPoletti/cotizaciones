/** Smoke test duración + capturas ficha Tier A / Tier B */
import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdir } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = join(__dirname, "../docs");

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

async function openFicha(page, ticker) {
  await page.click('button[data-tab="cotizaciones"]');
  await page.evaluate(() => {
    document.getElementById("btn-ficha-volver")?.click();
    document.getElementById("ficha-instrumento")?.classList.add("hidden");
    document.getElementById("cotiz-lista-view")?.classList.remove("hidden");
  });
  await page.waitForTimeout(400);
  const fp = page.locator("details.filter-panel");
  if (!(await fp.evaluate((el) => el.open))) await fp.locator("summary").click();
  await page.fill("#filtro-busqueda", "");
  await page.waitForTimeout(200);
  await page.fill("#filtro-busqueda", ticker);
  await page.waitForTimeout(600);
  await page.evaluate((t) => {
    const card = document.querySelector(`.inst-card[data-ticker="${t}"]`);
    card?.querySelector(".inst-card__metric")?.click();
  }, ticker);
  await page.waitForSelector("#ficha-instrumento:not(.hidden)", { timeout: 15000 });
  await page.waitForTimeout(800);
}

async function main() {
  await mkdir("scripts/out", { recursive: true });
  const port = 8777;
  const server = await serveDocs(port);
  const base = `http://127.0.0.1:${port}/`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(base, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".inst-card", { timeout: 30000 });

  await openFicha(page, "TTC9O");
  const tierA = await page.evaluate(() => {
    const sec = document.querySelector(".ficha-subsection--sensibilidad");
    return { text: sec?.textContent?.replace(/\s+/g, " ").trim().slice(0, 400), html: sec?.innerHTML?.includes("Duración modificada") };
  });
  await page.locator(".ficha-subsection--sensibilidad").screenshot({ path: "scripts/out/ficha_ttc9o_duracion.png" });

  await page.evaluate(() => document.getElementById("btn-ficha-volver")?.click());
  await page.waitForTimeout(500);

  await openFicha(page, "GD38");
  const tierB = await page.evaluate(() => {
    const sec = document.querySelector(".ficha-subsection--sensibilidad");
    return { text: sec?.textContent?.replace(/\s+/g, " ").trim().slice(0, 400), html: sec?.innerHTML?.includes("YTM implícita") };
  });
  await page.locator(".ficha-subsection--sensibilidad").screenshot({ path: "scripts/out/ficha_gd38_duracion.png" });

  console.log(JSON.stringify({ tierA, tierB }, null, 2));
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
