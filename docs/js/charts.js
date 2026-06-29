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

  const ESCALA_TIR_GRAFICO = { min: -5, max: 20 };

  /** Padding visual compartido para ejes Chart.js (Análisis + ficha). */
  const CHART_AXIS = {
    grace: "12%",
    /** Aire visual en eje TIR: max dato 20 + ~10% del rango (-5…20). */
    tirPadRatio: 0.1,
    layout: { padding: { top: 10, right: 16, bottom: 8, left: 6 } },
  };

  function tirMaxEjeVisual() {
    const { min, max } = ESCALA_TIR_GRAFICO;
    return max + (max - min) * CHART_AXIS.tirPadRatio;
  }

  function layoutGrafico(extra) {
    return {
      layout: {
        padding: { ...CHART_AXIS.layout.padding, ...extra },
      },
    };
  }

  function tooltipAnalisis() {
    return {
      enabled: true,
      intersect: false,
      caretPadding: 10,
      padding: 10,
      displayColors: false,
    };
  }

  /** Barras horizontales: tooltip estándar anclado al extremo de la barra. */
  function tooltipBarrasHorizontales() {
    return {
      ...tooltipAnalisis(),
      yAlign: "center",
      xAlign: "right",
    };
  }

  function interaccionBarrasHorizontales() {
    return {
      mode: "nearest",
      axis: "y",
      intersect: false,
    };
  }

  function interaccionScatter() {
    return {
      mode: "nearest",
      intersect: false,
    };
  }

  /** Eje TIR: datos truncados en ±20/-5; max del eje un ~10% por encima del tope. */
  function escalaTirValor(opciones = {}) {
    return {
      min: ESCALA_TIR_GRAFICO.min,
      max: tirMaxEjeVisual(),
      title: opciones.title ? { display: true, text: opciones.title } : undefined,
      ticks: {
        stepSize: 5,
        ...opciones.ticks,
      },
      grid: opciones.grid,
    };
  }

  /** Eje drawdown (≤0): grace inferior para que el mínimo no toque el borde. */
  function escalaDrawdown(titulo = "% desde máximo") {
    return {
      max: 0,
      grace: CHART_AXIS.grace,
      title: { display: true, text: titulo },
    };
  }

  function ticksEjeCategoriasBarras(barCount, labels) {
    return {
      offset: true,
      ticks: {
        padding: 8,
        autoSkip: barCount > 24,
        maxTicksLimit: barCount > 24 ? 28 : undefined,
        callback(_value, index) {
          return labels[index] ?? "";
        },
        font: { size: barCount > 30 ? 9 : 10 },
      },
    };
  }

  function valorTirGrafico(row) {
    if (C().esTirMercadoConfiable(row.tirMerc)) return row.tirMerc.valor;
    if (row.tirCalc?.fuente === "referencia" && row.tirCalc.valor != null) return row.tirCalc.valor;
    return row.tirEff;
  }

  function metaTirGrafico(row) {
    const valorReal = valorTirGrafico(row);
    const rangoGrupo = C().rangoTirCarteraPorGrupo(row.tirComparableGrupo);
    const esReferencia = !C().esTirMercadoConfiable(row.tirMerc) && row.tirCalc?.fuente === "referencia";
    const fueraEscalaGrupo =
      valorReal != null && (valorReal < rangoGrupo.min || valorReal > rangoGrupo.max);
    const fueraEscalaGrafico =
      valorReal != null &&
      (valorReal < ESCALA_TIR_GRAFICO.min || valorReal > ESCALA_TIR_GRAFICO.max);
    return { valorReal, rangoGrupo, esReferencia, fueraEscalaGrupo, fueraEscalaGrafico };
  }

  function tirDisplayGrafico(meta) {
    if (meta.valorReal == null) return null;
    return Math.max(ESCALA_TIR_GRAFICO.min, Math.min(ESCALA_TIR_GRAFICO.max, meta.valorReal));
  }

  function labelTickerGrafico(row, meta) {
    let label = row.item.ticker;
    if (meta.esReferencia) label += " (ref.)";
    return label;
  }

  function tooltipTirGrafico(row, meta) {
    const lines = [];
    if (meta.valorReal != null) {
      lines.push(`TIR: ${meta.valorReal.toFixed(2)}%${meta.esReferencia ? " (referencia)" : ""}`);
    }
    if (meta.fueraEscalaGrupo) {
      lines.push(
        `Fuera de rango razonable del grupo (${meta.rangoGrupo.min}% a ${meta.rangoGrupo.max}%) — verificar precio de origen.`
      );
    }
    if (meta.fueraEscalaGrafico) {
      lines.push("⚠ Truncado visualmente en escala -5% a +20%; ver ficha para dato completo.");
    }
    return lines;
  }

  function leyendaGruposTir(barRows) {
    return C()
      .ORDEN_GRUPOS_TIR.filter((g) => barRows.some((r) => r.tirComparableGrupo === g))
      .map((g) => ({
        text: C().GRUPO_TIR_LABELS[g] || g,
        fillStyle: C().COLORES_GRUPO_TIR[g] || C().COLORES_SECTOR.Otros,
        strokeStyle: C().COLORES_GRUPO_TIR[g] || C().COLORES_SECTOR.Otros,
        lineWidth: 0,
      }));
  }

  function actualizarNotaGrafico(id, count, extra) {
    const el = document.getElementById(id);
    if (!el) return;
    if (count > 0) {
      el.textContent = `${count} instrumento(s) fuera de escala o con posible artefacto de cálculo — ver ficha. ${extra || ""}`.trim();
      el.classList.remove("hidden");
    } else {
      el.textContent = extra || "";
      el.classList.toggle("hidden", !extra);
    }
  }

  function initAnalisis(enriquecidos) {
    if (typeof Chart === "undefined") return;

    const barRows = enriquecidos
      .filter((r) => r.tirEff != null && C().esTirComparable(r))
      .sort((a, b) => valorTirGrafico(b) - valorTirGrafico(a));
    const barMetas = barRows.map((r) => metaTirGrafico(r));
    const fueraCount = barMetas.filter((m) => m.fueraEscalaGrupo || m.fueraEscalaGrafico).length;

    destruir("tirBarras");
    const ctx1 = document.getElementById("chart-tir-barras");
    if (ctx1) {
      const barCount = barRows.length;
      const box = ctx1.parentElement;
      if (box) {
        const pxPorBarra = barCount > 30 ? 17 : barCount > 20 ? 16 : 18;
        const h = Math.min(Math.max(barCount * pxPorBarra, 280), 820);
        box.style.height = `${h}px`;
      }
      const labels = barRows.map((r, i) => labelTickerGrafico(r, barMetas[i]));
      const barThickness = barCount > 30 ? 10 : barCount > 20 ? 12 : 16;
      charts.tirBarras = new Chart(ctx1, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "TIR efectiva",
              data: barMetas.map((m) => tirDisplayGrafico(m)),
              backgroundColor: barRows.map(
                (r) => C().COLORES_GRUPO_TIR[r.tirComparableGrupo] || C().COLORES_SECTOR.Otros
              ),
              borderColor: barMetas.map((m) =>
                m.fueraEscalaGrupo || m.fueraEscalaGrafico ? "#92400e" : "transparent"
              ),
              borderWidth: barMetas.map((m) => (m.fueraEscalaGrupo || m.fueraEscalaGrafico ? 2 : 0)),
              barThickness,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          interaction: interaccionBarrasHorizontales(),
          ...layoutGrafico({ right: 12 }),
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                generateLabels: () => leyendaGruposTir(barRows),
                boxWidth: 10,
                font: { size: 11 },
                padding: 8,
              },
              onClick: () => {},
            },
            tooltip: {
              ...tooltipBarrasHorizontales(),
              callbacks: {
                title(ctx) {
                  return barRows[ctx[0].dataIndex]?.item.ticker || "";
                },
                label(ctx) {
                  const row = barRows[ctx.dataIndex];
                  return tooltipTirGrafico(row, barMetas[ctx.dataIndex]);
                },
              },
            },
          },
          scales: {
            x: escalaTirValor({ title: "TIR efectiva (%)" }),
            y: ticksEjeCategoriasBarras(barCount, labels),
          },
        },
      });
      actualizarNotaGrafico(
        "chart-tir-barras-nota",
        fueraCount,
        "Escala fija -5% a +20% (eje hasta ~+22,5%); valores extremos truncados."
      );
    }

    const scatterRows = enriquecidos.filter(
      (r) => r.tirEff != null && r.anosVto != null && C().esTirComparable(r)
    );
    const scatterMetas = scatterRows.map((r) => metaTirGrafico(r));
    const scatterFuera = scatterMetas.filter((m) => m.fueraEscalaGrupo || m.fueraEscalaGrafico).length;
    destruir("scatter");
    const ctx2 = document.getElementById("chart-scatter");
    if (ctx2) {
      const manyPoints = scatterRows.length > 24;
      charts.scatter = new Chart(ctx2, {
        type: "scatter",
        data: {
          datasets: [
            {
              label: "TIR vs plazo",
              data: scatterRows.map((r, i) => ({
                x: r.anosVto,
                y: tirDisplayGrafico(scatterMetas[i]),
                yReal: scatterMetas[i].valorReal,
                ticker: r.item.ticker,
                meta: scatterMetas[i],
              })),
              backgroundColor: scatterRows.map(
                (r) => C().COLORES_GRUPO_TIR[r.tirComparableGrupo] || C().COLORES_SECTOR.Otros
              ),
              borderColor: scatterMetas.map((m) =>
                m.fueraEscalaGrupo || m.fueraEscalaGrafico ? "#92400e" : "transparent"
              ),
              borderWidth: scatterMetas.map((m) => (m.fueraEscalaGrupo || m.fueraEscalaGrafico ? 2 : 0)),
              pointRadius: manyPoints ? 4 : 7,
              pointHoverRadius: manyPoints ? 6 : 9,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: interaccionScatter(),
          ...layoutGrafico(),
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                generateLabels: () => leyendaGruposTir(scatterRows),
                boxWidth: 10,
                font: { size: 11 },
                padding: 8,
              },
              onClick: () => {},
            },
            tooltip: {
              ...tooltipAnalisis(),
              callbacks: {
                title(ctx) {
                  return ctx.raw.ticker || "";
                },
                label(ctx) {
                  const row = scatterRows.find((r) => r.item.ticker === ctx.raw.ticker);
                  if (!row) return "";
                  const lines = [`Plazo: ${ctx.raw.x.toFixed(1)} años`];
                  lines.push(...tooltipTirGrafico(row, ctx.raw.meta));
                  return lines;
                },
              },
            },
          },
          scales: {
            x: { title: { display: true, text: "Años al vencimiento" }, grace: CHART_AXIS.grace },
            y: escalaTirValor({ title: "TIR efectiva (%)" }),
          },
        },
      });
      actualizarNotaGrafico(
        "chart-scatter-nota",
        scatterFuera,
        "Eje Y -5% a +20% (tope visual ~+22,5%)."
      );
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
        ...layoutGrafico(),
        scales: {
          x: { ticks: { maxRotation: 40, autoSkip: true } },
          y: escalaDrawdown("% desde máximo"),
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

  function renderFichaCharts(ticker, row) {
    if (typeof Chart === "undefined") return;
    const info = row?.info;
    const serie = H()?.seriePrecioChart(ticker) || [];
    const dd = H()?.serieDrawdown(ticker) || [];
    const durHist = info ? C().serieDuracionModificadaHistorica(info, ticker) : { ok: false, puntos: [] };
    const bloqueoDur = info ? C().motivoDuracionNoDisponible(info) : null;

    destruir("fichaPrecioDuracion");
    destruir("fichaDrawdown");

    const ctxCombo = document.getElementById("ficha-chart-precio-duracion");
    const ctxDd = document.getElementById("ficha-chart-drawdown");
    const emptyEl = document.getElementById("ficha-charts-empty");
    const gridEl = document.querySelector(".ficha-charts-grid");
    const durNaEl = document.getElementById("ficha-duracion-na");

    const fichaChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: CHART_AXIS.layout.padding },
    };

    if (!serie.length) {
      if (emptyEl) emptyEl.classList.remove("hidden");
      if (gridEl) gridEl.classList.add("hidden");
      return;
    }
    if (emptyEl) emptyEl.classList.add("hidden");
    if (gridEl) gridEl.classList.remove("hidden");

    if (durNaEl) {
      if (bloqueoDur) {
        durNaEl.textContent = bloqueoDur;
        durNaEl.classList.remove("hidden");
      } else if (!durHist.ok && durHist.motivo) {
        durNaEl.textContent = durHist.motivo;
        durNaEl.classList.remove("hidden");
      } else {
        durNaEl.classList.add("hidden");
      }
    }

    if (ctxCombo) {
      const labels = serie.map((p) => p.fecha);
      const datasets = [
        {
          label: `${ticker} precio ref.`,
          data: serie.map((p) => p.precio),
          borderColor: "#1e4d8c",
          backgroundColor: "rgba(30,77,140,0.06)",
          tension: 0.2,
          fill: false,
          pointRadius: 0,
          pointHitRadius: 8,
          yAxisID: "y",
        },
      ];
      if (durHist.ok) {
        const durByFecha = new Map(durHist.puntos.map((p) => [p.fecha, p.duracion]));
        datasets.push({
          label: "Duración modificada (años)",
          data: labels.map((f) => durByFecha.get(f) ?? null),
          borderColor: "#0d7a4a",
          backgroundColor: "rgba(13,122,74,0.08)",
          tension: 0.25,
          fill: false,
          pointRadius: 0,
          pointHitRadius: 8,
          yAxisID: "y1",
          spanGaps: true,
        });
      }
      charts.fichaPrecioDuracion = new Chart(ctxCombo, {
        type: "line",
        data: { labels, datasets },
        options: {
          ...fichaChartOptions,
          interaction: { mode: "index", intersect: false },
          plugins: {
            tooltip: {
              callbacks: {
                label(ctx) {
                  const v = ctx.parsed.y;
                  if (v == null) return `${ctx.dataset.label}: —`;
                  if (ctx.dataset.yAxisID === "y1") return `Duración mod.: ${v.toFixed(2)} años`;
                  return `Precio: ${v.toFixed(2)}`;
                },
              },
            },
          },
          scales: {
            x: {
              offset: true,
              ticks: { maxRotation: 40, autoSkip: true, maxTicksLimit: 8 },
            },
            y: {
              position: "left",
              title: { display: true, text: "Precio ref." },
              grace: CHART_AXIS.grace,
            },
            y1: {
              position: "right",
              display: durHist.ok,
              title: { display: true, text: "Duración mod. (años)" },
              grace: CHART_AXIS.grace,
              grid: { drawOnChartArea: false },
            },
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
            y: escalaDrawdown(),
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
