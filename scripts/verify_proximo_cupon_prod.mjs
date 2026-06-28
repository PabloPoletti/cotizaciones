/**
 * Verifica en producción el arreglo de proximoCuponInfo (ficha + lista cupones).
 * Uso: node scripts/verify_proximo_cupon_prod.mjs
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

async function readPlazosCupon(page) {
  return page.evaluate(() => {
    const kpis = [...document.querySelectorAll(".ficha-section--calc .ficha-kpi")];
    const cuponKpi = kpis.find((k) => k.querySelector(".label")?.textContent?.trim() === "Próximo cupón");
    if (!cuponKpi) return { found: false };
    return {
      found: true,
      strong: cuponKpi.querySelector("strong")?.textContent?.trim(),
      meta: cuponKpi.querySelector(".meta")?.textContent?.trim(),
    };
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

  const deployed = await page.evaluate(
    () => typeof window.CotizCore?.proximoCuponInfo === "function"
  );
  assert(deployed, "proximoCuponInfo no desplegado en producción");

  const results = {};

  await openFicha(page, "S30O6");
  const s30o6 = await readPlazosCupon(page);
  assert(s30o6.found, "S30O6: falta bloque plazos");
  assert(s30o6.strong === "No aplica", "S30O6: debería decir No aplica");
  assert(/capitaliza interés/i.test(s30o6.meta || ""), "S30O6: mensaje capitalización");
  assert(!/30\/10\/2026/.test(s30o6.strong || ""), "S30O6: no debe mostrar fecha como cupón");
  results.S30O6_ficha = s30o6;

  await page.evaluate(() => document.getElementById("btn-ficha-volver")?.click());
  await page.waitForTimeout(500);

  const listaCupones = await page.evaluate(() => {
    const items = [...document.querySelectorAll("#lista-cupones li")].map((li) => li.textContent?.trim());
    return { items, hasS30O6: items.some((t) => /S30O6/.test(t || "")) };
  });
  assert(!listaCupones.hasS30O6, "S30O6 no debe aparecer en próximos cupones del panel");
  results.lista_cupones_sin_S30O6 = listaCupones;

  await openFicha(page, "GD30");
  const gd30 = await readPlazosCupon(page);
  assert(gd30.found, "GD30: falta bloque plazos");
  assert(/9\/7\/2026|09\/07\/2026|9\/07\/2026/.test(gd30.strong || ""), "GD30: fecha 9/7/2026");
  assert(/canje 2020/i.test(gd30.meta || ""), "GD30: meta calendario canje");
  assert(!/intervalos regulares/i.test(gd30.meta || ""), "GD30: no debe usar meta heurística");
  results.GD30_ficha = gd30;

  await page.evaluate(() => document.getElementById("btn-ficha-volver")?.click());
  await page.waitForTimeout(500);

  await openFicha(page, "YMCIO");
  const ymcio = await readPlazosCupon(page);
  assert(ymcio.found, "YMCIO: falta bloque plazos");
  assert(/30\/6\/2026|30\/06\/2026/.test(ymcio.strong || ""), "YMCIO: fecha heurística");
  assert(/intervalos regulares/i.test(ymcio.meta || ""), "YMCIO: advertencia fuerte");
  assert(/verificar calendario oficial/i.test(ymcio.meta || ""), "YMCIO: no calendario verificado");
  assert(!/canje 2020/i.test(ymcio.meta || ""), "YMCIO: no meta canje");
  results.YMCIO_ficha = ymcio;

  const gd30EnLista = await page.evaluate(() =>
    [...document.querySelectorAll("#lista-cupones li")]
      .map((li) => li.textContent?.trim())
      .find((t) => /GD30/.test(t || ""))
  );
  results.GD30_en_lista = gd30EnLista || null;

  await browser.close();
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
