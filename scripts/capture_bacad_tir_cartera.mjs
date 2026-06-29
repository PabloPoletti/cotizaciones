/**
 * Captura celda TIR de BACAD en calculadora (consistencia UI vs ponderada).
 * Uso: node scripts/capture_bacad_tir_cartera.mjs
 */
import { chromium } from "playwright";
import { spawn } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "docs", "screenshots");
const PORT = 8765;

function startServer() {
  return spawn("python", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: join(ROOT, "docs"),
    stdio: "ignore",
    detached: false,
  });
}

async function waitForServer(url, maxMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Servidor local no respondió en ${url}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = startServer();
  await waitForServer(`http://127.0.0.1:${PORT}/`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`http://127.0.0.1:${PORT}/?v=${Date.now()}`, { waitUntil: "networkidle" });

  await page.click('button[data-tab="calculadora"]');
  await page.waitForSelector("#calc-body tr", { timeout: 15000 });

  const bacadRow = page.locator('#calc-body tr:has(.ticker:text-is("BACAD"))');
  await bacadRow.scrollIntoViewIfNeeded();
  const cell = bacadRow.locator(".tir-cell");
  const cellText = await cell.innerText();
  const tirUsada = await bacadRow.locator(".pct-input").getAttribute("data-tir-usada");
  const confiable = await bacadRow.locator(".pct-input").getAttribute("data-tir-confiable");

  await cell.screenshot({ path: join(OUT, "bacad-tir-cartera-celda.png") });

  await page.locator("#capital-usd").fill("40000");
  await bacadRow.locator(".pct-input").fill("100");
  await page.waitForTimeout(300);

  const tirPond = await page.locator("#tir-ponderada").innerText();
  const notaTir = await page.locator("#calc-nota-tir").innerText();

  await page.screenshot({ path: join(OUT, "bacad-tir-cartera-full.png"), fullPage: false });

  const report = {
    ticker: "BACAD",
    cellText: cellText.replace(/\s+/g, " ").trim(),
    dataTirUsada: tirUsada,
    dataTirConfiable: confiable,
    tirPonderada100pct: tirPond,
    notaTir: notaTir.replace(/\s+/g, " ").trim(),
    ok:
      confiable === "0" &&
      (tirUsada === "" || tirUsada == null) &&
      cellText.includes("sin TIR confiable") &&
      tirPond.trim() === "—",
  };

  writeFileSync(join(OUT, "bacad-tir-cartera-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  await browser.close();
  server.kill();
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
