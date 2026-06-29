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
  const H = () => window.CotizHistorico;

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

    const barRows = enriquecidos
      .filter((r) => r.tirEff != null && C().esTirComparable(r))
      .sort((a, b) => b.tirEff - a.tirEff);

    destruir("tirBarras");
    const ctx1 = document.getElementById("chart-tir-barras");
    if (ctx1) {
      const barCount = barRows.length;
      const box = ctx1.parentElement;
      if (box) {
        const h = Math.min(Math.max(barCount * 15, 280), 760);
        box.style.height = `${h}px`;
      }
      const labels = barRows.map((r) => {
        const ref = r.tirCalc?.fuente === "referencia" ? " (ref.)" : "";
        return `${r.item.ticker}${ref}`;
      });
      const grupos = C().ORDEN_GRUPOS_TIR.filter((g) =>
        barRows.some((r) => r.tirComparableGrupo === g)
      );
      const barThickness = barCount > 30 ? 10 : barCount > 20 ? 12 : 16;
      const datasets = grupos.map((grupo) => ({
        label: C().GRUPO_TIR_LABELS[grupo] || grupo,
        data: barRows.map((r) => (r.tirComparableGrupo === grupo ? r.tirEff : null)),
        backgroundColor: C().COLORES_GRUPO_TIR[grupo] || C().COLORES_SECTOR.Otros,
        barThickness,
      }));
      charts.tirBarras = new Chart(ctx1, {
        type: "bar",
        data: { labels, datasets },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                boxWidth: 10,
                font: { size: grupos.length > 4 ? 9 : 11 },
                padding: 8,
              },
            },
            tooltip: {
              callbacks: {
                label(ctx) {
                  const row = barRows[ctx.dataIndex];
                  const ref = row?.tirCalc?.fuente === "referencia" ? " (ref.)" : "";
                  return `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(2)}%${ref}`;
                },
              },
            },
          },
          scales: {
            x: { title: { display: true, text: "TIR efectiva (%)" } },
            y: {
              ticks: {
                font: { size: barCount > 30 ? 9 : 10 },
                autoSkip: barCount > 24,
                maxTicksLimit: barCount > 24 ? 28 : undefined,
              },
            },
          },
        },
      });
    }

    const scatterRows = enriquecidos.filter(
      (r) => r.tirEff != null && r.anosVto != null && C().esTirComparable(r)
    );
    destruir("scatter");
    const ctx2 = document.getElementById("chart-scatter");
    if (ctx2) {
      const grupos = C()
        .ORDEN_GRUPOS_TIR.filter((g) => scatterRows.some((r) => r.tirComparableGrupo === g));
      const manyPoints = scatterRows.length > 24;
      const datasets = grupos.map((grupo) => ({
        label: C().GRUPO_TIR_LABELS[grupo] || grupo,
        data: scatterRows
          .filter((r) => r.tirComparableGrupo === grupo)
          .map((r) => ({ x: r.anosVto, y: r.tirEff, ticker: r.item.ticker })),
        backgroundColor: C().COLORES_GRUPO_TIR[grupo] || C().COLORES_SECTOR.Otros,
        pointRadius: manyPoints ? 4 : 7,
        pointHoverRadius: manyPoints ? 6 : 9,
      }));
      charts.scatter = new Chart(ctx2, {
        type: "scatter",
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                boxWidth: 10,
                font: { size: grupos.length > 4 ? 9 : 11 },
                padding: 8,
              },
            },
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
      const manySectors = comp.length > 8;
      charts.sectores = new Chart(ctx3, {
        type: "doughnut",
        data: {
          labels: comp.map(([s]) => s),
          datasets: [{ data: comp.map(([, n]) => n), backgroundColor: sectorColors(comp.map(([s]) => s)) }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                boxWidth: 10,
                font: { size: manySectors ? 9 : 11 },
                padding: 6,
              },
            },
          },
        },
      });
    }

    renderHistoricoChart(enriquecidos);
    renderDrawdownChart(enriquecidos);
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
    const meta = document.getElementById("historico-meta");
    const usarByma = H()?.tieneDatos() && H().serie(ticker).length > 0;

    let serie;
    let labels;
    let data;
    if (usarByma) {
      serie = H().seriePrecioChart(ticker);
      labels = serie.map((p) => p.fecha);
      data = serie.map((p) => p.precio);
    } else {
      serie = S().historicoParaTicker(ticker);
      labels = serie.map((p) => p.fecha);
      data = serie.map((p) => p.precio / 1000);
    }

    const MSG_VACIO =
      "Sin historial BYMA todavía — ejecutá el workflow «Bootstrap histórico precios» una vez. Mientras tanto no hay serie de 90 días.";

    if (serie.length === 0) {
      if (emptyEl) emptyEl.classList.remove("hidden");
      if (chartWrap) chartWrap.classList.add("hidden");
      if (meta) meta.textContent = MSG_VACIO;
      return;
    }

    if (emptyEl) emptyEl.classList.add("hidden");
    if (chartWrap) chartWrap.classList.remove("hidden");

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
      if (usarByma) {
        const m = H().metricas(ticker);
        meta.textContent =
          `${serie.length} días BYMA (${m?.fecha_inicio_serie || labels[0]} → ${m?.ultima_fecha || labels[labels.length - 1]}). ` +
          `Var. 7d/30d: ${H().formatearPct(m?.var_7d_pct)} / ${H().formatearPct(m?.var_30d_pct)}.`;
      } else {
        const store = S().cargarHistoricoLocal();
        meta.textContent = `${serie.length} punto(s) local(es) en este navegador desde ${store.inicio || serie[0].fecha}.`;
      }
    }
  }

  function renderDrawdownChart(enriquecidos) {
    destruir("drawdown");
    const ctx = document.getElementById("chart-drawdown");
    const sel = document.getElementById("historico-ticker-select");
    const wrap = document.getElementById("drawdown-chart-wrap");
    const emptyEl = document.getElementById("drawdown-empty");
    if (!ctx || !sel) return;

    const ticker = sel.value || enriquecidos.find((r) => !r.item.error)?.item.ticker;
    const dd = H()?.tieneDatos() ? H().serieDrawdown(ticker) : [];

    if (!dd.length) {
      if (emptyEl) emptyEl.classList.remove("hidden");
      if (wrap) wrap.classList.add("hidden");
      return;
    }
    if (emptyEl) emptyEl.classList.add("hidden");
    if (wrap) wrap.classList.remove("hidden");

    charts.drawdown = new Chart(ctx, {
      type: "line",
      data: {
        labels: dd.map((p) => p.fecha),
        datasets: [
          {
            label: "Drawdown desde máximo (% ventana)",
            data: dd.map((p) => p.drawdown),
            borderColor: "#b54708",
            backgroundColor: "rgba(181,71,8,0.08)",
            fill: true,
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            title: { display: true, text: "% desde máximo" },
            max: 0,
          },
        },
      },
    });
  }

  const PALETA = C().PALETA_CARTERA || [
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
      sel.addEventListener("change", () => {
        renderHistoricoChart(enriquecidos);
        renderDrawdownChart(enriquecidos);
      });
    }
  }

  function renderFichaCharts(ticker) {
    if (typeof Chart === "undefined") return;
    const serie = H()?.seriePrecioChart(ticker) || [];
    const dd = H()?.serieDrawdown(ticker) || [];

    destruir("fichaHistorico");
    destruir("fichaDrawdown");

    const ctxPrecio = document.getElementById("ficha-chart-precio");
    const ctxDd = document.getElementById("ficha-chart-drawdown");
    const emptyEl = document.getElementById("ficha-charts-empty");
    const gridEl = document.querySelector(".ficha-charts-grid");

    const fichaChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 10, right: 18, bottom: 6, left: 6 } },
    };

    if (!serie.length) {
      if (emptyEl) emptyEl.classList.remove("hidden");
      if (gridEl) gridEl.classList.add("hidden");
      return;
    }
    if (emptyEl) emptyEl.classList.add("hidden");
    if (gridEl) gridEl.classList.remove("hidden");

    if (ctxPrecio) {
      charts.fichaHistorico = new Chart(ctxPrecio, {
        type: "line",
        data: {
          labels: serie.map((p) => p.fecha),
          datasets: [
            {
              label: `${ticker} (precio/1000)`,
              data: serie.map((p) => p.precio),
              borderColor: "#1e4d8c",
              tension: 0.2,
              fill: false,
              pointRadius: 0,
              pointHitRadius: 8,
            },
          ],
        },
        options: {
          ...fichaChartOptions,
          scales: {
            x: {
              offset: true,
              ticks: { maxRotation: 40, autoSkip: true, maxTicksLimit: 8 },
            },
            y: { title: { display: true, text: "Precio ref." }, grace: "5%" },
          },
        },
      });
    }

    if (ctxDd && dd.length) {
      charts.fichaDrawdown = new Chart(ctxDd, {
        type: "line",
        data: {
          labels: dd.map((p) => p.fecha),
          datasets: [
            {
              label: "Drawdown %",
              data: dd.map((p) => p.drawdown),
              borderColor: "#b54708",
              backgroundColor: "rgba(181,71,8,0.08)",
              fill: true,
              tension: 0.15,
              pointRadius: 0,
            },
          ],
        },
        options: {
          ...fichaChartOptions,
          scales: {
            x: {
              offset: true,
              ticks: { maxRotation: 40, autoSkip: true, maxTicksLimit: 8 },
            },
            y: { max: 0, grace: "5%", title: { display: true, text: "% desde máximo" } },
          },
        },
      });
    }
  }

  window.CotizCharts = {
    onTabAnalisis,
    initCarteraPie,
    initProyeccion,
    renderHistoricoChart,
    renderFichaCharts,
  };
})();
