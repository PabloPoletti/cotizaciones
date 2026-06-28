/**
 * Verifica en producción la sección Sensibilidad a tasas (duración/convexidad).
 * Uso: node scripts/verify_duracion_prod.mjs
 */
import { chromium } from "playwright";

const BASE = "https://pablopoletti.github.io/cotizaciones/";

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
  await page.waitForTimeout(700);
  await page.evaluate((t) => {
    document.querySelector(`.inst-card[data-ticker="${t}"]`)?.querySelector(".inst-card__metric")?.click();
  }, ticker);
  await page.waitForSelector("#ficha-instrumento:not(.hidden)", { timeout: 20000 });
  await page.waitForTimeout(800);
}

async function readSensibilidad(page) {
  return page.evaluate(() => {
    const sec = document.querySelector(".ficha-subsection--sensibilidad");
    if (!sec) return { found: false };
    const labels = [...sec.querySelectorAll(".label")].map((el) => el.textContent?.trim());
    const values = [...sec.querySelectorAll(".ficha-kpi strong")].map((el) => el.textContent?.trim());
    const h3 = sec.querySelector("h3")?.textContent?.trim();
    const empty = sec.querySelector(".ficha-empty")?.textContent?.trim();
    const edu = sec.querySelector(".ficha-edu-intro")?.textContent?.trim();
    return { found: true, h3, labels, values, empty, edu, text: sec.textContent?.replace(/\s+/g, " ").trim() };
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("pageerror", (e) => console.error("PAGEERR", e.message));

  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector(".inst-card", { timeout: 30000 });

  const deployed = await page.evaluate(() => {
    const src = [...document.scripts].map((s) => s.src).join(" ");
    return typeof window.CotizCore?.calcularDuracionConvexidad === "function";
  });
  assert(deployed, "calcularDuracionConvexidad no desplegado aún en producción");

  const results = {};

  await openFicha(page, "TTC9O");
  const ttc9o = await readSensibilidad(page);
  assert(ttc9o.found, "TTC9O: falta sección sensibilidad");
  assert(/YTM implícita/i.test(ttc9o.h3 || ""), "TTC9O: título incorrecto");
  assert(ttc9o.labels.includes("Duración modificada"), "TTC9O: falta duración");
  assert(ttc9o.values.some((v) => /años/.test(v)), "TTC9O: valor duración");
  assert(ttc9o.values.some((v) => /%/.test(v)), "TTC9O: valor YTM");
  assert(/suben 1 punto/i.test(ttc9o.edu || ""), "TTC9O: texto impacto 1pp");
  results.TTC9O = ttc9o;

  await page.evaluate(() => document.getElementById("btn-ficha-volver")?.click());
  await page.waitForTimeout(500);

  await openFicha(page, "GD38");
  const gd38 = await readSensibilidad(page);
  assert(gd38.found, "GD38: falta sección sensibilidad");
  assert(/YTM implícita/i.test(gd38.h3 || ""), "GD38: título incorrecto");
  assert(gd38.labels.includes("Convexidad"), "GD38: falta convexidad");
  assert(gd38.labels.includes("Flujos modelados"), "GD38: falta flujos");
  assert(Number.parseInt(gd38.values.find((v) => /^\d+$/.test(v)) || "0", 10) >= 10, "GD38: pocos flujos");
  results.GD38 = gd38;

  await page.evaluate(() => document.getElementById("btn-ficha-volver")?.click());
  await page.waitForTimeout(500);

  await openFicha(page, "S31G6");
  const s31g6 = await readSensibilidad(page);
  assert(s31g6.found, "S31G6: falta sección sensibilidad");
  assert(/Lecap|capitalización mensual/i.test(s31g6.empty || ""), "S31G6: motivo Lecap específico");
  assert(!/^Dato no disponible/i.test(s31g6.empty || ""), "S31G6: mensaje genérico");
  assert(/Duración no disponible/i.test(s31g6.empty || ""), "S31G6: prefijo duración");
  results.S31G6 = s31g6;

  await browser.close();

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
