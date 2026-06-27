/**
 * Panel de cotizaciones ONs y bonos soberanos — lógica del frontend.
 * Datos estáticos servidos desde GitHub Pages (sin backend propio).
 */

(function () {
  "use strict";

  // Configuración del repositorio en GitHub (para disparar el workflow)
  const REPO_OWNER = "PabloPoletti";
  const REPO_NAME = "cotizaciones";
  const WORKFLOW_FILE = "actualizar.yml";

  const STORAGE_KEY_TOKEN = "cotizaciones_github_pat";
  const STORAGE_KEY_REPO = "cotizaciones_github_repo";

  // Orden de sectores en el panel
  const ORDEN_SECTORES = [
    "Petróleo y gas",
    "Gas natural",
    "Utilities",
    "Real estate",
    "Telecomunicaciones",
    "Soberanos",
  ];

  // Estado en memoria
  let cotizaciones = null;
  let infoFija = {};

  // Referencias DOM
  const elUltimaAct = document.getElementById("ultima-actualizacion");
  const elAlertaFetchStatus = document.getElementById("alerta-fetch-status");
  const elAlertaAntiguedad = document.getElementById("alerta-antiguedad");
  const elAlertaError = document.getElementById("alerta-error");
  const elSectores = document.getElementById("sectores-container");
  const elLoading = document.getElementById("loading");
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

  /**
   * Formatea un número como precio en USD.
   */
  function formatearPrecio(valor) {
    if (valor === null || valor === undefined || Number.isNaN(valor)) {
      return "—";
    }
    return new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(valor);
  }

  /**
   * Formatea variación porcentual con signo y color CSS.
   */
  function formatearVariacion(valor) {
    if (valor === null || valor === undefined || Number.isNaN(valor)) {
      return { texto: "—", clase: "neutral" };
    }
    const signo = valor > 0 ? "+" : "";
    const clase = valor > 0 ? "positive" : valor < 0 ? "negative" : "neutral";
    return { texto: `${signo}${valor.toFixed(2)}%`, clase };
  }

  /**
   * Parsea fecha ISO y la muestra en locale argentino.
   */
  function formatearFecha(iso) {
    if (!iso) return "Desconocida";
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return iso;
    return fecha.toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  /**
   * Calcula si los datos tienen más de 2 horas de antigüedad.
   */
  function esDatosAntiguos(iso) {
    if (!iso) return true;
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return true;
    const diffMs = Date.now() - fecha.getTime();
    return diffMs > 2 * 60 * 60 * 1000;
  }

  /**
   * Carga un JSON con manejo de errores de red.
   */
  async function cargarJson(ruta) {
    const respuesta = await fetch(ruta, { cache: "no-store" });
    if (!respuesta.ok) {
      throw new Error(`HTTP ${respuesta.status} al cargar ${ruta}`);
    }
    return respuesta.json();
  }

  /**
   * Agrupa instrumentos por sector respetando el orden definido.
   */
  function agruparPorSector(instrumentos) {
    const mapa = new Map();
    for (const sector of ORDEN_SECTORES) {
      mapa.set(sector, []);
    }
    for (const item of instrumentos) {
      const sector = item.sector || "Otros";
      if (!mapa.has(sector)) {
        mapa.set(sector, []);
      }
      mapa.get(sector).push(item);
    }
    return mapa;
  }

  /**
   * Obtiene datos fijos de un ticker (TIR, vencimiento, etc.).
   */
  function infoDeTicker(ticker) {
    return infoFija[ticker] || {};
  }

  /**
   * Formatea precio con etiqueta de tipo (intradiario vs cierre anterior).
   */
  function formatearPrecioConTipo(item) {
    if (item.error || item.precio === null || item.precio === undefined) {
      return escapeHtml(item.mensaje_error || "Sin dato");
    }
    const precio = formatearPrecio(item.precio);
    if (item.precio_tipo === "ultimo_cierre") {
      return `${precio}<span class="precio-ref">(cierre anterior)</span>`;
    }
    return precio;
  }

  /**
   * Muestra banner según fetch_status global del JSON.
   */
  function renderizarEstadoFetch() {
    if (!elAlertaFetchStatus || !cotizaciones) return;

    const status = cotizaciones.fetch_status;
    const mensaje = cotizaciones.fetch_mensaje || "";

    elAlertaFetchStatus.className = "alert hidden";
    if (!status) return;

    elAlertaFetchStatus.textContent = mensaje;
    elAlertaFetchStatus.classList.remove("hidden");

    if (status === "error") {
      elAlertaFetchStatus.classList.add("alert--fetch-error");
    } else if (status === "mercado_cerrado") {
      elAlertaFetchStatus.classList.add("alert--warning");
    } else if (status === "parcial") {
      elAlertaFetchStatus.classList.add("alert--warning");
    } else {
      elAlertaFetchStatus.classList.add("alert--info");
    }
  }

  function renderizarCotizaciones() {
    if (!cotizaciones || !Array.isArray(cotizaciones.instrumentos)) {
      return;
    }

    elUltimaAct.textContent = formatearFecha(cotizaciones.ultima_actualizacion);

    if (esDatosAntiguos(cotizaciones.ultima_actualizacion)) {
      elAlertaAntiguedad.classList.remove("hidden");
    } else {
      elAlertaAntiguedad.classList.add("hidden");
    }

    renderizarEstadoFetch();

    const grupos = agruparPorSector(cotizaciones.instrumentos);
    elSectores.innerHTML = "";

    for (const [sector, items] of grupos) {
      if (items.length === 0) continue;

      const section = document.createElement("section");
      section.className = "sector";

      const titulo = document.createElement("h2");
      titulo.className = "sector__title";
      titulo.textContent = sector;
      section.appendChild(titulo);

      const wrap = document.createElement("div");
      wrap.className = "table-wrap";

      const tabla = document.createElement("table");
      tabla.innerHTML = `
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Ticker</th>
            <th class="num">Precio (USD)</th>
            <th class="num">Var. %</th>
            <th class="num">TIR ref.</th>
            <th>Vencimiento</th>
            <th>Cupón</th>
            <th>Amortización</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = tabla.querySelector("tbody");

      for (const item of items) {
        const tr = document.createElement("tr");
        if (item.error) tr.className = "error-row";

        const info = infoDeTicker(item.ticker);
        const varFmt = formatearVariacion(item.variacion_pct);
        const tir =
          info.tir_referencia !== null && info.tir_referencia !== undefined
            ? `${info.tir_referencia}%`
            : "—";

        tr.innerHTML = `
          <td>${escapeHtml(item.nombre || item.ticker)}</td>
          <td class="ticker">${escapeHtml(item.ticker)}</td>
          <td class="num">${item.error ? escapeHtml(item.mensaje_error || "Sin dato") : formatearPrecioConTipo(item)}</td>
          <td class="num ${varFmt.clase}">${varFmt.texto}</td>
          <td class="num">${tir}</td>
          <td>${escapeHtml(info.vencimiento || "—")}</td>
          <td>${escapeHtml(info.cupon || "—")}</td>
          <td>${escapeHtml(info.amortizacion || "—")}</td>
        `;
        tbody.appendChild(tr);
      }

      wrap.appendChild(tabla);
      section.appendChild(wrap);
      elSectores.appendChild(section);
    }
  }

  /**
   * Escapa HTML para evitar inyección al renderizar strings dinámicos.
   */
  function escapeHtml(texto) {
    const div = document.createElement("div");
    div.textContent = texto ?? "";
    return div.innerHTML;
  }

  /**
   * Renderiza filas de la calculadora de cartera.
   */
  function renderizarCalculadora() {
    if (!cotizaciones || !Array.isArray(cotizaciones.instrumentos)) {
      return;
    }

    elCalcBody.innerHTML = "";
    const instrumentos = cotizaciones.instrumentos.filter((i) => !i.error && i.precio != null);

    for (const item of instrumentos) {
      const info = infoDeTicker(item.ticker);
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${escapeHtml(item.nombre || item.ticker)}</td>
        <td class="ticker">${escapeHtml(item.ticker)}</td>
        <td class="num">${info.tir_referencia != null ? info.tir_referencia + "%" : "—"}</td>
        <td class="num">
          <input type="number" min="0" max="100" step="0.1" value="0"
                 data-ticker="${escapeHtml(item.ticker)}"
                 data-tir="${info.tir_referencia ?? ""}"
                 class="pct-input" aria-label="Porcentaje ${escapeHtml(item.ticker)}">
        </td>
        <td class="num monto-asignado" data-ticker="${escapeHtml(item.ticker)}">—</td>
      `;
      elCalcBody.appendChild(tr);
    }

    document.querySelectorAll(".pct-input").forEach((input) => {
      input.addEventListener("input", recalcularCartera);
    });

    if (elCapital) {
      elCapital.addEventListener("input", recalcularCartera);
    }

    recalcularCartera();
  }

  /**
   * Recalcula TIR ponderada y renta anual estimada.
   */
  function recalcularCartera() {
    const capital = parseFloat(elCapital?.value) || 0;
    const inputs = document.querySelectorAll(".pct-input");

    let sumaPct = 0;
    let tirPonderada = 0;
    let tieneTir = false;

    inputs.forEach((input) => {
      const pct = parseFloat(input.value) || 0;
      const tir = parseFloat(input.dataset.tir);
      sumaPct += pct;

      const monto = (capital * pct) / 100;
      const celdaMonto = document.querySelector(
        `.monto-asignado[data-ticker="${input.dataset.ticker}"]`
      );
      if (celdaMonto) {
        celdaMonto.textContent =
          capital > 0 ? formatearPrecio(monto) + " USD" : "—";
      }

      if (!Number.isNaN(tir) && pct > 0) {
        tirPonderada += (pct / 100) * tir;
        tieneTir = true;
      }
    });

    elSumaPct.textContent = sumaPct.toFixed(1) + "%";

    if (tieneTir && sumaPct > 0) {
      // Normalizar si la suma no es 100% (TIR sobre lo asignado)
      const factor = sumaPct / 100;
      const tirAjustada = tirPonderada / factor;
      elTirPonderada.textContent = tirAjustada.toFixed(2) + "%";
      elRentaAnual.textContent =
        formatearPrecio((capital * tirAjustada) / 100) + " USD";
    } else {
      elTirPonderada.textContent = "—";
      elRentaAnual.textContent = "—";
    }

    // Advertencias de validación
    const warnings = [];
    if (sumaPct > 100.01) {
      warnings.push("La suma de porcentajes supera el 100%.");
    }
    if (capital > 0 && sumaPct === 0) {
      warnings.push("Asigná al menos un porcentaje a algún instrumento.");
    }
    const sinTir = [...inputs].some(
      (i) => (parseFloat(i.value) || 0) > 0 && !i.dataset.tir
    );
    if (sinTir) {
      warnings.push(
        "Algunos instrumentos asignados no tienen TIR de referencia en info_fija.json."
      );
    }

    if (warnings.length) {
      elCalcWarning.textContent = warnings.join(" ");
      elCalcWarning.classList.remove("hidden");
    } else {
      elCalcWarning.textContent = "";
      elCalcWarning.classList.add("hidden");
    }
  }

  /**
   * Carga cotizaciones e info fija desde el mismo origen (GitHub Pages).
   */
  async function cargarDatos() {
    elLoading.classList.remove("hidden");
    elSectores.innerHTML = "";
    elAlertaError.classList.add("hidden");

    try {
      const [dataCotiz, dataInfo] = await Promise.all([
        cargarJson("data/cotizaciones.json"),
        cargarJson("data/info_fija.json").catch(() => ({})),
      ]);

      cotizaciones = dataCotiz;
      infoFija = dataInfo;
      delete infoFija._comentario;

      renderizarCotizaciones();
      renderizarCalculadora();
    } catch (err) {
      console.error(err);
      elAlertaError.textContent =
        "No se pudieron cargar las cotizaciones. Verificá tu conexión o que el archivo data/cotizaciones.json exista en el repositorio.";
      elAlertaError.classList.remove("hidden");
      elUltimaAct.textContent = "—";
    } finally {
      elLoading.classList.add("hidden");
    }
  }

  /**
   * Lee configuración del PAT desde localStorage.
   */
  function cargarConfigLocal() {
    const token = localStorage.getItem(STORAGE_KEY_TOKEN) || "";
    const repo =
      localStorage.getItem(STORAGE_KEY_REPO) ||
      `${REPO_OWNER}/${REPO_NAME}`;

    if (elInputToken) elInputToken.value = token;
    if (elInputRepo) elInputRepo.value = repo;
  }

  /**
   * Guarda PAT y repo en localStorage (nunca se commitea).
   */
  function guardarConfigLocal() {
    const token = elInputToken?.value.trim() || "";
    const repo = elInputRepo?.value.trim() || `${REPO_OWNER}/${REPO_NAME}`;

    if (token) {
      localStorage.setItem(STORAGE_KEY_TOKEN, token);
    } else {
      localStorage.removeItem(STORAGE_KEY_TOKEN);
    }
    localStorage.setItem(STORAGE_KEY_REPO, repo);

    elStatusActualizar.textContent = "Configuración guardada en este navegador.";
    setTimeout(() => {
      elStatusActualizar.textContent = "";
    }, 3000);
  }

  /**
   * Dispara el workflow de GitHub Actions vía API REST.
   * Requiere un Personal Access Token con scope `workflow` o permiso Actions write.
   */
  async function dispararWorkflow() {
    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const repo =
      localStorage.getItem(STORAGE_KEY_REPO) ||
      `${REPO_OWNER}/${REPO_NAME}`;

    if (!token) {
      elStatusActualizar.textContent =
        "Configurá tu GitHub PAT en la sección de configuración (solo se guarda localmente).";
      return;
    }

    const partes = repo.split("/");
    if (partes.length !== 2) {
      elStatusActualizar.textContent =
        "Formato de repo inválido. Usá: usuario/nombre-repo";
      return;
    }

    const [owner, name] = partes;
    const url = `https://api.github.com/repos/${owner}/${name}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

    elBtnActualizar.disabled = true;
    elStatusActualizar.textContent = "Disparando actualización…";

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      });

      if (resp.status === 204) {
        elStatusActualizar.textContent =
          "Workflow iniciado. Los datos se actualizarán en unos minutos; recargá la página después.";
      } else {
        const detalle = await resp.json().catch(() => ({}));
        elStatusActualizar.textContent =
          detalle.message ||
          `Error ${resp.status} al disparar el workflow. Verificá el token y los permisos.`;
      }
    } catch (err) {
      elStatusActualizar.textContent =
        "Error de red al contactar la API de GitHub.";
      console.error(err);
    } finally {
      elBtnActualizar.disabled = false;
    }
  }

  /**
   * Cambio de pestañas Cotizaciones / Calculadora.
   */
  function initTabs() {
    const tabs = document.querySelectorAll(".tab");
    const panels = document.querySelectorAll(".tab-panel");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;

        tabs.forEach((t) => t.classList.remove("tab--active"));
        panels.forEach((p) => p.classList.remove("tab-panel--active"));

        tab.classList.add("tab--active");
        document.getElementById(`panel-${target}`)?.classList.add("tab-panel--active");
      });
    });
  }

  /**
   * Inicialización al cargar la página.
   */
  function init() {
    initTabs();
    cargarConfigLocal();
    cargarDatos();

    elBtnRecargar?.addEventListener("click", cargarDatos);
    elBtnActualizar?.addEventListener("click", dispararWorkflow);
    elBtnGuardarConfig?.addEventListener("click", guardarConfigLocal);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
