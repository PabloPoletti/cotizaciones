/**
 * Verifica tooltips (3 barras) y padding de eje TIR tras fix PR #11.
 * Uso: node scripts/capture_chart_tooltips.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, createReadStream, statSync, writeFileSync } from "fs";
import { createServer } from "http";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const OUT = join(ROOT, "docs", "screenshots", "chart-padding", "fix-scatter-tooltip");

async function hoverScatterPoint(page, ticker) {
  const canvas = page.locator("#chart-scatter");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const rel = await page.evaluate((prefix) => {
    const c = document.getElementById("chart-scatter");
    const chart = c ? Chart.getChart(c) : null;
    if (!chart) return null;
    const idx = chart.data.datasets[0].data.findIndex((d) => String(d.ticker).startsWith(prefix));
    if (idx < 0) return null;
    const el = chart.getDatasetMeta(0).data[idx];
    if (!el) return null;
    return {
      x: el.x,
      y: el.y,
      yMax: chart.scales?.y?.max,
      label: chart.data.datasets[0].data[idx].ticker,
    };
  }, ticker);
  if (!box || !rel) return null;
  await page.mouse.move(box.x + rel.x, box.y + rel.y);
  await page.waitForTimeout(450);
  const tip = await page.evaluate(() => {
    const c = document.getElementById("chart-scatter");
    const chart = c ? Chart.getChart(c) : null;
    const tt = chart?.tooltip;
    return {
      tooltipOpacity: tt?.opacity ?? 0,
      tooltipTitle: tt?.title?.[0] ?? "",
      tooltipBody: (tt?.body || []).flatMap((b) => b.lines || []).join(" | "),
    };
  });
  return { ...rel, ...tip };
}

function serveStatic(root) {
  return createServer((req, res) => {
    let path = join(root, (req.url || "/").split("?")[0].replace(/^\//, "") || "index.html");
    if (path.endsWith("/")) path += "index.html";
    try {
      statSync(path);
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/html" });
    createReadStream(path).pipe(res);
  });
}

async function hoverBarByLabel(page, tickerPrefix) {
  const canvas = page.locator("#chart-tir-barras");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const rel = await page.evaluate((prefix) => {
    const c = document.getElementById("chart-tir-barras");
    const chart = c ? Chart.getChart(c) : null;
    if (!chart) return null;
    const idx = chart.data.labels.findIndex((l) => String(l).startsWith(prefix));
    if (idx < 0) return null;
    const el = chart.getDatasetMeta(0).data[idx];
    if (!el) return null;
    return {
      x: el.x,
      y: el.y,
      xMax: chart.scales?.x?.max,
      label: chart.data.labels[idx],
    };
  }, tickerPrefix);
  if (!box || !rel) return null;
  await page.mouse.move(box.x + rel.x, box.y + rel.y);
  await page.waitForTimeout(450);
  const tip = await page.evaluate(() => {
    const c = document.getElementById("chart-tir-barras");
    const chart = c ? Chart.getChart(c) : null;
    const tt = chart?.tooltip;
    return {
      tooltipOpacity: tt?.opacity ?? 0,
      tooltipTitle: tt?.title?.[0] ?? "",
      tooltipBody: (tt?.body || []).flatMap((b) => b.lines || []).join(" | "),
    };
  });
  return { ...rel, ...tip };
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

  const canvas = page.locator("#chart-tir-barras");
  await canvas.waitFor({ state: "visible" });

  const hovers = [
    { ticker: "SA24D", name: "01-tooltip-sa24d.png" },
    { ticker: "AL30", name: "02-tooltip-al30.png" },
    { ticker: "GD38", name: "03-tooltip-gd38.png" },
  ];
  const report = [];

  for (const h of hovers) {
    const info = await hoverBarByLabel(page, h.ticker);
    report.push({ file: h.name, ...info });
    await page.locator(".chart-card--tir-barras").screenshot({ path: join(OUT, h.name) });
    console.log("OK", h.name, info);
  }

  await page.locator(".chart-card:has(#chart-scatter)").screenshot({
    path: join(OUT, "04-curva-tir-plazo.png"),
  });

  const scatterHovers = [
    { ticker: "AL29", name: "05-scatter-al29.png" },
    { ticker: "AL35", name: "06-scatter-al35.png" },
    { ticker: "GD38", name: "07-scatter-gd38.png" },
  ];
  for (const h of scatterHovers) {
    const info = await hoverScatterPoint(page, h.ticker);
    report.push({ file: h.name, ...info });
    await page.locator(".chart-card--scatter").screenshot({ path: join(OUT, h.name) });
    console.log("OK", h.name, info);
  }

  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

  await browser.close();
  server.close();

  const failed = report.filter((r) => !r.tooltipTitle || r.tooltipOpacity < 0.5);
  if (failed.length) {
    console.error("FALLO: tooltip no visible en", failed.map((f) => f.file));
    process.exit(1);
  }
  const barReport = report.filter((r) => r.file.startsWith("0") && !r.file.startsWith("05"));
  if (barReport[0]?.xMax <= 20.5) {
    console.error("FALLO: xMax del eje sin padding (", barReport[0].xMax, ")");
    process.exit(1);
  }
  const scatterReport = report.filter((r) => r.file.startsWith("05") || r.file.startsWith("06") || r.file.startsWith("07"));
  if (scatterReport.some((r) => r.yMax <= 20.5)) {
    console.error("FALLO: yMax scatter sin padding");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
