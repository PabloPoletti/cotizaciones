/**
 * Panel principal — UI, filtros, pestañas y calculadora.
 */
(function () {
  "use strict";

  const REPO_OWNER = "PabloPoletti";
  const REPO_NAME = "cotizaciones";
  const WORKFLOW_FILE = "actualizar.yml";
  const STORAGE_KEY_TOKEN = "cotizaciones_github_pat";
  const STORAGE_KEY_REPO = "cotizaciones_github_repo";
  const CFG = window.CotizConfig || {};
  const DISPATCH_COOLDOWN_MS = CFG.DISPATCH_COOLDOWN_MS || 300000;
  const STORAGE_KEY_WORKER = CFG.STORAGE_KEY_WORKER_URL || "cotizaciones_worker_url";

  const C = window.CotizCore;
  const A = window.CotizAnalytics;
  const S = window.CotizStorage;
  const CH = window.CotizCharts;
  const F = window.CotizFicha;

  let enriquecidos = [];
  let semaforos = new Map();
  let fichaTicker = null;
  let filtros = {
    busqueda: "",
    tipo: "todos",
    moneda: "todos",
    subtipo: "todos",
    confiabilidad: "todos",
    orden: "ticker",
    ordenDir: "asc",
  };
  let vistaMode = "cards";
  let calcSoloPreset = false;
  let tabsInited = { analisis: false, resumen: false, observaciones: false };

  const elUltimaAct = document.getElementById("ultima-actualizacion");
  const elTipoCambioMeta = document.getElementById("tipo-cambio-meta");
  const elAlertaFetchStatus = document.getElementById("alerta-fetch-status");
  const elAlertaAntiguedad = document.getElementById("alerta-antiguedad");
  const elAlertaError = document.getElementById("alerta-error");
  const elSectores = document.getElementById("sectores-container");
  const elTablaContainer = document.getElementById("tabla-container");
  const elCotizListaView = document.getElementById("cotiz-lista-view");
  const elFichaPanel = document.getElementById("ficha-instrumento");
  const elFichaContent = document.getElementById("ficha-content");
  const elFichaFiltros = document.getElementById("ficha-filtros-activos");
  const elBtnFichaVolver = document.getElementById("btn-ficha-volver");
  const elLoading = document.getElementById("loading");
  const elCotizToolbar = document.getElementById("cotiz-toolbar");
  const elMiniKpi = document.getElementById("cotiz-mini-kpi");
  const elCalcBody = document.getElementById("calc-body");
  const elCapital = document.getElementById("capital-usd");
  const elTirPonderada = document.getElementById("tir-ponderada");
  const elRentaAnual = document.getElementById("renta-anual");
  const elSumaPct = document.getElementById("suma-porcentajes");
  const elCalcWarning = document.getElementById("calc-warning");
  const elBtnActualizar = document.getElementById("btn-actualizar");
  const elBtnRecargar = document.getElementById("btn-recargar");
  const elInputToken = document.getElementById("github-token");
  const elInputRepo = document.getElementById("github-repo");
  const elBtnGuardarConfig = document.getElementById("btn-guardar-config");
  const elBtnProbarToken = document.getElementById("btn-probar-token");
  const elStatusActualizar = document.getElementById("status-actualizar");
  const elInputWorkerUrl = document.getElementById("worker-url");
  const elBtnGuardarWorker = document.getElementById("btn-guardar-worker");

  function renderizarEstadoFetch() {
    const cot = C.state.cotizaciones;
    if (!elAlertaFetchStatus || !cot) return;
    const status = cot.fetch_status;
    const mensaje = cot.fetch_mensaje || "";
    elAlertaFetchStatus.className = "alert hidden";
    if (!status) return;
    elAlertaFetchStatus.textContent = mensaje;
    elAlertaFetchStatus.classList.remove("hidden");
    elAlertaFetchStatus.classList.add(
      status === "error"
        ? "alert--fetch-error"
        : status === "ok"
          ? "alert--info"
          : "alert--warning"
    );
  }

  function formatearArs(valor) {
    if (valor == null || Number.isNaN(valor)) return "—";
    return new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(valor);
  }

  function formatearArsConSimbolo(valor) {
    if (valor == null || Number.isNaN(valor)) return "—";
    return `$${formatearArs(valor)}`;
  }

  function parCompraVenta(compra, venta) {
    if (compra == null && venta == null) return null;
    const c = compra != null ? formatearArsConSimbolo(compra) : "—";
    const v = venta != null ? formatearArsConSimbolo(venta) : "—";
    return `${c} / ${v}`;
  }

  function renderizarTipoCambio() {
    if (!elTipoCambioMeta) return;
    const tc = C.state.cotizaciones?.tipo_cambio;
    if (!tc || tc.error) {
      elTipoCambioMeta.classList.add("hidden");
      elTipoCambioMeta.textContent = "";
      return;
    }
    const partes = [];
    const parOficial = parCompraVenta(tc.oficial?.compra_ars, tc.oficial?.venta_ars);
    if (parOficial) partes.push(`Oficial: ${parOficial}`);
    const parMep = parCompraVenta(tc.mep?.compra_ars, tc.mep?.venta_ars);
    if (parMep) partes.push(`MEP: ${parMep}`);
    if (!partes.length) {
      elTipoCambioMeta.classList.add("hidden");
      return;
    }
    const ts = tc.timestamp_consulta ? C.formatearFecha(tc.timestamp_consulta) : "";
    elTipoCambioMeta.textContent = `${partes.join(" · ")}${ts ? ` — ${ts}` : ""}`;
    elTipoCambioMeta.classList.remove("hidden");
  }

  function semaforoHtml(ticker) {
    const s = semaforos.get(ticker);
    if (!s) return `<span class="semaforo semaforo--na" title="Sin TIR para comparar">○</span>`;
    return `<span class="semaforo semaforo--${s.nivel}" title="${C.escapeHtml(s.label)} (vs sector)">●</span>`;
  }

  function badgesHtml(row) {
    const moneda = row.moneda || row.info.moneda || "USD";
    const tipo = row.categoria || C.categoriaDe(row.info);
    const amort = row.esBullet ? "Bullet" : "Amort. parcial";
    const liq = window.CotizHistorico?.badgeLiquidezHtml(row.item.ticker) || "";
    const confirm = C.badgeConfirmacionPrecioHtml(row.item);
    return `
      ${liq}
      ${confirm}
      <span class="badge badge--moneda">${C.escapeHtml(moneda)}</span>
      <span class="badge badge--tipo">${C.escapeHtml(tipo)}</span>
      <span class="badge badge--amort ${row.esBullet ? "" : "badge--warn"}">${C.escapeHtml(amort)}</span>
    `;
  }

  function metricasHistoricoHtml(row) {
    const hp = row.hp;
    if (!hp) return "";
    const H = window.CotizHistorico;
    return `
      <div class="inst-card__metric">
        <span class="label">Var. 7d / 30d</span>
        <strong class="num">${H?.formatearPct(hp.var_7d_pct) ?? "—"} / ${H?.formatearPct(hp.var_30d_pct) ?? "—"}</strong>
      </div>
      <div class="inst-card__metric">
        <span class="label">Volat. 30d</span>
        <strong class="num">${hp.volatilidad_30d_pct != null ? hp.volatilidad_30d_pct.toFixed(2) + "%" : "—"}</strong>
        <span class="meta">Riesgo precio</span>
      </div>
    `;
  }

  function buildCard(row) {
    const { item, info } = row;
    const varFmt = C.formatearVariacion(item.variacion_pct);
    const cardId = `card-${item.ticker}`;

    return `
      <article class="inst-card ${item.error ? "inst-card--error" : ""}" data-ticker="${C.escapeHtml(item.ticker)}">
        <header class="inst-card__head">
          <div class="inst-card__title">
            ${semaforoHtml(item.ticker)}
            <span class="ticker">${C.escapeHtml(item.ticker)}</span>
            <span class="inst-card__name">${C.escapeHtml(item.nombre || info.nombre || item.ticker)}</span>
          </div>
          <div class="inst-card__badges">${badgesHtml(row)}</div>
        </header>
        <div class="inst-card__body">
          <div class="inst-card__metric">
            <span class="label">Precio</span>
            <strong class="num">${item.error ? C.escapeHtml(item.mensaje_error || "Sin dato") : C.formatearPrecioConTipo(item)}</strong>
            <span class="meta">${C.escapeHtml(C.etiquetaPrecioTipo(item))}</span>
          </div>
          <div class="inst-card__metric">
            <span class="label">Var. %</span>
            <strong class="num ${varFmt.clase}">${varFmt.texto}</strong>
          </div>
          <div class="inst-card__metric inst-card__metric--wide">
            <span class="label">TIR ref. / mercado</span>
            <div>${C.formatearCeldaTir(info, item)}</div>
          </div>
          ${metricasHistoricoHtml(row)}
        </div>
        <details class="inst-card__detail">
          <summary>Ver detalle</summary>
          <dl class="inst-dl">
            <dt>Sector</dt><dd>${C.escapeHtml(row.sector)}</dd>
            <dt>Liquidez (panel)</dt><dd>${C.escapeHtml(row.liquidez?.label || "—")}${row.hp?.volumen_promedio ? ` — vol. prom. ${window.CotizHistorico?.formatearVolumen(row.hp.volumen_promedio)}` : ""}</dd>
            <dt>Var. desde inicio serie</dt><dd>${window.CotizHistorico?.formatearPct(row.hp?.var_desde_inicio_pct) ?? "—"}</dd>
            <dt>Drawdown máx. ventana</dt><dd>${row.hp?.drawdown_max_pct != null ? row.hp.drawdown_max_pct.toFixed(2) + "%" : "—"}</dd>
            <dt>Vencimiento</dt><dd>${C.escapeHtml(C.formatearFechaCorta(info.vencimiento))}</dd>
            <dt>Cupón</dt><dd>${C.escapeHtml(info.cupon || "—")}</dd>
            <dt>Amortización</dt><dd>${C.escapeHtml(info.amortizacion || "—")}</dd>
            <dt>Ley</dt><dd>${C.escapeHtml(info.ley || "—")}</dd>
            <dt>TIR rango ref.</dt><dd>${C.escapeHtml(info.tir_rango || "—")}</dd>
            ${info.notas ? `<dt>Notas</dt><dd>${C.escapeHtml(info.notas)}</dd>` : ""}
          </dl>
        </details>
        <footer class="inst-card__foot">
          <button type="button" class="btn btn--sm btn--ficha" data-ficha-ticker="${C.escapeHtml(item.ticker)}">Ver ficha completa</button>
        </footer>
      </article>
    `;
  }

  function renderCards(rows) {
    elSectores.innerHTML = "";
    const porSector = new Map();
    for (const row of rows) {
      if (!porSector.has(row.sector)) porSector.set(row.sector, []);
      porSector.get(row.sector).push(row);
    }
    for (const sector of C.ORDEN_SECTORES) {
      const items = porSector.get(sector);
      if (!items?.length) continue;
      const section = document.createElement("section");
      section.className = "sector";
      section.innerHTML = `<h2 class="sector__title">${C.escapeHtml(sector)} <span class="sector__count">(${items.length})</span></h2>`;
      const grid = document.createElement("div");
      grid.className = "cards-grid";
      grid.innerHTML = items.map(buildCard).join("");
      section.appendChild(grid);
      elSectores.appendChild(section);
    }
    for (const [sector, items] of porSector) {
      if (C.ORDEN_SECTORES.includes(sector)) continue;
      const section = document.createElement("section");
      section.className = "sector";
      section.innerHTML = `<h2 class="sector__title">${C.escapeHtml(sector)} (${items.length})</h2>`;
      const grid = document.createElement("div");
      grid.className = "cards-grid";
      grid.innerHTML = items.map(buildCard).join("");
      section.appendChild(grid);
      elSectores.appendChild(section);
    }
  }

  function renderTabla(rows) {
    const thead = `
      <thead><tr>
        <th data-sort="ticker">Ticker</th>
        <th>Nombre</th>
        <th class="num">Precio</th>
        <th class="num">Var.%</th>
        <th class="num">Var.7d</th>
        <th>Liq.</th>
        <th class="num">TIR</th>
        <th>Venc.</th>
        <th>Sector</th>
        <th>Riesgo</th>
        <th></th>
      </tr></thead>`;
    const tbody = rows
      .map((row) => {
        const { item, info } = row;
        const varFmt = C.formatearVariacion(item.variacion_pct);
        const liq = row.liquidez?.label || "—";
        const var7 = window.CotizHistorico?.formatearPct(row.hp?.var_7d_pct) ?? "—";
        return `<tr class="${item.error ? "error-row" : ""} inst-row" data-ticker="${C.escapeHtml(item.ticker)}" role="button" tabindex="0">
          <td class="ticker">${C.escapeHtml(item.ticker)}</td>
          <td>${C.escapeHtml(item.nombre || info.nombre || "")}</td>
          <td class="num">${item.error ? "—" : C.formatearPrecioConTipo(item)}</td>
          <td class="num ${varFmt.clase}">${varFmt.texto}</td>
          <td class="num">${var7}</td>
          <td>${C.escapeHtml(liq)}</td>
          <td class="num tir-cell">${C.formatearCeldaTir(info, item)}</td>
          <td>${C.escapeHtml(C.formatearFechaCorta(info.vencimiento))}</td>
          <td>${C.escapeHtml(row.sector)}</td>
          <td>${semaforoHtml(item.ticker)}</td>
          <td><button type="button" class="btn btn--sm btn--ficha" data-ficha-ticker="${C.escapeHtml(item.ticker)}">Ficha</button></td>
        </tr>`;
      })
      .join("");
    elTablaContainer.innerHTML = `<div class="table-wrap sector"><table>${thead}<tbody>${tbody}</tbody></table></div>`;
  }

  function renderMiniKpi(rows) {
    const kpis = A.calcularKPIs(rows);
    elMiniKpi.innerHTML = `
      <div class="kpi-chip"><span>Instrumentos</span><strong>${rows.length}</strong></div>
      <div class="kpi-chip"><span>ON</span><strong>${kpis.countOn}</strong></div>
      <div class="kpi-chip"><span>Soberanos</span><strong>${kpis.countSoberano}</strong></div>
      <div class="kpi-chip"><span>TIR prom.</span><strong>${kpis.tirProm != null ? kpis.tirProm.toFixed(2) + "%" : "—"}</strong></div>
    `;
  }

  function poblarFiltroSubtipo() {
    const wrap = document.getElementById("filtro-subtipo-wrap");
    const sel = document.getElementById("filtro-subtipo");
    const label = document.getElementById("filtro-subtipo-label");
    if (!wrap || !sel) return;

    const tipo = filtros.tipo;
    filtros.subtipo = "todos";

    let options = [];
    let show = false;
    let labelText = "Subfiltro";

    if (tipo === "on") {
      show = true;
      labelText = "Sector";
      options = [
        ...new Set(
          enriquecidos.filter((r) => C.categoriaDe(r.info) === "ON corporativa").map((r) => r.sector)
        ),
      ].sort();
    } else if (tipo === "Provincial") {
      show = true;
      labelText = "Provincia / emisor";
      options = [
        ...new Set(enriquecidos.filter((r) => C.categoriaDe(r.info) === "Provincial").map((r) => r.sector)),
      ].sort();
    } else if (tipo === "Soberano USD" || tipo === "Soberano ARS" || tipo === "soberano") {
      show = true;
      labelText = "Ley aplicable";
      options = [
        ...new Set(
          enriquecidos
            .filter((r) => {
              const cat = C.categoriaDe(r.info);
              return cat.startsWith("Soberano") || C.esSoberano(r.info);
            })
            .map((r) => r.info.ley)
            .filter(Boolean)
        ),
      ].sort();
    }

    wrap.classList.toggle("hidden", !show);
    if (label) label.textContent = labelText;
    sel.innerHTML =
      `<option value="todos">Todos</option>` +
      options.map((o) => `<option value="${C.escapeHtml(o)}">${C.escapeHtml(o)}</option>`).join("");
  }

  function describeFiltrosActivos() {
    const partes = [];
    if (filtros.busqueda) partes.push(`búsqueda «${filtros.busqueda}»`);
    if (filtros.tipo && filtros.tipo !== "todos") partes.push(`tipo ${filtros.tipo}`);
    if (filtros.moneda && filtros.moneda !== "todos") partes.push(`moneda ${filtros.moneda}`);
    if (filtros.subtipo && filtros.subtipo !== "todos") partes.push(`${filtros.subtipo}`);
    if (filtros.confiabilidad && filtros.confiabilidad !== "todos") {
      const labels = {
        confirmados: "confirmados (2 fuentes)",
        "liquidez-alta": "liquidez alta",
        ambos: "confirmados + liquidez alta",
      };
      partes.push(labels[filtros.confiabilidad] || filtros.confiabilidad);
    }
    return partes.length ? `Filtros: ${partes.join(" · ")}` : "Sin filtros activos";
  }

  function abrirFicha(ticker) {
    const row = enriquecidos.find((r) => r.item.ticker === ticker);
    if (!row || !F) return;
    fichaTicker = ticker;
    elCotizListaView?.classList.add("hidden");
    elFichaPanel?.classList.remove("hidden");
    elFichaPanel?.setAttribute("aria-hidden", "false");
    if (elFichaFiltros) elFichaFiltros.textContent = describeFiltrosActivos();
    if (elFichaContent) {
      elFichaContent.innerHTML = F.renderFicha(row, {
        semaforoHtml,
        badgesHtml,
      });
    }
    CH.renderFichaCharts(ticker);
    elFichaPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cerrarFicha() {
    fichaTicker = null;
    elFichaPanel?.classList.add("hidden");
    elFichaPanel?.setAttribute("aria-hidden", "true");
    elCotizListaView?.classList.remove("hidden");
    if (elFichaContent) elFichaContent.innerHTML = "";
  }

  function initFichaNavigation() {
    elBtnFichaVolver?.addEventListener("click", cerrarFicha);

    elSectores?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ficha-ticker]");
      if (btn) {
        e.preventDefault();
        abrirFicha(btn.dataset.fichaTicker);
        return;
      }
      const card = e.target.closest(".inst-card");
      if (card && !e.target.closest("details") && !e.target.closest("button")) {
        abrirFicha(card.dataset.ticker);
      }
    });

    elTablaContainer?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ficha-ticker]");
      if (btn) {
        e.stopPropagation();
        abrirFicha(btn.dataset.fichaTicker);
        return;
      }
      const row = e.target.closest("tr[data-ticker]");
      if (row) abrirFicha(row.dataset.ticker);
    });

    elTablaContainer?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const row = e.target.closest("tr[data-ticker]");
      if (row) {
        e.preventDefault();
        abrirFicha(row.dataset.ticker);
      }
    });
  }

  function renderCotizacionesView() {
    const rows = C.filtrarYOrdenar(enriquecidos, filtros);
    renderMiniKpi(rows);
    if (vistaMode === "cards") {
      elSectores.classList.remove("hidden");
      elTablaContainer.classList.add("hidden");
      renderCards(rows);
    } else {
      elSectores.classList.add("hidden");
      elTablaContainer.classList.remove("hidden");
      renderTabla(rows);
    }
  }

  function esInstrumentoArsReferencia(row) {
    const moneda = (row.moneda || row.info.moneda || "").toUpperCase();
    if (!moneda.startsWith("ARS")) return false;
    const nombre = (row.item.nombre || row.info.nombre || "").toLowerCase();
    return nombre.includes("lecap") || nombre.includes("boncer");
  }

  function mepVentaReferencia() {
    const tc = C.state.cotizaciones?.tipo_cambio;
    const v = tc?.mep?.venta_ars;
    return v != null && v > 0 ? v : null;
  }

  function renderConversionArsUsd(enriquecidos) {
    const seccion = document.getElementById("seccion-conversion-ars");
    const tbody = document.querySelector("#tabla-conversion-ars tbody");
    if (!seccion || !tbody) return;

    const mep = mepVentaReferencia();
    const filas = enriquecidos
      .filter(esInstrumentoArsReferencia)
      .filter((r) => r.item.precio != null && !r.item.error)
      .sort((a, b) => a.item.ticker.localeCompare(b.item.ticker));

    if (!mep || !filas.length) {
      seccion.classList.add("hidden");
      tbody.innerHTML = "";
      return;
    }

    seccion.classList.remove("hidden");
    tbody.innerHTML = filas
      .map((row) => {
        const precioArs = row.item.precio;
        const usdRef = precioArs / mep;
        return `<tr>
          <td class="ticker">${C.escapeHtml(row.item.ticker)}</td>
          <td>${C.escapeHtml(row.item.nombre || row.info.nombre || "")}</td>
          <td class="num">${formatearArs(precioArs)} ARS</td>
          <td class="num">≈ ${C.formatearPrecio(usdRef)} USD <span class="meta">ref. MEP</span></td>
        </tr>`;
      })
      .join("");
  }

  function renderResumen() {
    const porMoneda = A.calcularKPIsPorMoneda(enriquecidos);
    const el = document.getElementById("resumen-kpis");
    if (el) {
      const monedaCards = Object.values(porMoneda.porMoneda)
        .sort((a, b) => a.moneda.localeCompare(b.moneda))
        .map(
          (k) => `
        <div class="kpi-card kpi-card--moneda">
          <span>TIR prom. (${C.escapeHtml(k.moneda)})</span>
          <strong>${k.tirProm != null ? k.tirProm.toFixed(2) + "%" : "—"}</strong>
          <small>${k.count} instrumento(s)</small>
        </div>`
        )
        .join("");
      el.innerHTML = `
        ${monedaCards}
        <div class="kpi-card"><span>Instrumentos totales</span><strong>${porMoneda.total}</strong></div>
        <div class="kpi-card"><span>Monedas distintas</span><strong>${Object.keys(porMoneda.porMoneda).length}</strong></div>
      `;
    }
    const tbody = document.querySelector("#tabla-ranking-sector tbody");
    if (tbody) {
      tbody.innerHTML = A.mejorTirPorSector(enriquecidos)
        .map(
          (r) => `<tr>
            <td>${C.escapeHtml(r.sector)}</td>
            <td class="ticker">${C.escapeHtml(r.ticker)}</td>
            <td class="num">${r.tirEff.toFixed(2)}%</td>
            <td>${C.escapeHtml(C.formatearFechaCorta(r.vencimiento))}</td>
          </tr>`
        )
        .join("");
    }
    const ulV = document.getElementById("lista-vencimientos");
    if (ulV) {
      ulV.innerHTML = A.proximosVencimientos(enriquecidos)
        .map(
          (v) =>
            `<li><strong>${C.escapeHtml(v.ticker)}</strong> — ${C.escapeHtml(C.formatearFechaCorta(v.vencimiento))} <span class="meta">${C.escapeHtml(v.nombre || "")}</span></li>`
        )
        .join("");
    }
    const ulC = document.getElementById("lista-cupones");
    if (ulC) {
      ulC.innerHTML = A.proximosCupones(enriquecidos)
        .map(
          (c) =>
            `<li><strong>${C.escapeHtml(c.ticker)}</strong> — ${c.fecha.toLocaleDateString("es-AR")} <span class="meta">${C.escapeHtml(c.cupon || "")}</span></li>`
        )
        .join("");
    }
    renderConversionArsUsd(enriquecidos);
  }

  function renderObservaciones() {
    const el = document.getElementById("observaciones-list");
    if (!el) return;
    const items = A.generarObservaciones(enriquecidos);
    el.innerHTML = items.map((html) => `<div class="obs-item">${html}</div>`).join("");
  }

  function actualizarVisibilidadFilasCalc() {
    document.querySelectorAll("#calc-body tr").forEach((tr) => {
      const input = tr.querySelector(".pct-input");
      const pct = parseFloat(input?.value) || 0;
      if (calcSoloPreset) {
        tr.classList.toggle("calc-row--hidden", pct <= 0);
      } else {
        tr.classList.remove("calc-row--hidden");
      }
    });
  }

  function mostrarTodosInstrumentosCalc() {
    calcSoloPreset = false;
    document.getElementById("btn-calc-mostrar-todos")?.classList.add("hidden");
    actualizarVisibilidadFilasCalc();
  }

  function renderizarCalculadora() {
    const cot = C.state.cotizaciones;
    if (!cot?.instrumentos) return;
    calcSoloPreset = false;
    document.getElementById("btn-calc-mostrar-todos")?.classList.add("hidden");
    elCalcBody.innerHTML = "";
    const instrumentos = cot.instrumentos.filter((i) => !i.error && i.precio != null);

    for (const item of instrumentos) {
      const info = C.infoDeTicker(item.ticker);
      const tirCalc = C.tirParaCalculo(info, item);
      const tirMercado = C.calcularTirMercado(item.precio, info);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${C.escapeHtml(item.nombre || info.nombre || item.ticker)}</td>
        <td class="ticker">${C.escapeHtml(item.ticker)}</td>
        <td class="num tir-cell">${C.formatearCeldaTir(info, item)}</td>
        <td class="num">
          <input type="number" min="0" max="100" step="0.1" value="0"
                 data-ticker="${C.escapeHtml(item.ticker)}"
                 data-tir-ref="${info.tir_referencia ?? ""}"
                 data-tir-merc="${tirMercado.valor ?? ""}"
                 data-tir-usada="${tirCalc.valor ?? ""}"
                 class="pct-input">
        </td>
        <td class="num monto-asignado" data-ticker="${C.escapeHtml(item.ticker)}">—</td>`;
      elCalcBody.appendChild(tr);
    }

    document.querySelectorAll(".pct-input").forEach((input) => {
      input.addEventListener("input", recalcularCartera);
    });
    const saved = S.cargarCartera();
    if (saved?.pesos) {
      if (saved.capital != null && elCapital) elCapital.value = saved.capital;
      document.querySelectorAll(".pct-input").forEach((input) => {
        const p = saved.pesos[input.dataset.ticker];
        if (p != null) input.value = Number(p).toFixed(1);
      });
    }
    recalcularCartera();
  }

  function recalcularCartera() {
    const capital = parseFloat(elCapital?.value) || 0;
    const inputs = document.querySelectorAll(".pct-input");
    const warnings = [];
    let sumaPct = 0;
    let tirPonderada = 0;
    let tirPonderadaRef = 0;
    let tieneTir = false;
    let tieneTirRef = false;
    let usaMercado = false;
    const pieLabels = [];
    const pieData = [];

    inputs.forEach((input) => {
      const pct = parseFloat(input.value) || 0;
      const tirUsada = parseFloat(input.dataset.tirUsada);
      const tirRef = parseFloat(input.dataset.tirRef);
      sumaPct += pct;
      const monto = (capital * pct) / 100;
      const celdaMonto = document.querySelector(`.monto-asignado[data-ticker="${input.dataset.ticker}"]`);
      if (celdaMonto) celdaMonto.textContent = capital > 0 ? C.formatearPrecio(monto) + " USD" : "—";
      if (!Number.isNaN(tirUsada) && pct > 0) {
        tirPonderada += (pct / 100) * tirUsada;
        tieneTir = true;
        if (input.dataset.tirMerc) usaMercado = true;
      }
      if (!Number.isNaN(tirRef) && pct > 0) tirPonderadaRef += (pct / 100) * tirRef;
      if (pct > 0) {
        pieLabels.push(input.dataset.ticker);
        pieData.push(pct);
      }
    });

    elSumaPct.textContent = sumaPct.toFixed(1) + "%";
    let tirAjustada = null;
    if (tieneTir && sumaPct > 0) {
      const factor = sumaPct / 100;
      tirAjustada = tirPonderada / factor;
      elTirPonderada.textContent = tirAjustada.toFixed(2) + "%";
      elRentaAnual.textContent = C.formatearPrecio((capital * tirAjustada) / 100) + " USD";
    } else {
      elTirPonderada.textContent = "—";
      elRentaAnual.textContent = "—";
    }

    if (sumaPct > 100.01) warnings.push("La suma de porcentajes supera el 100%.");
    if (capital > 0 && sumaPct === 0) warnings.push("Asigná al menos un porcentaje.");

    const notaMercado = document.getElementById("calc-nota-tir");
    if (notaMercado) {
      if (usaMercado && tieneTir) {
        notaMercado.textContent = "TIR ponderada con TIR mercado (aprox.) cuando está disponible.";
        notaMercado.classList.remove("hidden");
      } else {
        notaMercado.classList.add("hidden");
      }
    }

    if (warnings.length) {
      elCalcWarning.textContent = warnings.join(" ");
      elCalcWarning.classList.remove("hidden");
    } else {
      elCalcWarning.classList.add("hidden");
    }

    if (pieLabels.length && typeof Chart !== "undefined") {
      CH.initCarteraPie(pieLabels, pieData);
    }

    const horizontes = [3, 5, 10];
    const tbody = document.getElementById("proyeccion-body");
    if (tbody && tirAjustada != null && capital > 0) {
      const proyData = horizontes.map((a) => A.proyeccionCompuesta(capital, tirAjustada, a));
      tbody.innerHTML = horizontes
        .map(
          (a, i) =>
            `<tr><td>${a} años</td><td class="num">${C.formatearPrecio(proyData[i])}</td></tr>`
        )
        .join("");
      CH.initProyeccion(
        horizontes.map((h) => `${h}a`),
        proyData
      );
    } else if (tbody) {
      tbody.innerHTML = "";
    }

    actualizarVisibilidadFilasCalc();
  }

  function obtenerResumenCartera() {
    const capital = parseFloat(elCapital?.value) || 0;
    const lineas = [];
    let sumaPct = 0;
    let tirPonderada = 0;
    let tieneTir = false;

    document.querySelectorAll(".pct-input").forEach((input) => {
      const pct = parseFloat(input.value) || 0;
      if (pct <= 0) return;
      const tirUsada = parseFloat(input.dataset.tirUsada);
      sumaPct += pct;
      if (!Number.isNaN(tirUsada)) {
        tirPonderada += (pct / 100) * tirUsada;
        tieneTir = true;
      }
      lineas.push({
        ticker: input.dataset.ticker,
        pct,
        monto: (capital * pct) / 100,
        tirUsada: Number.isNaN(tirUsada) ? null : tirUsada,
      });
    });

    let tirFinal = null;
    let rentaAnual = null;
    if (tieneTir && sumaPct > 0) {
      tirFinal = tirPonderada / (sumaPct / 100);
      rentaAnual = (capital * tirFinal) / 100;
    }

    return {
      fechaIso: new Date().toISOString(),
      fechaLocal: new Date().toLocaleString("es-AR"),
      capital,
      sumaPct,
      tirPonderada: tirFinal,
      rentaAnual,
      lineas,
    };
  }

  function formatearResumenCarteraTexto(resumen) {
    const lines = [
      "Cartera — Panel Cotizaciones",
      `Fecha: ${resumen.fechaLocal}`,
      `Capital total: ${C.formatearPrecio(resumen.capital)} USD`,
      `Suma asignada: ${resumen.sumaPct.toFixed(1)}%`,
      `TIR ponderada: ${resumen.tirPonderada != null ? resumen.tirPonderada.toFixed(2) + "%" : "—"}`,
      `Renta anual estimada: ${resumen.rentaAnual != null ? C.formatearPrecio(resumen.rentaAnual) + " USD" : "—"}`,
      "",
      "Instrumentos:",
    ];
    if (!resumen.lineas.length) {
      lines.push("  (sin asignaciones)");
    } else {
      resumen.lineas.forEach((l) => {
        lines.push(
          `  ${l.ticker}: ${l.pct.toFixed(1)}% → ${C.formatearPrecio(l.monto)} USD` +
            (l.tirUsada != null ? ` (TIR ${l.tirUsada.toFixed(2)}%)` : "")
        );
      });
    }
    lines.push("", "Referencia ilustrativa — no es asesoramiento ni orden de operación.");
    return lines.join("\n");
  }

  function exportarCarteraCsv() {
    const resumen = obtenerResumenCartera();
    if (!resumen.lineas.length) {
      alert("Asigná al menos un porcentaje antes de exportar.");
      return;
    }
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [
      ["campo", "valor"].join(","),
      ["fecha", esc(resumen.fechaLocal)].join(","),
      ["capital_usd", resumen.capital].join(","),
      ["suma_pct", resumen.sumaPct.toFixed(2)].join(","),
      ["tir_ponderada_pct", resumen.tirPonderada != null ? resumen.tirPonderada.toFixed(4) : ""].join(","),
      ["renta_anual_estimada_usd", resumen.rentaAnual != null ? resumen.rentaAnual.toFixed(2) : ""].join(","),
      [],
      ["ticker", "pct", "monto_usd", "tir_usada_pct"].join(","),
    ];
    resumen.lineas.forEach((l) => {
      rows.push(
        [l.ticker, l.pct.toFixed(2), l.monto.toFixed(2), l.tirUsada != null ? l.tirUsada.toFixed(4) : ""].join(",")
      );
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cartera-cotizaciones-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copiarResumenCartera() {
    const resumen = obtenerResumenCartera();
    if (!resumen.lineas.length) {
      alert("Asigná al menos un porcentaje antes de copiar.");
      return;
    }
    const texto = formatearResumenCarteraTexto(resumen);
    try {
      await navigator.clipboard.writeText(texto);
      alert("Resumen copiado al portapapeles.");
    } catch {
      prompt("Copiá este resumen:", texto);
    }
  }

  function aplicarPesosEnInputs(pesos) {
    document.querySelectorAll(".pct-input").forEach((input) => {
      input.value = "0";
    });
    const entries = Object.entries(pesos).filter(([, p]) => p > 0);
    if (!entries.length) return;

    let asignado = 0;
    entries.forEach(([ticker, peso], i) => {
      const input = document.querySelector(`.pct-input[data-ticker="${CSS.escape(ticker)}"]`);
      if (!input) return;
      if (i === entries.length - 1) {
        input.value = Math.max(0, Math.round((100 - asignado) * 10) / 10).toFixed(1);
      } else {
        const v = Math.round(peso * 10) / 10;
        input.value = v.toFixed(1);
        asignado += v;
      }
    });
  }

  function aplicarPreset(tipo) {
    const elNota = document.getElementById("preset-nota");
    let result;
    if (tipo === "conservador") result = A.presetConservador(enriquecidos);
    else if (tipo === "balanceado") result = A.presetBalanceado(enriquecidos);
    else if (tipo === "mayor-tir") result = A.presetMayorTir(enriquecidos);
    else return;

    aplicarPesosEnInputs(result.pesos);

    let notaTexto = result.nota || "";
    if (result.notasSector?.length) {
      notaTexto += " " + result.notasSector.join(" ");
    }
    if (elNota) {
      elNota.textContent = notaTexto;
      elNota.classList.remove("hidden");
    }
    calcSoloPreset = true;
    document.getElementById("btn-calc-mostrar-todos")?.classList.remove("hidden");
    recalcularCartera();
  }

  async function cargarDatos() {
    elLoading.classList.remove("hidden");
    elSectores.innerHTML = "";
    elAlertaError.classList.add("hidden");

    try {
      const [dataCotiz, dataInfo, dataHist, dataHistPrecios] = await Promise.all([
        C.cargarJson("data/cotizaciones.json"),
        C.cargarJson("data/info_fija.json").catch(() => ({})),
        C.cargarJson("data/historico.json").catch(() => ({ registros: [] })),
        C.cargarJson("data/historico_precios.json").catch(() => ({ instrumentos: {} })),
      ]);

      C.state.cotizaciones = dataCotiz;
      C.state.infoFija = dataInfo;
      delete C.state.infoFija._comentario;
      C.state.historico = dataHist;
      if (window.CotizHistorico) window.CotizHistorico.init(dataHistPrecios);

      S.registrarSnapshotDiario(dataCotiz.instrumentos);

      enriquecidos = C.enriquecerTodos();
      semaforos = C.calcularSemaforos(enriquecidos);

      elUltimaAct.textContent = C.formatearFecha(dataCotiz.ultima_actualizacion);
      elAlertaAntiguedad.classList.toggle("hidden", !C.esDatosAntiguos(dataCotiz.ultima_actualizacion));
      renderizarEstadoFetch();
      renderizarTipoCambio();

      elLoading.classList.add("hidden");
      elCotizToolbar.classList.remove("hidden");
      elMiniKpi.classList.remove("hidden");

      poblarFiltroSubtipo();
      renderCotizacionesView();
      renderizarCalculadora();
      renderResumen();
      renderObservaciones();

      tabsInited.analisis = false;
    } catch (err) {
      console.error(err);
      elAlertaError.textContent = "No se pudieron cargar las cotizaciones.";
      elAlertaError.classList.remove("hidden");
      elUltimaAct.textContent = "—";
    } finally {
      elLoading.classList.add("hidden");
    }
  }

  function initFiltros() {
    const bind = (id, key, parse) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => {
        filtros[key] = parse ? parse(el.value) : el.value;
        renderCotizacionesView();
      });
      el.addEventListener("change", () => {
        filtros[key] = parse ? parse(el.value) : el.value;
        renderCotizacionesView();
      });
    };
    bind("filtro-busqueda", "busqueda");
    bind("filtro-moneda", "moneda");
    bind("filtro-orden", "orden");
    bind("filtro-orden-dir", "ordenDir");

    const elTipo = document.getElementById("filtro-tipo");
    if (elTipo) {
      elTipo.addEventListener("change", () => {
        filtros.tipo = elTipo.value;
        poblarFiltroSubtipo();
        renderCotizacionesView();
      });
    }

    const elSubtipo = document.getElementById("filtro-subtipo");
    if (elSubtipo) {
      elSubtipo.addEventListener("change", () => {
        filtros.subtipo = elSubtipo.value;
        renderCotizacionesView();
      });
    }

    const elConf = document.getElementById("filtro-confiabilidad");
    if (elConf) {
      elConf.addEventListener("change", () => {
        filtros.confiabilidad = elConf.value;
        renderCotizacionesView();
      });
    }

    document.getElementById("btn-vista-cards")?.addEventListener("click", () => {
      vistaMode = "cards";
      document.getElementById("btn-vista-cards")?.classList.add("btn--active");
      document.getElementById("btn-vista-tabla")?.classList.remove("btn--active");
      renderCotizacionesView();
    });
    document.getElementById("btn-vista-tabla")?.addEventListener("click", () => {
      vistaMode = "table";
      document.getElementById("btn-vista-tabla")?.classList.add("btn--active");
      document.getElementById("btn-vista-cards")?.classList.remove("btn--active");
      renderCotizacionesView();
    });
  }

  function initTabs() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        document.querySelectorAll(".tab").forEach((t) => {
          t.classList.remove("tab--active");
          t.setAttribute("aria-selected", "false");
        });
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("tab-panel--active"));
        tab.classList.add("tab--active");
        tab.setAttribute("aria-selected", "true");
        document.getElementById(`panel-${target}`)?.classList.add("tab-panel--active");

        if (target === "analisis" && !tabsInited.analisis) {
          CH.onTabAnalisis(enriquecidos);
          tabsInited.analisis = true;
        }
        if (target === "calculadora") recalcularCartera();
      });
    });
  }

  function cargarConfigLocal() {
    if (elInputToken) elInputToken.value = localStorage.getItem(STORAGE_KEY_TOKEN) || "";
    if (elInputRepo) {
      elInputRepo.value = localStorage.getItem(STORAGE_KEY_REPO) || `${REPO_OWNER}/${REPO_NAME}`;
    }
  }

  function guardarConfigLocal() {
    const token = elInputToken?.value.trim() || "";
    const repo = normalizarRepo(elInputRepo?.value) || `${REPO_OWNER}/${REPO_NAME}`;
    if (token) localStorage.setItem(STORAGE_KEY_TOKEN, token);
    else localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.setItem(STORAGE_KEY_REPO, repo);
    if (elInputRepo) elInputRepo.value = repo;
    elStatusActualizar.textContent = "Configuración guardada.";
    setTimeout(() => { elStatusActualizar.textContent = ""; }, 3000);
  }

  const GITHUB_API_VERSION = "2022-11-28";
  let dispatchCooldownTimer = null;

  function obtenerWorkerUrl() {
    const fromInput = elInputWorkerUrl?.value.trim();
    const fromStorage = localStorage.getItem(STORAGE_KEY_WORKER);
    return fromInput || fromStorage || CFG.DISPATCH_WORKER_URL || "";
  }

  function guardarWorkerUrl() {
    const url = elInputWorkerUrl?.value.trim() || "";
    if (url) localStorage.setItem(STORAGE_KEY_WORKER, url);
    else localStorage.removeItem(STORAGE_KEY_WORKER);
    elStatusActualizar.textContent = "URL del Worker guardada.";
    setTimeout(() => { elStatusActualizar.textContent = ""; }, 3000);
  }

  function cargarConfigWorker() {
    if (!elInputWorkerUrl) return;
    const url = localStorage.getItem(STORAGE_KEY_WORKER) || CFG.DISPATCH_WORKER_URL || "";
    elInputWorkerUrl.value = url;
  }

  function iniciarCooldownActualizar() {
    if (dispatchCooldownTimer) clearTimeout(dispatchCooldownTimer);
    elBtnActualizar.disabled = true;
    dispatchCooldownTimer = setTimeout(() => {
      elBtnActualizar.disabled = false;
      dispatchCooldownTimer = null;
    }, DISPATCH_COOLDOWN_MS);
  }

  function normalizarRepo(repo) {
    let s = (repo || "").trim();
    s = s.replace(/^https?:\/\/github\.com\//i, "");
    s = s.replace(/\.git$/i, "");
    return s.replace(/\/+$/, "");
  }

  function parseRepoSlug(repo) {
    const slug = normalizarRepo(repo) || `${REPO_OWNER}/${REPO_NAME}`;
    const partes = slug.split("/").filter(Boolean);
    if (partes.length !== 2) return null;
    return { owner: partes[0], name: partes[1], slug };
  }

  function obtenerConfigGitHub() {
    const token = (elInputToken?.value.trim() || localStorage.getItem(STORAGE_KEY_TOKEN) || "").trim();
    const repo = normalizarRepo(elInputRepo?.value || localStorage.getItem(STORAGE_KEY_REPO) || `${REPO_OWNER}/${REPO_NAME}`);
    return { token, repo };
  }

  function headersGitHubApi(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    };
  }

  async function leerErrorGitHub(resp) {
    let msg = `Error HTTP ${resp.status}`;
    try {
      const data = await resp.json();
      if (data.message) msg = data.message;
      if (Array.isArray(data.errors) && data.errors.length) {
        const detalle = data.errors
          .map((e) => e.message || e.code || JSON.stringify(e))
          .join("; ");
        msg += ` — ${detalle}`;
      }
    } catch {
      try {
        const text = await resp.text();
        if (text) msg += `: ${text.slice(0, 240)}`;
      } catch {
        /* sin cuerpo legible */
      }
    }
    return msg;
  }

  async function validarAccesoGitHub(token, owner, name) {
    const headers = headersGitHubApi(token);

    const userResp = await fetch("https://api.github.com/user", { headers });
    if (userResp.status === 401) {
      return {
        ok: false,
        message:
          "Token inválido o expirado. Creá uno nuevo con los permisos del README (scope workflow o Actions: Read and write).",
      };
    }
    if (!userResp.ok) {
      return { ok: false, message: await leerErrorGitHub(userResp) };
    }

    const repoResp = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
    if (repoResp.status === 404) {
      return {
        ok: false,
        message: `Repositorio "${owner}/${name}" no encontrado o el token no tiene acceso. Usá exactamente usuario/nombre (ej. PabloPoletti/cotizaciones).`,
      };
    }
    if (!repoResp.ok) {
      return { ok: false, message: await leerErrorGitHub(repoResp) };
    }

    const wfResp = await fetch(
      `https://api.github.com/repos/${owner}/${name}/actions/workflows/${WORKFLOW_FILE}`,
      { headers }
    );
    if (wfResp.status === 403) {
      return {
        ok: false,
        message:
          "Token sin permiso para Actions/workflows. Classic: marcá scope workflow. Fine-grained: Actions → Read and write en este repo. Ver README.",
      };
    }
    if (!wfResp.ok) {
      return { ok: false, message: await leerErrorGitHub(wfResp) };
    }

    return { ok: true };
  }

  async function probarTokenGitHub() {
    const { token, repo } = obtenerConfigGitHub();
    if (!token) {
      elStatusActualizar.textContent = "Ingresá un GitHub PAT y guardá la configuración (o dejalo en el campo).";
      return;
    }
    const parsed = parseRepoSlug(repo);
    if (!parsed) {
      elStatusActualizar.textContent = "Formato de repo inválido. Usá usuario/nombre (ej. PabloPoletti/cotizaciones).";
      return;
    }

    elBtnProbarToken.disabled = true;
    elStatusActualizar.textContent = "Verificando token…";
    try {
      const validacion = await validarAccesoGitHub(token, parsed.owner, parsed.name);
      elStatusActualizar.textContent = validacion.ok
        ? `Token OK para ${parsed.slug} (incluye acceso al workflow ${WORKFLOW_FILE}).`
        : validacion.message;
    } catch {
      elStatusActualizar.textContent = "Error de red al verificar el token.";
    } finally {
      elBtnProbarToken.disabled = false;
    }
  }

  async function dispararViaWorker(workerUrl) {
    elStatusActualizar.textContent = "Disparando actualización…";
    const resp = await fetch(workerUrl, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    let data = {};
    try {
      data = await resp.json();
    } catch {
      /* cuerpo no JSON */
    }
    if (resp.status === 429) {
      const retry = data.retry_after_seconds || 300;
      elStatusActualizar.textContent =
        data.message || `Esperá ${retry}s antes de volver a actualizar (límite del servidor).`;
      iniciarCooldownActualizar();
      return;
    }
    if (resp.ok) {
      elStatusActualizar.textContent = data.message || "Workflow iniciado. Recargá en unos minutos.";
      iniciarCooldownActualizar();
      return;
    }
    elStatusActualizar.textContent = data.message || data.error || `Error del Worker (HTTP ${resp.status}).`;
  }

  async function dispararViaToken() {
    const { token, repo } = obtenerConfigGitHub();
    if (!token) {
      elStatusActualizar.textContent =
        "Sin Worker configurado ni PAT. Configurá la URL del Worker arriba o un token en Opciones avanzadas.";
      return;
    }
    const parsed = parseRepoSlug(repo);
    if (!parsed) {
      elStatusActualizar.textContent = "Formato de repo inválido. Usá usuario/nombre (ej. PabloPoletti/cotizaciones).";
      return;
    }

    elStatusActualizar.textContent = "Verificando token…";
    const validacion = await validarAccesoGitHub(token, parsed.owner, parsed.name);
    if (!validacion.ok) {
      elStatusActualizar.textContent = validacion.message;
      return;
    }

    elStatusActualizar.textContent = "Disparando actualización…";
    const resp = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.name}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          ...headersGitHubApi(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );
    if (resp.status === 204) {
      elStatusActualizar.textContent = "Workflow iniciado. Recargá en unos minutos.";
      iniciarCooldownActualizar();
      return;
    }
    elStatusActualizar.textContent = await leerErrorGitHub(resp);
  }

  async function dispararWorkflow() {
    if (elBtnActualizar.disabled) return;

    elBtnActualizar.disabled = true;
    try {
      const workerUrl = obtenerWorkerUrl();
      if (workerUrl) {
        await dispararViaWorker(workerUrl);
      } else {
        await dispararViaToken();
      }
    } catch {
      elStatusActualizar.textContent = "Error de red.";
    } finally {
      if (!dispatchCooldownTimer) elBtnActualizar.disabled = false;
    }
  }

  function initCalcActions() {
    elCapital?.addEventListener("input", recalcularCartera);
    document.getElementById("btn-aplicar-preset")?.addEventListener("click", () => {
      const v = document.getElementById("preset-cartera")?.value;
      if (v) aplicarPreset(v);
    });
    document.getElementById("btn-guardar-cartera")?.addEventListener("click", () => {
      const pesos = {};
      document.querySelectorAll(".pct-input").forEach((input) => {
        const p = parseFloat(input.value) || 0;
        if (p > 0) pesos[input.dataset.ticker] = p;
      });
      S.guardarCartera({ capital: parseFloat(elCapital?.value) || 0, pesos });
      elStatusActualizar.textContent = "Cartera guardada en este navegador.";
      setTimeout(() => { elStatusActualizar.textContent = ""; }, 2500);
    });
    document.getElementById("btn-exportar-cartera")?.addEventListener("click", exportarCarteraCsv);
    document.getElementById("btn-copiar-cartera")?.addEventListener("click", copiarResumenCartera);
    document.getElementById("btn-restaurar-cartera")?.addEventListener("click", () => {
      renderizarCalculadora();
    });
    document.getElementById("btn-calc-mostrar-todos")?.addEventListener("click", mostrarTodosInstrumentosCalc);
  }

  function init() {
    initTabs();
    initFiltros();
    initCalcActions();
    initFichaNavigation();
    cargarConfigWorker();
    cargarConfigLocal();
    cargarDatos();
    elBtnRecargar?.addEventListener("click", cargarDatos);
    elBtnActualizar?.addEventListener("click", dispararWorkflow);
    elBtnGuardarConfig?.addEventListener("click", guardarConfigLocal);
    elBtnGuardarWorker?.addEventListener("click", guardarWorkerUrl);
    elBtnProbarToken?.addEventListener("click", probarTokenGitHub);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
