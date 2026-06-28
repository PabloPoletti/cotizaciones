/**
 * Utilidades compartidas, carga de datos y enriquecimiento de instrumentos.
 */
(function () {
  "use strict";

  const ORDEN_SECTORES = [
    "Petróleo y gas",
    "Gas natural",
    "Utilities",
    "Real estate",
    "Telecomunicaciones",
    "Soberanos USD",
    "Soberanos ARS",
    "Provincial Córdoba",
    "Provincial Mendoza",
    "Provincial Salta",
    "Provincial Neuquén",
    "Provincial Buenos Aires",
    "Ciudad de Buenos Aires",
    "BCRA",
    "CEDEAR",
    "Soberanos",
  ];

  const COLORES_SECTOR = {
    "Petróleo y gas": "#1e4d8c",
    "Gas natural": "#0d7a4a",
    Utilities: "#b54708",
    "Real estate": "#7c3aed",
    Telecomunicaciones: "#0891b2",
    "Soberanos USD": "#64748b",
    "Soberanos ARS": "#475569",
    "Provincial Córdoba": "#0369a1",
    "Provincial Mendoza": "#0284c7",
    "Provincial Salta": "#0ea5e9",
    "Provincial Neuquén": "#38bdf8",
    "Provincial Buenos Aires": "#1d4ed8",
    "Ciudad de Buenos Aires": "#2563eb",
    BCRA: "#854d0e",
    CEDEAR: "#6b7280",
    Soberanos: "#64748b",
    Otros: "#94a3b8",
  };

  const state = {
    cotizaciones: null,
    infoFija: {},
    historico: { registros: [] },
    historicoPrecios: { instrumentos: {} },
  };

  function formatearPrecio(valor) {
    if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
    return new Intl.NumberFormat("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(valor);
  }

  function formatearVariacion(valor) {
    if (valor === null || valor === undefined || Number.isNaN(valor)) {
      return { texto: "—", clase: "neutral" };
    }
    const signo = valor > 0 ? "+" : "";
    const clase = valor > 0 ? "positive" : valor < 0 ? "negative" : "neutral";
    return { texto: `${signo}${valor.toFixed(2)}%`, clase };
  }

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

  function formatearFechaCorta(iso) {
    const fecha = parsearVencimiento(iso);
    if (!fecha) return iso || "—";
    return fecha.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function esDatosAntiguos(iso) {
    if (!iso) return true;
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return true;
    return Date.now() - fecha.getTime() > 2 * 60 * 60 * 1000;
  }

  async function cargarJson(ruta) {
    const respuesta = await fetch(ruta, { cache: "no-store" });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} al cargar ${ruta}`);
    return respuesta.json();
  }

  function escapeHtml(texto) {
    const div = document.createElement("div");
    div.textContent = texto ?? "";
    return div.innerHTML;
  }

  function infoDeTicker(ticker) {
    return state.infoFija[ticker] || {};
  }

  function parsearVencimiento(texto) {
    if (!texto) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
      return new Date(`${texto}T12:00:00`);
    }
    const partes = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (partes) {
      const [, d, m, y] = partes;
      return new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00`);
    }
    if (/^\d{4}$/.test(texto)) return new Date(`${texto}-12-31T12:00:00`);
    const fecha = new Date(texto);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  function estadoVigencia(info) {
    const raw = info?.vencimiento;
    if (!raw || String(raw).includes("Perpetuo")) return "sin_fecha";
    const venc = parsearVencimiento(raw);
    if (!venc) return "sin_fecha";
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const v = new Date(venc);
    v.setHours(0, 0, 0, 0);
    return v < hoy ? "vencido" : "vigente";
  }

  function esVigente(row) {
    return (row.estadoVigencia || estadoVigencia(row.info)) !== "vencido";
  }

  const GRUPOS_TIR_COMPARABLE = [
    "USD_HARD",
    "ARS_NOMINAL",
    "ARS_CER_REAL",
    "ARS_DOLLAR_LINKED",
    "NO_COMPARABLE",
  ];

  const GRUPO_TIR_LABELS = {
    USD_HARD: "USD nominal",
    ARS_NOMINAL: "ARS nominal",
    ARS_CER_REAL: "ARS real (CER)",
    ARS_DOLLAR_LINKED: "Dollar-linked",
    NO_COMPARABLE: "No comparable",
  };

  const COLORES_GRUPO_TIR = {
    USD_HARD: "#1e4d8c",
    ARS_NOMINAL: "#b54708",
    ARS_CER_REAL: "#0d7a4a",
    ARS_DOLLAR_LINKED: "#7c3aed",
  };

  const ORDEN_GRUPOS_TIR = ["USD_HARD", "ARS_NOMINAL", "ARS_CER_REAL", "ARS_DOLLAR_LINKED"];

  function inferirTirComparableGrupo(info) {
    if (estadoVigencia(info) === "vencido") return "NO_COMPARABLE";
    const cat = categoriaDe(info);
    if (cat === "CEDEAR" || cat === "BCRA") return "NO_COMPARABLE";
    const moneda = info.moneda || "USD";
    if (moneda === "USD") return "USD_HARD";
    if (moneda === "ARS-CER") return "ARS_CER_REAL";
    if (moneda === "ARS dollar-linked") return "ARS_DOLLAR_LINKED";
    if (moneda === "ARS") return "ARS_NOMINAL";
    return "NO_COMPARABLE";
  }

  function tirComparableGrupo(info) {
    const g = info?.tir_comparable_grupo;
    if (g && GRUPOS_TIR_COMPARABLE.includes(g)) return g;
    return inferirTirComparableGrupo(info);
  }

  function esTirComparable(row) {
    return row.tirComparableGrupo && row.tirComparableGrupo !== "NO_COMPARABLE";
  }

  function normalizarPrecioByma(precioRaw) {
    if (precioRaw == null || Number.isNaN(precioRaw)) return null;
    return precioRaw / 1000;
  }

  /** Margen relativo BYMA vs Data912 para badge de confirmación (ajustable). */
  const MARGEN_CONFIRMACION_PRECIO = 0.02;

  function preciosCoincidenEntreFuentes(precioPrincipal, precioBackup) {
    if (precioPrincipal == null || precioBackup == null) return false;
    const a = Number(precioPrincipal);
    const b = Number(precioBackup);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
    return Math.abs(a - b) / Math.max(a, b) <= MARGEN_CONFIRMACION_PRECIO;
  }

  function precioConfirmadoDosFuentes(item) {
    if (!item || item.error || item.precio == null) return false;
    return preciosCoincidenEntreFuentes(item.precio, item.precio_backup?.precio);
  }

  function badgeConfirmacionPrecioHtml(item) {
    if (!precioConfirmadoDosFuentes(item)) return "";
    return (
      '<span class="badge badge--confirm" title="Precio BYMA y Data912 coinciden dentro de ±2%">' +
      "✓ 2 fuentes</span>"
    );
  }

  function diferenciaPctEntreFuentes(precioPrincipal, precioBackup) {
    if (precioPrincipal == null || precioBackup == null) return null;
    const a = Number(precioPrincipal);
    const b = Number(precioBackup);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
    return (Math.abs(a - b) / Math.max(a, b)) * 100;
  }

  function detalleConfirmacionPrecio(item) {
    if (!precioConfirmadoDosFuentes(item)) return null;
    const backup = item.precio_backup;
    const diffPct = diferenciaPctEntreFuentes(item.precio, backup.precio);
    return {
      confirmado: true,
      precioByma: item.precio,
      precioData912: backup.precio,
      diffPct,
      margenPct: MARGEN_CONFIRMACION_PRECIO * 100,
      tsByma: item.timestamp_consulta || state.cotizaciones?.ultima_actualizacion,
      tsData912: state.cotizaciones?.ultima_actualizacion,
      panelData912: backup.panel || null,
    };
  }

  function soportaTirMercado(info) {
    if (!info) return { ok: false, nota: "Sin datos del instrumento" };
    if (info.cupon_tipo === "step_up" || info.cupon_tipo === "variable") {
      return { ok: false, nota: "Cupón step-up: ver TIR de referencia" };
    }
    if (
      info.amortizacion_tipo === "parcial_cronograma" ||
      (Array.isArray(info.cronograma_amortizacion) && info.cronograma_amortizacion.length > 0)
    ) {
      return { ok: false, nota: "Amortización programada: ver TIR de referencia" };
    }
    if (info.amortizacion_tipo === "amortizacion_parcial") {
      return { ok: false, nota: "Amortización parcial: ver TIR de referencia" };
    }
    if (info.amortizacion_tipo !== "bullet") {
      return { ok: false, nota: "Ver TIR de referencia" };
    }
    const moneda = info.moneda || "";
    if (moneda !== "USD" && moneda !== "ARS") {
      const etiquetas = {
        "ARS-CER": "Ajuste CER",
        "ARS dollar-linked": "Dollar-linked",
      };
      const label = etiquetas[moneda] || moneda;
      return { ok: false, nota: `${label}: ver TIR de referencia` };
    }
    const freq = info.cupon_frecuencia;
    if (freq !== "anual" && freq !== "semestral") {
      return { ok: false, nota: "Cupón no anual/semestral: ver TIR de referencia" };
    }
    const tasa = info.cupon_tasa_anual;
    if (tasa == null || tasa <= 0) {
      return { ok: false, nota: "Sin cupón fijo: ver TIR de referencia" };
    }
    return { ok: true, nota: "" };
  }

  function calcularTirMercado(precioRaw, info) {
    if (precioRaw == null || !info) {
      return { valor: null, nota: "Sin precio de mercado" };
    }
    const soporte = soportaTirMercado(info);
    if (!soporte.ok) {
      return { valor: null, nota: soporte.nota };
    }
    const vencimiento = parsearVencimiento(info.vencimiento);
    const tasaAnual = info.cupon_tasa_anual;
    if (!vencimiento || tasaAnual == null) {
      return { valor: null, nota: "Faltan cupón o vencimiento" };
    }
    const hoy = new Date();
    if (vencimiento <= hoy) return { valor: null, nota: "Instrumento vencido" };

    const pagosPorAnio = info.cupon_frecuencia === "anual" ? 1 : 2;
    const precioLimpio = normalizarPrecioByma(precioRaw);
    if (precioLimpio == null || precioLimpio <= 0) {
      return { valor: null, nota: "Precio inválido" };
    }

    const cuponPorPeriodo = (tasaAnual / 100) * 100 / pagosPorAnio;
    const msPorPeriodo = (365.25 / pagosPorAnio) * 24 * 3600 * 1000;
    const periodos = Math.max(1, Math.ceil((vencimiento - hoy) / msPorPeriodo));

    function valorPresente(tirAnualPct) {
      const y = tirAnualPct / 100 / pagosPorAnio;
      let vp = 0;
      for (let i = 1; i <= periodos; i += 1) {
        vp += cuponPorPeriodo / Math.pow(1 + y, i);
      }
      vp += 100 / Math.pow(1 + y, periodos);
      return vp;
    }

    let bajo = 0.01;
    let alto = 80;
    if (valorPresente(bajo) - precioLimpio > 0 && valorPresente(alto) - precioLimpio > 0) {
      return { valor: null, nota: "TIR fuera de rango calculable" };
    }

    for (let i = 0; i < 80; i += 1) {
      const medio = (bajo + alto) / 2;
      const diff = valorPresente(medio) - precioLimpio;
      if (Math.abs(diff) < 0.01) {
        return { valor: Math.round(medio * 100) / 100, nota: "aprox. (bullet)" };
      }
      if (diff > 0) bajo = medio;
      else alto = medio;
    }
    return {
      valor: Math.round(((bajo + alto) / 2) * 100) / 100,
      nota: "aprox. (bullet)",
    };
  }

  function tirParaCalculo(info, item) {
    const mercado = calcularTirMercado(item?.precio, info);
    if (mercado.valor != null) return { valor: mercado.valor, fuente: "mercado" };
    if (info.tir_referencia != null) {
      return { valor: info.tir_referencia, fuente: "referencia" };
    }
    return { valor: null, fuente: null };
  }

  function tirEfectiva(info, item) {
    return tirParaCalculo(info, item).valor;
  }

  function anosAlVencimiento(info) {
    const venc = parsearVencimiento(info.vencimiento);
    if (!venc) return null;
    const diff = venc - new Date();
    return Math.max(0, diff / (365.25 * 24 * 3600 * 1000));
  }

  function durationAprox(info) {
    const anos = anosAlVencimiento(info);
    if (anos == null) return null;
    const factor = info.amortizacion_tipo === "amortizacion_parcial" ? 0.72 : 0.95;
    return Math.round(anos * factor * 100) / 100;
  }

  function categoriaDe(info) {
    if (info.categoria) return info.categoria;
    if ((info.tipo || "").toLowerCase().includes("soberano")) return "Soberano USD";
    return "ON corporativa";
  }

  function esSoberano(info) {
    return categoriaDe(info).startsWith("Soberano");
  }

  function coincideFiltroCategoria(row, filtro) {
    if (!filtro || filtro === "todos") return true;
    const cat = row.categoria || categoriaDe(row.info);
    if (filtro === "on") return cat === "ON corporativa";
    if (filtro === "soberano") return cat.startsWith("Soberano");
    return cat === filtro;
  }

  function agruparPorSector(instrumentos) {
    const mapa = new Map();
    for (const sector of ORDEN_SECTORES) mapa.set(sector, []);
    for (const item of instrumentos) {
      const sector = item.sector || infoDeTicker(item.ticker).sector || "Otros";
      if (!mapa.has(sector)) mapa.set(sector, []);
      mapa.get(sector).push(item);
    }
    return mapa;
  }

  function listaInstrumentos() {
    if (!state.cotizaciones?.instrumentos) return [];
    return state.cotizaciones.instrumentos;
  }

  function enriquecer(item) {
    const info = infoDeTicker(item.ticker);
    const sector = info.sector || item.sector || "Otros";
    const categoria = categoriaDe(info);
    const tirMerc = calcularTirMercado(item.precio, info);
    const tirCalc = tirParaCalculo(info, item);
    const hp = window.CotizHistorico?.metricas(item.ticker) || null;
    return {
      item,
      info,
      sector,
      categoria,
      moneda: info.moneda || "USD",
      tirMerc,
      tirCalc,
      tirEff: tirCalc.valor,
      tirRef: info.tir_referencia,
      anosVto: anosAlVencimiento(info),
      duration: durationAprox(info),
      esSoberano: esSoberano(info),
      esBullet: info.amortizacion_tipo !== "amortizacion_parcial",
      colorSector: COLORES_SECTOR[sector] || COLORES_SECTOR.Otros,
      hp,
      liquidez: window.CotizHistorico?.nivelLiquidez(item.ticker) || null,
      estadoVigencia: estadoVigencia(info),
      tirComparableGrupo: tirComparableGrupo(info),
    };
  }

  function enriquecerTodos() {
    return listaInstrumentos().map(enriquecer);
  }

  function calcularSemaforos(enriquecidos) {
    const porBucket = new Map();
    for (const row of enriquecidos) {
      if (row.tirEff == null || !esTirComparable(row)) continue;
      const key = `${row.sector}\0${row.tirComparableGrupo}`;
      if (!porBucket.has(key)) porBucket.set(key, []);
      porBucket.get(key).push(row);
    }
    const mapa = new Map();
    for (const [, rows] of porBucket) {
      const sorted = [...rows].sort((a, b) => a.tirEff - b.tirEff);
      sorted.forEach((row, idx) => {
        const pct = sorted.length <= 1 ? 0.5 : idx / (sorted.length - 1);
        let nivel = "medio";
        if (pct <= 0.33) nivel = "bajo";
        else if (pct >= 0.66) nivel = "alto";
        mapa.set(row.item.ticker, {
          nivel,
          label:
            nivel === "bajo"
              ? "TIR baja vs sector"
              : nivel === "alto"
                ? "TIR alta vs sector"
                : "TIR media vs sector",
        });
      });
    }
    return mapa;
  }

  function formatearCeldaTir(info, item) {
    const ref = info.tir_referencia != null ? `${info.tir_referencia}%` : "—";
    const refFecha = info.tir_fecha_referencia
      ? `<span class="tir-meta">ref. ${escapeHtml(info.tir_fecha_referencia)}</span>`
      : "";
    const mercado = item ? calcularTirMercado(item.precio, info) : { valor: null, nota: "" };
    let mercadoHtml = "—";
    if (mercado.valor != null) {
      mercadoHtml = `${mercado.valor}%<span class="tir-meta">${escapeHtml(mercado.nota)}</span>`;
    } else if (mercado.nota) {
      mercadoHtml = `<span class="tir-meta">${escapeHtml(mercado.nota)}</span>`;
    }
    return `
      <div class="tir-stack">
        <span class="tir-ref-line" title="TIR de referencia">${ref}${refFecha}</span>
        <span class="tir-merc-line" title="TIR mercado aprox.">${mercadoHtml}</span>
      </div>
    `;
  }

  function formatearPrecioConTipo(item) {
    if (item.error || item.precio == null) {
      return escapeHtml(item.mensaje_error || "Sin dato");
    }
    const precio = formatearPrecio(item.precio);
    if (item.precio_tipo === "ultimo_cierre") {
      return `${precio}<span class="precio-ref">(cierre anterior)</span>`;
    }
    if (item.precio_tipo === "intradia") {
      return `${precio}<span class="precio-ref">(intradía)</span>`;
    }
    return precio;
  }

  function etiquetaPrecioTipo(item) {
    if (item.error || item.precio == null) return "Sin dato";
    if (item.precio_tipo === "intradia") return "Intradía";
    if (item.precio_tipo === "ultimo_cierre") return "Cierre anterior";
    return item.precio_tipo || "—";
  }

  function filtrarYOrdenar(enriquecidos, filtros) {
    let rows = [...enriquecidos];
    const q = (filtros.busqueda || "").trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const nombre = (r.item.nombre || r.info.nombre || "").toLowerCase();
        return r.item.ticker.toLowerCase().includes(q) || nombre.includes(q);
      });
    }
    if (filtros.tipo && filtros.tipo !== "todos") {
      rows = rows.filter((r) => coincideFiltroCategoria(r, filtros.tipo));
    }
    if (filtros.moneda && filtros.moneda !== "todos") {
      rows = rows.filter((r) => (r.moneda || r.info.moneda || "USD") === filtros.moneda);
    }
    if (filtros.subtipo && filtros.subtipo !== "todos") {
      const tipo = filtros.tipo;
      if (tipo === "on") {
        rows = rows.filter((r) => r.sector === filtros.subtipo);
      } else if (tipo === "Provincial") {
        rows = rows.filter((r) => r.sector === filtros.subtipo);
      } else if (tipo === "Soberano USD" || tipo === "Soberano ARS" || tipo === "soberano") {
        rows = rows.filter((r) => {
          const ley = r.info.ley || "";
          return ley === filtros.subtipo || ley.includes(filtros.subtipo);
        });
      }
    }
    if (filtros.confiabilidad && filtros.confiabilidad !== "todos") {
      rows = rows.filter((r) => {
        const confirmado = precioConfirmadoDosFuentes(r.item);
        const liqAlta = r.liquidez?.nivel === "alta";
        switch (filtros.confiabilidad) {
          case "confirmados":
            return confirmado;
          case "liquidez-alta":
            return liqAlta;
          case "ambos":
            return confirmado && liqAlta;
          default:
            return true;
        }
      });
    }
    if (!filtros.mostrarVencidos) {
      rows = rows.filter((r) => esVigente(r));
    }

    const sort = filtros.orden || "ticker";
    const dir = filtros.ordenDir === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      let va;
      let vb;
      switch (sort) {
        case "tir":
          va = a.tirEff ?? -1;
          vb = b.tirEff ?? -1;
          break;
        case "tirRef":
          va = a.tirRef ?? -1;
          vb = b.tirRef ?? -1;
          break;
        case "vencimiento":
          va = parsearVencimiento(a.info.vencimiento)?.getTime() ?? 0;
          vb = parsearVencimiento(b.info.vencimiento)?.getTime() ?? 0;
          break;
        case "variacion":
          va = a.item.variacion_pct ?? -999;
          vb = b.item.variacion_pct ?? -999;
          break;
        case "precio":
          va = a.item.precio ?? -1;
          vb = b.item.precio ?? -1;
          break;
        default:
          va = a.item.ticker;
          vb = b.item.ticker;
          return dir * String(va).localeCompare(String(vb));
      }
      return dir * (va - vb);
    });
    return rows;
  }

  window.CotizCore = {
    ORDEN_SECTORES,
    COLORES_SECTOR,
    state,
    formatearPrecio,
    formatearVariacion,
    formatearFecha,
    formatearFechaCorta,
    esDatosAntiguos,
    cargarJson,
    escapeHtml,
    infoDeTicker,
    parsearVencimiento,
    calcularTirMercado,
    soportaTirMercado,
    tirParaCalculo,
    tirEfectiva,
    agruparPorSector,
    listaInstrumentos,
    enriquecer,
    enriquecerTodos,
    calcularSemaforos,
    formatearCeldaTir,
    formatearPrecioConTipo,
    etiquetaPrecioTipo,
    filtrarYOrdenar,
    anosAlVencimiento,
    durationAprox,
    esSoberano,
    categoriaDe,
    coincideFiltroCategoria,
    MARGEN_CONFIRMACION_PRECIO,
    precioConfirmadoDosFuentes,
    badgeConfirmacionPrecioHtml,
    diferenciaPctEntreFuentes,
    detalleConfirmacionPrecio,
    estadoVigencia,
    esVigente,
    GRUPOS_TIR_COMPARABLE,
    GRUPO_TIR_LABELS,
    COLORES_GRUPO_TIR,
    ORDEN_GRUPOS_TIR,
    inferirTirComparableGrupo,
    tirComparableGrupo,
    esTirComparable,
  };
})();
