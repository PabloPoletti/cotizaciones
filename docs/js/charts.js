/**
 * Gráficos Chart.js — lazy init al abrir pestaña Análisis / Calculadora.
 */
(function () {
  "use strict";

  const charts = {};
  let chartsInited = false;

  const C = () => window.CotizCore;
  const A = () => window.CotizAnalytics;
  const S = () => window.CotizStorage;

  function destruir(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function sectorColors(labels) {
    return labels.map((l) => C().COLORES_SECTOR[l] || C().COLORES_SECTOR.Otros);
  }

  function initAnalisis(enriquecidos) {
    if (typeof Chart === "undefined") return;

    const tirRows = enriquecidos
      .filter((r) => r.tirRef != null)
      .sort((a, b) => b.tirRef - a.tirRef);

    destruir("tirBarras");
    const ctx1 = document.getElementById("chart-tir-barras");
    if (ctx1) {
      charts.tirBarras = new Chart(ctx1, {
        type: "bar",
        data: {
          labels: tirRows.map((r) => r.item.ticker),
          datasets: [
            {
              label: "TIR referencia (%)",
              data: tirRows.map((r) => r.tirRef),
              backgroundColor: tirRows.map((r) => r.colorSector),
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { title: { display: true, text: "TIR ref. %" } } },
        },
      });
    }

    const scatterRows = enriquecidos.filter((r) => r.tirEff != null && r.anosVto != null);
    destruir("scatter");
    const ctx2 = document.getElementById("chart-scatter");
    if (ctx2) {
      const sectores = [...new Set(scatterRows.map((r) => r.sector))];
      const datasets = sectores.map((sector) => ({
        label: sector,
        data: scatterRows
          .filter((r) => r.sector === sector)
          .map((r) => ({ x: r.anosVto, y: r.tirEff, ticker: r.item.ticker })),
        backgroundColor: C().COLORES_SECTOR[sector] || C().COLORES_SECTOR.Otros,
        pointRadius: 7,
      }));
      charts.scatter = new Chart(ctx2, {
        type: "scatter",
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            tooltip: {
              callbacks: {
                label(ctx) {
                  const t = ctx.raw.ticker || "";
                  return `${t}: ${ctx.raw.y.toFixed(2)}% / ${ctx.raw.x.toFixed(1)} años`;
                },
              },
            },
          },
          scales: {
            x: { title: { display: true, text: "Años al vencimiento" } },
            y: { title: { display: true, text: "TIR efectiva (%)" } },
          },
        },
      });
    }

    const comp = A().composicionPorSector(enriquecidos);
    destruir("sectores");
    const ctx3 = document.getElementById("chart-sectores");
    if (ctx3) {
      charts.sectores = new Chart(ctx3, {
        type: "doughnut",
        data: {
          labels: comp.map(([s]) => s),
          datasets: [{ data: comp.map(([, n]) => n), backgroundColor: sectorColors(comp.map(([s]) => s)) }],
        },
        options: { responsive: true, maintainAspectRatio: false },
      });
    }

    renderHistoricoChart(enriquecidos);
    chartsInited = true;
  }

  function renderHistoricoChart(enriquecidos) {
    destruir("historico");
    const ctx = document.getElementById("chart-historico");
    const sel = document.getElementById("historico-ticker-select");
    const emptyEl = document.getElementById("historico-empty");
    const chartWrap = document.getElementById("historico-chart-wrap");
    if (!ctx || !sel) return;

    const tickers = enriquecidos.filter((r) => !r.item.error).map((r) => r.item.ticker);
    if (!sel.dataset.filled) {
      sel.innerHTML = tickers.map((t) => `<option value="${t}">${t}</option>`).join("");
      sel.dataset.filled = "1";
    }

    const ticker = sel.value || tickers[0];
    const serie = S().historicoParaTicker(ticker);
    const store = S().cargarHistoricoLocal();
    const meta = document.getElementById("historico-meta");

    const MSG_VACIO =
      "Sin historial todavía — se empieza a acumular desde hoy que visitás el panel en este navegador (un punto por día, solo en este dispositivo).";

    if (serie.length === 0) {
      if (emptyEl) emptyEl.classList.remove("hidden");
      if (chartWrap) chartWrap.classList.add("hidden");
      if (meta) meta.textContent = MSG_VACIO;
      return;
    }

    if (emptyEl) emptyEl.classList.add("hidden");
    if (chartWrap) chartWrap.classList.remove("hidden");

    const labels = serie.map((p) => p.fecha);
    const data = serie.map((p) => p.precio / 1000);

    charts.historico = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: `${ticker} (precio/1000)`,
            data,
            borderColor: "#1e4d8c",
            tension: 0.2,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { title: { display: true, text: "Precio ref." } } },
      },
    });

    if (meta) {
      meta.textContent = `${serie.length} punto(s) local(es) en este navegador desde ${store.inicio || serie[0].fecha}. No sincronizado entre dispositivos.`;
    }
  }

  const PALETA = [
    "#1e4d8c", "#0d7a4a", "#b54708", "#7c3aed", "#0891b2",
    "#64748b", "#dc2626", "#059669", "#d97706", "#2563eb",
  ];

  function initCarteraPie(labels, data) {
    destruir("carteraPie");
    const ctx = document.getElementById("chart-cartera-pie");
    if (!ctx || typeof Chart === "undefined") return;
    charts.carteraPie = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data, backgroundColor: labels.map((_, i) => PALETA[i % PALETA.length]) }],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
  }

  function initProyeccion(labels, data) {
    destruir("proyeccion");
    const ctx = document.getElementById("chart-proyeccion");
    if (!ctx || typeof Chart === "undefined") return;
    charts.proyeccion = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Capital proyectado (USD)",
            data,
            borderColor: "#0d7a4a",
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { title: { display: true, text: "USD" } } },
      },
    });
  }

  function onTabAnalisis(enriquecidos) {
    initAnalisis(enriquecidos);
    const sel = document.getElementById("historico-ticker-select");
    if (sel && !sel.dataset.listener) {
      sel.dataset.listener = "1";
      sel.addEventListener("change", () => renderHistoricoChart(enriquecidos));
    }
  }

  window.CotizCharts = {
    onTabAnalisis,
    initCarteraPie,
    initProyeccion,
    renderHistoricoChart,
  };
})();
