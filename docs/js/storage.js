/**
 * Persistencia en localStorage: cartera e historial local de precios.
 */
(function () {
  "use strict";

  const KEY_CARTERA = "cotizaciones_cartera_v1";
  const KEY_HISTORICO = "cotizaciones_historico_local_v1";

  function cargarCartera() {
    try {
      const raw = localStorage.getItem(KEY_CARTERA);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function guardarCartera(datos) {
    localStorage.setItem(
      KEY_CARTERA,
      JSON.stringify({ ...datos, guardadoEn: new Date().toISOString() })
    );
  }

  function fechaHoyISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function cargarHistoricoLocal() {
    try {
      const raw = localStorage.getItem(KEY_HISTORICO);
      return raw ? JSON.parse(raw) : { inicio: null, registros: [] };
    } catch {
      return { inicio: null, registros: [] };
    }
  }

  function registrarSnapshotDiario(instrumentos) {
    if (!Array.isArray(instrumentos) || !instrumentos.length) return cargarHistoricoLocal();

    const hoy = fechaHoyISO();
    const store = cargarHistoricoLocal();
    if (!store.inicio) store.inicio = hoy;

    const yaExiste = store.registros.some((r) => r.fecha === hoy);
    if (!yaExiste) {
      store.registros.push({
        fecha: hoy,
        precios: instrumentos
          .filter((i) => i.precio != null && !i.error)
          .map((i) => ({ ticker: i.ticker, precio: i.precio })),
      });
      store.registros.sort((a, b) => a.fecha.localeCompare(b.fecha));
      localStorage.setItem(KEY_HISTORICO, JSON.stringify(store));
    }
    return store;
  }

  function historicoParaTicker(ticker) {
    const store = cargarHistoricoLocal();
    return store.registros
      .map((r) => {
        const p = r.precios.find((x) => x.ticker === ticker);
        return p ? { fecha: r.fecha, precio: p.precio } : null;
      })
      .filter(Boolean);
  }

  window.CotizStorage = {
    cargarCartera,
    guardarCartera,
    cargarHistoricoLocal,
    registrarSnapshotDiario,
    historicoParaTicker,
    fechaHoyISO,
  };
})();
