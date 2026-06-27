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

  const C = window.CotizCore;
  const A = window.CotizAnalytics;
  const S = window.CotizStorage;
  const CH = window.CotizCharts;

  let enriquecidos = [];
  let semaforos = new Map();
  let filtros = {
    busqueda: "",
    tipo: "todos",
    sector: "todos",
    orden: "ticker",
    ordenDir: "asc",
  };
  let vistaMode = "cards";
  let tabsInited = { analisis: false, resumen: false, observaciones: false };

  const elUltimaAct = document.getElementById("ultima-actualizacion");
  const elAlertaFetchStatus = document.getElementById("alerta-fetch-status");
  const elAlertaAntiguedad = document.getElementById("alerta-antiguedad");
  const elAlertaError = document.getElementById("alerta-error");
  const elSectores = document.getElementById("sectores-container");
  const elTablaContainer = document.getElementById("tabla-container");
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
  const elStatusActualizar = document.getElementById("status-actualizar");

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

  function semaforoHtml(ticker) {
    const s = semaforos.get(ticker);
    if (!s) return `<span class="semaforo semaforo--na" title="Sin TIR para comparar">○</span>`;
    return `<span class="semaforo semaforo--${s.nivel}" title="${C.escapeHtml(s.label)} (vs sector)">●</span>`;
  }

  function badgesHtml(row) {
    const moneda = row.info.moneda || "USD";
    const tipo = row.esSoberano ? "Soberano" : "ON";
    const amort = row.esBullet ? "Bullet" : "Amort. parcial";
    return `
      <span class="badge badge--moneda">${C.escapeHtml(moneda)}</span>
      <span class="badge badge--tipo">${C.escapeHtml(tipo)}</span>
      <span class="badge badge--amort ${row.esBullet ? "" : "badge--warn"}">${C.escapeHtml(amort)}</span>
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
        </div>
        <details class="inst-card__detail">
          <summary>Ver detalle</summary>
          <dl class="inst-dl">
            <dt>Sector</dt><dd>${C.escapeHtml(row.sector)}</dd>
            <dt>Vencimiento</dt><dd>${C.escapeHtml(C.formatearFechaCorta(info.vencimiento))}</dd>
            <dt>Cupón</dt><dd>${C.escapeHtml(info.cupon || "—")}</dd>
            <dt>Amortización</dt><dd>${C.escapeHtml(info.amortizacion || "—")}</dd>
            <dt>Ley</dt><dd>${C.escapeHtml(info.ley || "—")}</dd>
            <dt>TIR rango ref.</dt><dd>${C.escapeHtml(info.tir_rango || "—")}</dd>
            ${info.notas ? `<dt>Notas</dt><dd>${C.escapeHtml(info.notas)}</dd>` : ""}
          </dl>
        </details>
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
        <th class="num">TIR</th>
        <th>Venc.</th>
        <th>Sector</th>
        <th>Riesgo</th>
      </tr></thead>`;
    const tbody = rows
      .map((row) => {
        const { item, info } = row;
        const varFmt = C.formatearVariacion(item.variacion_pct);
        return `<tr class="${item.error ? "error-row" : ""}">
          <td class="ticker">${C.escapeHtml(item.ticker)}</td>
          <td>${C.escapeHtml(item.nombre || info.nombre || "")}</td>
          <td class="num">${item.error ? "—" : C.formatearPrecioConTipo(item)}</td>
          <td class="num ${varFmt.clase}">${varFmt.texto}</td>
          <td class="num tir-cell">${C.formatearCeldaTir(info, item)}</td>
          <td>${C.escapeHtml(C.formatearFechaCorta(info.vencimiento))}</td>
          <td>${C.escapeHtml(row.sector)}</td>
          <td>${semaforoHtml(item.ticker)}</td>
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

  function poblarFiltroSectores() {
    const sel = document.getElementById("filtro-sector");
    if (!sel) return;
    const sectores = [...new Set(enriquecidos.map((r) => r.sector))].sort();
    sel.innerHTML =
      `<option value="todos">Todos</option>` +
      sectores.map((s) => `<option value="${C.escapeHtml(s)}">${C.escapeHtml(s)}</option>`).join("");
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

  function renderResumen() {
    const kpis = A.calcularKPIs(enriquecidos);
    const el = document.getElementById("resumen-kpis");
    if (el) {
      el.innerHTML = `
        <div class="kpi-card"><span>TIR promedio</span><strong>${kpis.tirProm != null ? kpis.tirProm.toFixed(2) + "%" : "—"}</strong></div>
        <div class="kpi-card"><span>TIR máxima</span><strong>${kpis.tirMax != null ? kpis.tirMax.toFixed(2) + "%" : "—"}</strong></div>
        <div class="kpi-card"><span>TIR mínima</span><strong>${kpis.tirMin != null ? kpis.tirMin.toFixed(2) + "%" : "—"}</strong></div>
        <div class="kpi-card"><span>Duration prom.</span><strong>${kpis.durationProm != null ? kpis.durationProm.toFixed(1) + " a" : "—"}</strong></div>
        <div class="kpi-card"><span>ON / Soberanos</span><strong>${kpis.countOn} / ${kpis.countSoberano}</strong></div>
        <div class="kpi-card"><span>Monedas</span><strong>${kpis.countMonedas}</strong></div>
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
  }

  function renderObservaciones() {
    const el = document.getElementById("observaciones-list");
    if (!el) return;
    const items = A.generarObservaciones(enriquecidos);
    el.innerHTML = items.map((html) => `<div class="obs-item">${html}</div>`).join("");
  }

  function renderizarCalculadora() {
    const cot = C.state.cotizaciones;
    if (!cot?.instrumentos) return;
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
  }

  function aplicarPreset(tipo) {
    const elNota = document.getElementById("preset-nota");
    let result;
    if (tipo === "conservador") result = A.presetConservador(enriquecidos);
    else if (tipo === "balanceado") result = A.presetBalanceado(enriquecidos);
    else if (tipo === "mayor-tir") result = A.presetMayorTir(enriquecidos);
    else return;

    document.querySelectorAll(".pct-input").forEach((input) => {
      input.value = "0";
      const p = result.pesos[input.dataset.ticker];
      if (p != null) input.value = p.toFixed(1);
    });

    let notaTexto = result.nota || "";
    if (result.notasSector?.length) {
      notaTexto += " " + result.notasSector.join(" ");
    }
    if (elNota) {
      elNota.textContent = notaTexto;
      elNota.classList.remove("hidden");
    }
    recalcularCartera();
  }

  async function cargarDatos() {
    elLoading.classList.remove("hidden");
    elSectores.innerHTML = "";
    elAlertaError.classList.add("hidden");

    try {
      const [dataCotiz, dataInfo, dataHist] = await Promise.all([
        C.cargarJson("data/cotizaciones.json"),
        C.cargarJson("data/info_fija.json").catch(() => ({})),
        C.cargarJson("data/historico.json").catch(() => ({ registros: [] })),
      ]);

      C.state.cotizaciones = dataCotiz;
      C.state.infoFija = dataInfo;
      delete C.state.infoFija._comentario;
      C.state.historico = dataHist;

      S.registrarSnapshotDiario(dataCotiz.instrumentos);

      enriquecidos = C.enriquecerTodos();
      semaforos = C.calcularSemaforos(enriquecidos);

      elUltimaAct.textContent = C.formatearFecha(dataCotiz.ultima_actualizacion);
      elAlertaAntiguedad.classList.toggle("hidden", !C.esDatosAntiguos(dataCotiz.ultima_actualizacion));
      renderizarEstadoFetch();

      elLoading.classList.add("hidden");
      elCotizToolbar.classList.remove("hidden");
      elMiniKpi.classList.remove("hidden");

      poblarFiltroSectores();
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
    bind("filtro-tipo", "tipo");
    bind("filtro-sector", "sector");
    bind("filtro-orden", "orden");
    bind("filtro-orden-dir", "ordenDir");

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
    const repo = elInputRepo?.value.trim() || `${REPO_OWNER}/${REPO_NAME}`;
    if (token) localStorage.setItem(STORAGE_KEY_TOKEN, token);
    else localStorage.removeItem(STORAGE_KEY_TOKEN);
    localStorage.setItem(STORAGE_KEY_REPO, repo);
    elStatusActualizar.textContent = "Configuración guardada.";
    setTimeout(() => { elStatusActualizar.textContent = ""; }, 3000);
  }

  async function dispararWorkflow() {
    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const repo = localStorage.getItem(STORAGE_KEY_REPO) || `${REPO_OWNER}/${REPO_NAME}`;
    if (!token) {
      elStatusActualizar.textContent = "Configurá tu GitHub PAT primero.";
      return;
    }
    const partes = repo.split("/");
    if (partes.length !== 2) {
      elStatusActualizar.textContent = "Formato de repo inválido.";
      return;
    }
    elBtnActualizar.disabled = true;
    elStatusActualizar.textContent = "Disparando actualización…";
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${partes[0]}/${partes[1]}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ref: "main" }),
        }
      );
      elStatusActualizar.textContent =
        resp.status === 204 ? "Workflow iniciado. Recargá en unos minutos." : `Error ${resp.status}.`;
    } catch {
      elStatusActualizar.textContent = "Error de red.";
    } finally {
      elBtnActualizar.disabled = false;
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
    document.getElementById("btn-restaurar-cartera")?.addEventListener("click", () => {
      renderizarCalculadora();
    });
  }

  function init() {
    initTabs();
    initFiltros();
    initCalcActions();
    cargarConfigLocal();
    cargarDatos();
    elBtnRecargar?.addEventListener("click", cargarDatos);
    elBtnActualizar?.addEventListener("click", dispararWorkflow);
    elBtnGuardarConfig?.addEventListener("click", guardarConfigLocal);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
