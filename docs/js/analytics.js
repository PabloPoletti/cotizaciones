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
    const ons = enriquecidos.filter((r) => !r.esSoberano).length;
    const soberanos = enriquecidos.filter((r) => r.esSoberano).length;
    const monedas = new Set(enriquecidos.map((r) => r.info.moneda || "USD"));

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

  function mejorTirPorSector(enriquecidos) {
    const mapa = new Map();
    for (const row of enriquecidos) {
      if (row.tirEff == null) continue;
      const prev = mapa.get(row.sector);
      if (!prev || row.tirEff > prev.tirEff) mapa.set(row.sector, row);
    }
    return [...mapa.entries()]
      .map(([sector, row]) => ({
        sector,
        ticker: row.item.ticker,
        nombre: row.item.nombre || row.info.nombre,
        tirEff: row.tirEff,
        vencimiento: row.info.vencimiento,
      }))
      .sort((a, b) => a.sector.localeCompare(b.sector));
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
    const venc = C().parsearVencimiento(info.vencimiento);
    if (!venc) return null;
    const hoy = new Date();
    hoy.setHours(12, 0, 0, 0);
    const freq = info.cupon_frecuencia === "anual" ? 12 : 6;
    let candidato = new Date(venc);
    while (candidato > hoy) {
      candidato = new Date(candidato);
      candidato.setMonth(candidato.getMonth() - freq);
    }
    while (candidato <= hoy) {
      candidato = new Date(candidato);
      candidato.setMonth(candidato.getMonth() + freq);
    }
    if (candidato > venc) return null;
    return candidato;
  }

  function proximosCupones(enriquecidos, limite = 12) {
    return enriquecidos
      .map((r) => {
        const fecha = estimarProximoCupon(r.info);
        return fecha
          ? {
              ticker: r.item.ticker,
              nombre: r.item.nombre || r.info.nombre,
              fecha,
              cupon: r.info.cupon,
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.fecha - b.fecha)
      .slice(0, limite);
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

    for (const row of mejorTirPorSector(enriquecidos)) {
      bullets.push(
        `En <strong>${C().escapeHtml(row.sector)}</strong>, la TIR efectiva más alta del panel es ` +
          `<strong>${row.ticker}</strong> (~${row.tirEff.toFixed(2)}%). Comparación relativa dentro del sector, no calidad crediticia.`
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

    return bullets;
  }

  function presetConservador(enriquecidos) {
    const sel = enriquecidos.filter((r) => r.tirEff != null && r.tirEff < 8);
    if (!sel.length) return { pesos: {}, nota: "Ningún instrumento cumple TIR < 8%." };
    const pct = 100 / sel.length;
    const pesos = {};
    sel.forEach((r) => {
      pesos[r.item.ticker] = pct;
    });
    return {
      pesos,
      nota: "Ejemplo ilustrativo: reparto igualitario entre instrumentos con TIR efectiva < 8%.",
    };
  }

  function presetBalanceado(enriquecidos) {
    const porSector = new Map();
    const notasSector = [];
    for (const row of enriquecidos) {
      if (row.tirEff == null) continue;
      if (!porSector.has(row.sector)) porSector.set(row.sector, []);
      porSector.get(row.sector).push(row);
    }
    const seleccionados = [];
    for (const [sector, rows] of porSector) {
      const sorted = [...rows].sort((a, b) => b.tirEff - a.tirEff);
      const top = sorted.slice(0, 2);
      if (rows.length <= 2) {
        notasSector.push(
          `${sector}: solo ${rows.length} instrumento(s) en el panel — el preset incluye el 100% del sector sin comparación real entre alternativas.`
        );
      }
      seleccionados.push(...top);
    }
    if (!seleccionados.length) {
      return { pesos: {}, nota: "No hay TIR calculables para armar el preset.", notasSector };
    }
    const pct = 100 / seleccionados.length;
    const pesos = {};
    seleccionados.forEach((r) => {
      pesos[r.item.ticker] = pct;
    });
    return {
      pesos,
      nota: "Ejemplo ilustrativo: hasta 2 tickers por sector con mayor TIR efectiva, pesos iguales.",
      notasSector,
    };
  }

  function presetMayorTir(enriquecidos) {
    const sorted = enriquecidos
      .filter((r) => r.tirEff != null)
      .sort((a, b) => b.tirEff - a.tirEff)
      .slice(0, 5);
    if (!sorted.length) return { pesos: {}, nota: "Sin TIR efectiva disponible." };
    const pct = 100 / sorted.length;
    const pesos = {};
    sorted.forEach((r) => {
      pesos[r.item.ticker] = pct;
    });
    return {
      pesos,
      nota: "Ejemplo ilustrativo: 5 mayores TIR efectivas, pesos iguales. Mayor TIR no implica mejor inversión.",
    };
  }

  function proyeccionCompuesta(capital, tirPct, anos) {
    if (!capital || tirPct == null) return null;
    return capital * Math.pow(1 + tirPct / 100, anos);
  }

  window.CotizAnalytics = {
    calcularKPIs,
    mejorTirPorSector,
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
