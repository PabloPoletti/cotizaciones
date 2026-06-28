/**
 * Verificación prod: grupos TIR + fix búsqueda→ficha.
 */
import { chromium } from "playwright";

const BASE = "https://pablopoletti.github.io/cotizaciones/";

async function gotoFresh(page) {
  await page.goto(`${BASE}?v=${Date.now()}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector(".inst-card", { timeout: 60000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await gotoFresh(page);
  await page.click('button[data-tab="resumen"]');
  await page.waitForSelector("#resumen-kpis .kpi-card", { timeout: 15000 });

  const resumen = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#resumen-kpis .kpi-card")].map((el) =>
      el.textContent?.replace(/\s+/g, " ").trim()
    );
    return { cards, kpiHtml: document.getElementById("resumen-kpis")?.innerHTML || "" };
  });

  const kpiTexts = resumen.cards;
  const resumenOk = {
    okUsd: kpiTexts.some((t) => /TIR prom\.\s*\(USD nominal\)/i.test(t)),
    okArsNom: kpiTexts.some((t) => /TIR prom\.\s*\(ARS nominal\)/i.test(t)),
    okCer: kpiTexts.some((t) => /TIR prom\.\s*\(ARS real \(CER\)\)/i.test(t)),
    okDl: kpiTexts.some((t) => /TIR prom\.\s*\(Dollar-linked\)/i.test(t)),
    okNoComp: kpiTexts.some((t) => /Sin TIR comparable/i.test(t)),
    noMixedMoneda: !resumen.kpiHtml.includes("TIR prom. (USD)") && !resumen.kpiHtml.includes("TIR prom. (ARS-CER)"),
  };

  const ranking = await page.evaluate(() =>
    [...document.querySelectorAll("#tabla-ranking-sector tbody tr")].map((tr) => {
      const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent?.replace(/\s+/g, " ").trim());
      return { sector: cells[0], ticker: cells[1], tir: cells[2] };
    })
  );

  const soberanosArsRows = ranking.filter((r) => r.sector?.includes("Soberanos ARS"));
  const gd29 = ranking.find((r) => r.ticker === "GD29");
  const al29 = ranking.find((r) => r.ticker === "AL29");
  const gd30 = ranking.find((r) => r.ticker === "GD30");
  const usdSoberanoRows = ranking.filter((r) => /Soberanos USD/i.test(r.sector));

  const rankingOk = {
    okArs3Grupos:
      soberanosArsRows.length >= 3 &&
      soberanosArsRows.some((r) => /ARS nominal/i.test(r.sector)) &&
      soberanosArsRows.some((r) => /CER/i.test(r.sector)) &&
      soberanosArsRows.some((r) => /Dollar-linked/i.test(r.sector)),
    okRefMark: usdSoberanoRows.some((r) => r.tir?.includes("(ref.)")),
    okMercMark: ranking.some((r) => r.tir && !r.tir.includes("(ref.)")),
    okRefGd29: !gd29 || gd29.tir?.includes("(ref.)"),
    okRefAl29: !al29 || al29.tir?.includes("(ref.)"),
    okMercGd30: !gd30 || !gd30.tir?.includes("(ref.)"),
    usdSoberanoRows,
    gd29: gd29?.tir,
    al29: al29?.tir,
    gd30: gd30?.tir,
    soberanosArsRows,
  };
  rankingOk.ok =
    rankingOk.okArs3Grupos &&
    rankingOk.okRefMark &&
    rankingOk.okMercMark &&
    rankingOk.okRefGd29 &&
    rankingOk.okRefAl29 &&
    rankingOk.okMercGd30;

  await gotoFresh(page);
  await page.click('button[data-tab="cotizaciones"]');
  const fp = page.locator("details.filter-panel");
  if (!(await fp.evaluate((el) => el.open))) await fp.locator("summary").click();
  await page.selectOption("#filtro-tipo", "Soberano USD");
  await page.fill("#filtro-busqueda", "GD38");
  await page.waitForTimeout(700);

  await page.evaluate(() => {
    const card = document.querySelector('.inst-card[data-ticker="GD38"]');
    const r = card?.getBoundingClientRect();
    if (!r) return;
    let el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!el || el.closest("summary")) {
      el = card.querySelector(".inst-card__metric") || card.querySelector(".inst-card__body");
    }
    el?.click();
  });

  await page.waitForFunction(
    () =>
      !document.getElementById("ficha-instrumento")?.classList.contains("hidden") &&
      (document.getElementById("ficha-content")?.innerHTML?.length || 0) > 100,
    { timeout: 20000 }
  );

  const fichaSearch = await page.evaluate(() => ({
    fichaHidden: document.getElementById("ficha-instrumento")?.classList.contains("hidden"),
    contentLen: document.getElementById("ficha-content")?.innerHTML?.length || 0,
  }));

  await page.evaluate(() => document.getElementById("btn-ficha-volver")?.click());
  await page.waitForSelector("#cotiz-lista-view:not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.fill("#filtro-busqueda", "GD38");
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.querySelector('.inst-card[data-ticker="GD38"] details summary')?.click();
  });
  await page.waitForTimeout(600);

  const acordeon = await page.evaluate(() => ({
    detailsOpen: document.querySelector('.inst-card[data-ticker="GD38"] details')?.open === true,
    fichaHidden: document.getElementById("ficha-instrumento")?.classList.contains("hidden"),
  }));

  await gotoFresh(page);
  await page.click('button[data-tab="analisis"]');
  await page.waitForTimeout(3000);

  const scatter = await page.evaluate(() => {
    const canvas = document.getElementById("chart-scatter");
    const chart = canvas ? window.Chart?.getChart(canvas) : null;
    if (!chart) return { hasChart: false, labels: [], tickers: [] };
    const tickers = [];
    for (const ds of chart.data.datasets) {
      for (const pt of ds.data || []) {
        if (pt?.ticker) tickers.push(pt.ticker);
      }
    }
    return { hasChart: true, labels: chart.data.datasets.map((d) => d.label), tickers };
  });

  const noCompTickers = ["BPO27", "BPO28", "BPOD7", "SPYD", "TX26", "CO26D"];
  const badInScatter = scatter.tickers.filter((t) => noCompTickers.includes(t));

  const report = {
    resumen: { ...resumenOk, kpiTexts, ok: Object.values(resumenOk).every(Boolean) },
    ranking: rankingOk,
    busquedaFicha: {
      clickCentro: fichaSearch,
      acordeon,
      ok:
        !fichaSearch.fichaHidden &&
        fichaSearch.contentLen > 100 &&
        acordeon.detailsOpen &&
        acordeon.fichaHidden,
    },
    scatter: {
      ...scatter,
      badInScatter,
      ok:
        scatter.hasChart &&
        scatter.labels.some((l) => /USD nominal/i.test(l)) &&
        scatter.labels.some((l) => /ARS nominal/i.test(l)) &&
        badInScatter.length === 0,
    },
  };

  report.allOk = report.resumen.ok && report.ranking.ok && report.busquedaFicha.ok && report.scatter.ok;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
