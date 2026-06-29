/**
 * KPIs, rankings, cupones estimados, observaciones y presets de cartera.
 */
(function () {
  "use strict";

  const C = () => window.CotizCore;

  function promedio(vals) {
    const v = vals.filter((x) => x != null && !Number.isNaN(x));
    if (!v.length) return null;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }

  function calcularKPIs(enriquecidos) {
    const tirs = enriquecidos.map((r) => r.tirEff).filter((x) => x != null);
    const durations = enriquecidos.map((r) => r.duration).filter((x) => x != null);
    const ons = enriquecidos.filter((r) => r.categoria === "ON corporativa").length;
    const soberanos = enriquecidos.filter((r) => (r.categoria || "").startsWith("Soberano")).length;
    const monedas = new Set(enriquecidos.map((r) => r.moneda || r.info.moneda || "USD"));

    return {
      tirProm: promedio(tirs),
      tirMax: tirs.length ? Math.max(...tirs) : null,
      tirMin: tirs.length ? Math.min(...tirs) : null,
      durationProm: promedio(durations),
      countOn: ons,
      countSoberano: soberanos,
      countTotal: enriquecidos.length,
      countMonedas: monedas.size,
    };
  }

  function calcularKPIsPorMoneda(enriquecidos) {
    const grupos = new Map();
    for (const row of enriquecidos) {
      const m = row.moneda || row.info.moneda || "USD";
      if (!grupos.has(m)) grupos.set(m, []);
      grupos.get(m).push(row);
    }
    const porMoneda = {};
    for (const [moneda, rows] of grupos) {
      porMoneda[moneda] = { ...calcularKPIs(rows), moneda, count: rows.length };
    }
    return { porMoneda, total: enriquecidos.length };
  }

  function calcularKPIsPorGrupoTir(enriquecidos) {
    const porGrupo = {};
    for (const g of C().ORDEN_GRUPOS_TIR) {
      const rows = enriquecidos.filter((r) => r.tirComparableGrupo === g);
      if (!rows.length) continue;
      const kpis = calcularKPIs(rows);
      porGrupo[g] = {
        ...kpis,
        grupo: g,
        label: C().GRUPO_TIR_LABELS[g] || g,
        count: rows.length,
      };
    }
    const noComparable = enriquecidos.filter((r) => r.tirComparableGrupo === "NO_COMPARABLE").length;
    return { porGrupo, total: enriquecidos.length, noComparable };
  }

  function mejorTirPorSector(enriquecidos) {
    return mejorTirPorSectorGrupo(enriquecidos);
  }

  function mejorTirPorSectorGrupo(enriquecidos) {
    const gruposPorSector = new Map();
    for (const row of enriquecidos) {
      if (!C().esTirComparable(row) || row.tirEff == null) continue;
      if (!gruposPorSector.has(row.sector)) gruposPorSector.set(row.sector, new Set());
      gruposPorSector.get(row.sector).add(row.tirComparableGrupo);
    }

    const mapa = new Map();
    for (const row of enriquecidos) {
      if (!C().esTirComparable(row) || row.tirEff == null) continue;
      const key = `${row.sector}\0${row.tirComparableGrupo}`;
      const prev = mapa.get(key);
      if (!prev || row.tirEff > prev.tirEff) mapa.set(key, row);
    }

    return [...mapa.entries()]
      .map(([key, row]) => {
        const [sector, grupo] = key.split("\0");
        const multiGrupo = (gruposPorSector.get(sector)?.size || 0) > 1;
        const grupoLabel = C().GRUPO_TIR_LABELS[grupo] || grupo;
        return {
          sector,
          grupo,
          sectorLabel: multiGrupo ? `${sector} · ${grupoLabel}` : sector,
          ticker: row.item.ticker,
          nombre: row.item.nombre || row.info.nombre,
          tirEff: row.tirEff,
          tirFuente: row.tirCalc?.fuente || null,
          vencimiento: row.info.vencimiento,
        };
      })
      .sort((a, b) => {
        const s = a.sector.localeCompare(b.sector);
        if (s !== 0) return s;
        const ia = C().ORDEN_GRUPOS_TIR.indexOf(a.grupo);
        const ib = C().ORDEN_GRUPOS_TIR.indexOf(b.grupo);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
  }

  function proximosVencimientos(enriquecidos, limite = 10) {
    return enriquecidos
      .map((r) => ({
        ticker: r.item.ticker,
        nombre: r.item.nombre || r.info.nombre,
        vencimiento: r.info.vencimiento,
        fecha: C().parsearVencimiento(r.info.vencimiento),
      }))
      .filter((r) => r.fecha && r.fecha > new Date())
      .sort((a, b) => a.fecha - b.fecha)
      .slice(0, limite);
  }

  function estimarProximoCupon(info) {
    return C().proximoCuponInfo(info).fecha;
  }

  function proximoCuponInfo(info) {
    return C().proximoCuponInfo(info);
  }

  function proximosCupones(enriquecidos, limite = 12) {
    return enriquecidos
      .map((r) => {
        const pc = C().proximoCuponInfo(r.info);
        if (pc.metodo === "no_aplica" || !pc.fecha) return null;
        return {
          ticker: r.item.ticker,
          nombre: r.item.nombre || r.info.nombre,
          fecha: pc.fecha,
          cupon: r.info.cupon,
          metodo: pc.metodo,
          meta: pc.meta,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.fecha - b.fecha)
      .slice(0, limite);
  }

  function plazoRestante(info) {
    const venc = C().parsearVencimiento(info.vencimiento);
    if (!venc) return null;
    const hoy = new Date();
    hoy.setHours(12, 0, 0, 0);
    const diffMs = venc.getTime() - hoy.getTime();
    const dias = Math.ceil(diffMs / (24 * 3600 * 1000));
    const anos = Math.round((dias / 365.25) * 10) / 10;
    return { dias, anos, venc };
  }

  function composicionPorSector(enriquecidos) {
    const mapa = new Map();
    for (const r of enriquecidos) {
      mapa.set(r.sector, (mapa.get(r.sector) || 0) + 1);
    }
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  }

  function generarObservaciones(enriquecidos) {
    const bullets = [];
    const parciales = enriquecidos.filter((r) => !r.esBullet);
    const bulletsOnly = enriquecidos.filter((r) => r.esBullet);

    for (const row of mejorTirPorSectorGrupo(enriquecidos)) {
      const refMark = row.tirFuente === "referencia" ? " (ref.)" : "";
      bullets.push(
        `En <strong>${C().escapeHtml(row.sectorLabel)}</strong>, la TIR efectiva más alta del panel es ` +
          `<strong>${row.ticker}</strong> (~${row.tirEff.toFixed(2)}%${refMark}). Comparación relativa dentro del mismo grupo TIR, no calidad crediticia.`
      );
    }

    bullets.push(
      `<strong>${bulletsOnly.length}</strong> instrumentos con amortización bullet y ` +
        `<strong>${parciales.length}</strong> con amortización parcial. Los bullet concentran el principal al vencimiento; ` +
        `los parciales implican reinversión de capital antes del vencimiento.`
    );

    const divergentes = enriquecidos.filter((r) => {
      if (r.tirRef == null || r.tirMerc.valor == null) return false;
      return Math.abs(r.tirMerc.valor - r.tirRef) > 0.5;
    });
    if (divergentes.length) {
      bullets.push(
        `${divergentes.length} ticker(s) con TIR mercado (aprox.) alejada >0,5 pp de la referencia jun-2026: ` +
          divergentes.map((r) => r.item.ticker).join(", ") +
          "."
      );
    }

    const vencProx = proximosVencimientos(enriquecidos, 5);
    if (vencProx.length) {
      bullets.push(
        `Próximos vencimientos: ${vencProx
          .map((v) => `${v.ticker} (${C().formatearFechaCorta(v.vencimiento)})`)
          .join(", ")}.`
      );
    }

    const H = window.CotizHistorico;
    if (H?.tieneDatos()) {
      const porCat = new Map();
      for (const row of enriquecidos) {
        const liq = row.liquidez?.nivel;
        const vol = row.hp?.volumen_promedio;
        if (!vol || liq === "na") continue;
        const cat = row.categoria || C().categoriaDe(row.info);
        const prev = porCat.get(cat);
        if (!prev || vol > prev.vol) {
          porCat.set(cat, { ticker: row.item.ticker, vol, label: row.liquidez?.label });
        }
      }
      if (porCat.size) {
        const lineas = [...porCat.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(
            ([cat, v]) =>
              `<strong>${C().escapeHtml(cat)}</strong>: ${C().escapeHtml(v.ticker)} (liq. ${C().escapeHtml(v.label || "—")}, vol. prom. ${H.formatearVolumen(v.vol)})`
          );
        bullets.push(
          `Mayor liquidez relativa dentro de cada categoría (percentiles del panel, no mercado completo): ${lineas.join("; ")}.`
        );
      }

      const tirAltaLiqBaja = enriquecidos.filter(
        (r) =>
          r.tirComparableGrupo === "USD_HARD" &&
          r.tirEff != null &&
          r.tirEff >= 9 &&
          r.liquidez?.nivel === "baja" &&
          r.hp?.volumen_promedio
      );
      if (tirAltaLiqBaja.length) {
        bullets.push(
          `<strong>Advertencia de salida:</strong> ${tirAltaLiqBaja
            .map((r) => `${r.item.ticker} (TIR ~${r.tirEff.toFixed(1)}%, liq. baja)`)
            .join(", ")} — TIR atractiva en el panel pero volumen operado bajo vs el resto; puede ser más difícil entrar/salir sin mover el precio. No implica que deban evitarse, solo verificar liquidez real antes de operar.`
        );
      }

      const volatiles = enriquecidos
        .filter((r) => r.hp?.volatilidad_30d_pct != null)
        .sort((a, b) => b.hp.volatilidad_30d_pct - a.hp.volatilidad_30d_pct)
        .slice(0, 5);
      if (volatiles.length) {
        bullets.push(
          `Mayor volatilidad de precio reciente (desvío diario ~30d, dato BYMA): ${volatiles
            .map((r) => `${r.item.ticker} (${r.hp.volatilidad_30d_pct}%)`)
            .join(", ")}. Riesgo de precio, distinto del riesgo crediticio del semáforo.`
        );
      }
    }

    return bullets;
  }

  function distribuirPesosIguales(tickers) {
    const n = tickers.length;
    if (!n) return {};
    const pesos = {};
    const basePct = Math.floor((100 / n) * 100) / 100;
    let asignado = 0;
    tickers.forEach((ticker, i) => {
      if (i === n - 1) {
        pesos[ticker] = Math.round((100 - asignado) * 100) / 100;
      } else {
        pesos[ticker] = basePct;
        asignado += basePct;
      }
    });
    return pesos;
  }

  function rowsComparableConTir(enriquecidos) {
    return enriquecidos.filter((r) => r.tirEff != null && C().esTirComparable(r));
  }

  function agruparPorTirGrupo(enriquecidos) {
    const map = new Map();
    for (const g of C().ORDEN_GRUPOS_TIR) map.set(g, []);
    for (const row of rowsComparableConTir(enriquecidos)) {
      const g = row.tirComparableGrupo;
      if (map.has(g)) map.get(g).push(row);
    }
    return map;
  }

  function metaPresetRow(row) {
    return {
      ticker: row.item.ticker,
      tirEff: row.tirEff,
      sector: row.sector,
      tirFuente: row.tirCalc?.fuente || null,
      grupo: row.tirComparableGrupo,
    };
  }

  function seleccionPresetPorGrupo(porGrupoMap, selectorFn) {
    const porGrupo = {};
    const seleccionados = [];
    const vistos = new Set();
    for (const g of C().ORDEN_GRUPOS_TIR) {
      const rows = porGrupoMap.get(g) || [];
      const picked = selectorFn(rows, g);
      if (!picked.length) continue;
      porGrupo[g] = picked.map(metaPresetRow);
      for (const row of picked) {
        const t = row.item.ticker;
        if (!vistos.has(t)) {
          vistos.add(t);
          seleccionados.push(row);
        }
      }
    }
    return { seleccionados, porGrupo };
  }

  function presetConservador(enriquecidos) {
    const TIR_MAX = 8;
    const { seleccionados, porGrupo } = seleccionPresetPorGrupo(
      agruparPorTirGrupo(enriquecidos),
      (rows) => [...rows].filter((r) => r.tirEff < TIR_MAX).sort((a, b) => a.tirEff - b.tirEff)
    );
    if (!seleccionados.length) {
      return {
        pesos: {},
        porGrupo: {},
        nota: `Ningún instrumento comparable cumple TIR efectiva < ${TIR_MAX}% dentro de su grupo.`,
      };
    }
    const pesos = distribuirPesosIguales(seleccionados.map((r) => r.item.ticker));
    return {
      pesos,
      porGrupo,
      nota: `Ejemplo ilustrativo: TIR efectiva < ${TIR_MAX}% dentro de cada grupo comparable (no ranking global), pesos iguales.`,
    };
  }

  function presetBalanceado(enriquecidos) {
    const porGrupoMap = agruparPorTirGrupo(enriquecidos);
    const porGrupo = {};
    const seleccionados = [];
    const vistos = new Set();
    const notasSector = [];

    for (const g of C().ORDEN_GRUPOS_TIR) {
      const rows = porGrupoMap.get(g) || [];
      if (!rows.length) continue;
      const porSector = new Map();
      for (const row of rows) {
        if (!porSector.has(row.sector)) porSector.set(row.sector, []);
        porSector.get(row.sector).push(row);
      }
      const picked = [];
      for (const [sector, sectorRows] of porSector) {
        const sorted = [...sectorRows].sort((a, b) => b.tirEff - a.tirEff);
        picked.push(...sorted.slice(0, 2));
        if (sectorRows.length <= 2) {
          const grupoLabel = C().GRUPO_TIR_LABELS[g] || g;
          notasSector.push(
            `${grupoLabel} · ${sector}: solo ${sectorRows.length} instrumento(s) en el panel.`
          );
        }
      }
      if (!picked.length) continue;
      porGrupo[g] = picked.map(metaPresetRow);
      for (const row of picked) {
        const t = row.item.ticker;
        if (!vistos.has(t)) {
          vistos.add(t);
          seleccionados.push(row);
        }
      }
    }

    if (!seleccionados.length) {
      return {
        pesos: {},
        porGrupo: {},
        nota: "No hay TIR comparables para armar el preset.",
        notasSector,
      };
    }
    const pesos = distribuirPesosIguales(seleccionados.map((r) => r.item.ticker));
    return {
      pesos,
      porGrupo,
      nota: "Ejemplo ilustrativo: hasta 2 tickers por sector dentro de cada grupo TIR comparable, pesos iguales.",
      notasSector,
    };
  }

  function presetMayorTir(enriquecidos) {
    const TOP_N = 2;
    const { seleccionados, porGrupo } = seleccionPresetPorGrupo(
      agruparPorTirGrupo(enriquecidos),
      (rows) => [...rows].sort((a, b) => b.tirEff - a.tirEff).slice(0, TOP_N)
    );
    if (!seleccionados.length) {
      return { pesos: {}, porGrupo: {}, nota: "Sin TIR efectiva comparable disponible." };
    }
    const pesos = distribuirPesosIguales(seleccionados.map((r) => r.item.ticker));
    return {
      pesos,
      porGrupo,
      nota: `Ejemplo ilustrativo: hasta ${TOP_N} mayores TIR efectivas por grupo comparable (no ranking global), pesos iguales. Mayor TIR no implica mejor inversión ni comparabilidad entre grupos.`,
    };
  }

  function proyeccionCompuesta(capital, tirPct, anos) {
    if (!capital || tirPct == null) return null;
    return capital * Math.pow(1 + tirPct / 100, anos);
  }

  window.CotizAnalytics = {
    calcularKPIs,
    calcularKPIsPorMoneda,
    calcularKPIsPorGrupoTir,
    mejorTirPorSector,
    mejorTirPorSectorGrupo,
    estimarProximoCupon,
    proximoCuponInfo,
    plazoRestante,
    proximosVencimientos,
    proximosCupones,
    composicionPorSector,
    generarObservaciones,
    presetConservador,
    presetBalanceado,
    presetMayorTir,
    proyeccionCompuesta,
  };
})();
