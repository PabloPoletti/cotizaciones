/**
 * Histórico de precios BYMA (historico_precios.json): series, métricas y liquidez relativa.
 */
(function () {
  "use strict";

  const C = () => window.CotizCore;

  let percentiles = { p33: null, p66: null };

  function init(data) {
    if (C()) C().state.historicoPrecios = data || { instrumentos: {} };
    calcularPercentilesVolumen();
  }

  function datosTicker(ticker) {
    return C()?.state?.historicoPrecios?.instrumentos?.[ticker] || null;
  }

  function metricas(ticker) {
    return datosTicker(ticker)?.metricas || null;
  }

  function serie(ticker) {
    return datosTicker(ticker)?.serie || [];
  }

  function calcularPercentilesVolumen() {
    const vols = Object.values(C()?.state?.historicoPrecios?.instrumentos || {})
      .map((t) => t?.metricas?.volumen_promedio)
      .filter((v) => v != null && v > 0)
      .sort((a, b) => a - b);
    if (vols.length < 3) {
      percentiles = { p33: null, p66: null };
      return;
    }
    const p33idx = Math.floor(vols.length * 0.33);
    const p66idx = Math.floor(vols.length * 0.66);
    percentiles = { p33: vols[p33idx], p66: vols[p66idx] };
  }

  function nivelLiquidez(ticker) {
    const vol = metricas(ticker)?.volumen_promedio;
    if (vol == null || vol <= 0) {
      return { nivel: "na", label: "Sin dato", title: "Sin volumen histórico BYMA" };
    }
    const { p33, p66 } = percentiles;
    if (p33 == null || p66 == null) {
      return {
        nivel: "media",
        label: "Media",
        title: `Vol. prom. ${formatearVolumen(vol)} (muestra insuficiente para percentiles)`,
      };
    }
    if (vol >= p66) {
      return {
        nivel: "alta",
        label: "Alta",
        title: `Liquidez alta vs panel — vol. prom. ${formatearVolumen(vol)}`,
      };
    }
    if (vol >= p33) {
      return {
        nivel: "media",
        label: "Media",
        title: `Liquidez media vs panel — vol. prom. ${formatearVolumen(vol)}`,
      };
    }
    return {
      nivel: "baja",
      label: "Baja",
      title: `Liquidez baja vs panel — vol. prom. ${formatearVolumen(vol)}`,
    };
  }

  function formatearVolumen(v) {
    if (v == null) return "—";
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
    return String(Math.round(v));
  }

  function badgeLiquidezHtml(ticker) {
    const liq = nivelLiquidez(ticker);
    const cls =
      liq.nivel === "alta"
        ? "badge--liq-alta"
        : liq.nivel === "baja"
          ? "badge--liq-baja"
          : liq.nivel === "media"
            ? "badge--liq-media"
            : "badge--liq-na";
    return `<span class="badge badge--liq ${cls}" title="${C().escapeHtml(liq.title)}">Liq. ${C().escapeHtml(liq.label)}</span>`;
  }

  function seriePrecioChart(ticker) {
    return serie(ticker).map((p) => ({
      fecha: p.date,
      precio: p.close / 1000,
      close: p.close,
    }));
  }

  function serieDrawdown(ticker) {
    const pts = serie(ticker);
    if (pts.length < 2) return [];
    let maxClose = pts[0].close;
    return pts.map((p) => {
      if (p.close > maxClose) maxClose = p.close;
      const dd = maxClose > 0 ? ((p.close - maxClose) / maxClose) * 100 : 0;
      return { fecha: p.date, drawdown: Math.round(dd * 100) / 100 };
    });
  }

  function tieneDatos() {
    return Object.values(C()?.state?.historicoPrecios?.instrumentos || {}).some(
      (t) => t?.serie?.length > 0
    );
  }

  function formatearPct(val) {
    if (val == null || Number.isNaN(val)) return "—";
    const signo = val > 0 ? "+" : "";
    return `${signo}${val.toFixed(2)}%`;
  }

  window.CotizHistorico = {
    init,
    datosTicker,
    metricas,
    serie,
    nivelLiquidez,
    badgeLiquidezHtml,
    seriePrecioChart,
    serieDrawdown,
    tieneDatos,
    formatearVolumen,
    formatearPct,
    calcularPercentilesVolumen,
  };
})();
