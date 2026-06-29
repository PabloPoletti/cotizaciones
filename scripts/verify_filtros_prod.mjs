/**
 * Verifica panel de filtros compacto en producción.
 * Uso: node scripts/verify_filtros_prod.mjs
 */
import { chromium } from "playwright";

const BASE = "https://pablopoletti.github.io/cotizaciones/";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function verify(page, label) {
  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector("#cotiz-toolbar:not(.hidden)", { timeout: 30000 });

  const checks = await page.evaluate(() => {
    const mainCells = document.querySelectorAll(".filter-grid--main > .filter-cell:not(.hidden)");
    const ordenBtn = document.getElementById("btn-filtro-orden-dir");
    const kpiInHead = document.querySelector(".filter-panel__head #cotiz-mini-kpi");
    const vencText = document.querySelector(".checkbox-label--compact .checkbox-label__text")?.textContent?.trim();
    const dirHidden = document.getElementById("filtro-orden-dir")?.classList.contains("visually-hidden");
    const legacyDirLabel = [...document.querySelectorAll(".filter-grid label")].some(
      (l) => l.textContent?.trim() === "Dirección"
    );
    return {
      mainCells: mainCells.length,
      hasOrdenBtn: !!ordenBtn,
      kpiInHead: !!kpiInHead,
      vencText,
      dirHidden,
      noLegacyDirLabel: !legacyDirLabel,
      kpiVisible: kpiInHead && !kpiInHead.classList.contains("hidden"),
    };
  });

  assert(checks.hasOrdenBtn, `${label}: falta botón orden`);
  assert(checks.kpiInHead, `${label}: KPIs no en summary`);
  assert(checks.vencText === "Vencidos", `${label}: label Vencidos`);
  assert(checks.dirHidden, `${label}: select dirección visible`);
  assert(checks.noLegacyDirLabel, `${label}: label Dirección legacy`);
  assert(checks.mainCells === 5, `${label}: esperado 5 celdas, got ${checks.mainCells}`);

  await page.locator(".filter-panel").screenshot({
    path: `scripts/out/filtros_prod_${label}.png`,
  });

  return checks;
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  const desktop = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const d = await verify(desktop, "desktop_1400");

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const m = await verify(mobile, "mobile_390");

  await browser.close();
  console.log(JSON.stringify({ ok: true, desktop: d, mobile: m }, null, 2));
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
