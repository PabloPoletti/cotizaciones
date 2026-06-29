/**
 * Verifica Fase 2 (CSS compacto + max-width 1280px) en producción.
 * Uso: node scripts/verify_fase2_prod.mjs
 */
import { chromium } from "playwright";

const BASE = "https://pablopoletti.github.io/cotizaciones/";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function verifyViewport(page, label, width, height) {
  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector("#cotiz-toolbar:not(.hidden)", { timeout: 30000 });

  const css = await page.evaluate(() => {
    const container = document.querySelector(".container");
    const cardsGrid = document.querySelector(".cards-grid");
    const styles = container ? getComputedStyle(container) : null;
    const gridStyles = cardsGrid ? getComputedStyle(cardsGrid) : null;
    const cols = cardsGrid
      ? [...cardsGrid.querySelectorAll(".inst-card")].slice(0, 8).map((c) => c.getBoundingClientRect().left)
      : [];
    const uniqueCols = new Set(cols.map((x) => Math.round(x / 10) * 10)).size;
    return {
      maxWidth: styles?.maxWidth,
      cardsMinmax: gridStyles?.gridTemplateColumns || null,
      cardsGap: gridStyles?.gap,
      cardsPadding: gridStyles?.padding,
      sectorMargin: document.querySelector(".sector")
        ? getComputedStyle(document.querySelector(".sector")).marginBottom
        : null,
      cardColsApprox: uniqueCols,
    };
  });

  assert(css.maxWidth === "1280px", `${label}: max-width esperado 1280px, got ${css.maxWidth}`);
  assert(parseFloat(css.cardsGap) <= 13, `${label}: gap cards esperado <=13px, got ${css.cardsGap}`);
  assert(parseFloat(css.cardsPadding) <= 12, `${label}: padding cards esperado <=12px, got ${css.cardsPadding}`);
  if (width >= 1200) {
    assert(css.cardColsApprox >= 4, `${label}: esperado >=4 columnas cards, got ${css.cardColsApprox}`);
  }

  await page.click('button[data-tab="cotizaciones"]');
  await page.waitForSelector(".sector", { timeout: 15000 });
  await page.locator("#panel-cotizaciones").screenshot({
    path: `scripts/out/fase2_prod_cotiz_${label}.png`,
  });

  await page.click('button[data-tab="analisis"]');
  await page.waitForTimeout(800);
  await page.locator("#panel-analisis").screenshot({
    path: `scripts/out/fase2_prod_analisis_${label}.png`,
  });

  await page.click('button[data-tab="resumen"]');
  await page.waitForTimeout(500);
  await page.locator("#panel-resumen").screenshot({
    path: `scripts/out/fase2_prod_resumen_${label}.png`,
  });

  await page.click('button[data-tab="cotizaciones"]');
  await page.click("#btn-vista-tabla");
  await page.waitForTimeout(500);
  const tableScroll = await page.evaluate(() => {
    const wrap = document.querySelector("#tabla-container .table-wrap");
    if (!wrap) return { scrollWidth: 0, clientWidth: 0 };
    return { scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth };
  });
  if (width >= 1200) {
    assert(
      tableScroll.scrollWidth <= tableScroll.clientWidth + 2,
      `${label}: scroll horizontal en tabla (${tableScroll.scrollWidth} > ${tableScroll.clientWidth})`
    );
  }
  await page.locator("#tabla-container").screenshot({
    path: `scripts/out/fase2_prod_tabla_${label}.png`,
  });

  return { css, tableScroll };
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  const desktop = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const d = await verifyViewport(desktop, "desktop_1400", 1400, 900);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const m = await verifyViewport(mobile, "mobile_390", 390, 844);

  await browser.close();
  console.log(JSON.stringify({ ok: true, desktop: d, mobile: m }, null, 2));
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
