/**
 * Ficha detallada por instrumento.
 * Datos: JSON (BYMA) | calculados en runtime | info_fija.json (manual).
 */
(function () {
  "use strict";

  const C = () => window.CotizCore;
  const A = () => window.CotizAnalytics;
  const H = () => window.CotizHistorico;

  /** Texto educativo fijo — no datos por ticker ni broker verificado. */
  const COMISIONES_INTRO =
    "Información general de mercado sobre comisiones típicas en brokers argentinos, " +
    "no verificada contra un broker específico en este proyecto.";

  const COMISIONES_ITEMS = [
    "Comisión de compra/venta: suele ser un porcentaje sobre el monto operado y/o un mínimo fijo; varía por broker y tipo de cuenta.",
    "Cobro de cupones: en muchos brokers ronda ~1% sobre el monto cobrado (referencia general de mercado; confirmar en tu broker).",
    "Custodia / administración: puede ser un porcentaje anual sobre tenencia o una tarifa fija mensual.",
  ];

  function manualDataDisclaimer(info) {
    const revision = info.tir_fecha_referencia || "sin fecha registrada";
    return (
      "Datos de referencia cargados manualmente (info_fija.json, última revisión: " +
      `${revision}). Pueden no reflejar cambios recientes del prospecto o reestructuraciones. ` +
      "Verificar siempre en fuente oficial antes de operar."
    );
  }

  function datoNoDisponible() {
    return "Dato no disponible — verificar en prospecto/broker";
  }

  function sectionBadge(tipo) {
    if (tipo === "live") {
      return '<span class="ficha-badge ficha-badge--live">Datos de mercado (BYMA)</span>';
    }
    if (tipo === "calc") {
      return '<span class="ficha-badge ficha-badge--calc">Calculado / estimado</span>';
    }
    return '<span class="ficha-badge ficha-badge--manual">Referencia manual (info_fija.json)</span>';
  }

  function renderManualBlock(info) {
    const disc = manualDataDisclaimer(info);
    const emision = info.fecha_emision
      ? C().escapeHtml(info.fecha_emision)
      : "No disponible — consultar prospecto oficial";

    return `
      <section class="ficha-section ficha-section--manual">
        <div class="ficha-section__head">
          <h2>Referencia del instrumento</h2>
          ${sectionBadge("manual")}
        </div>
        <div class="alert alert--warning ficha-manual-alert" role="note">
          ${C().escapeHtml(disc)}
        </div>
        <dl class="ficha-dl">
          <dt>Vencimiento</dt>
          <dd>${info.vencimiento ? C().escapeHtml(C().formatearFechaCorta(info.vencimiento)) : C().escapeHtml(datoNoDisponible())}</dd>
          <dt>Cupón (texto ref.)</dt>
          <dd>${info.cupon ? C().escapeHtml(info.cupon) : C().escapeHtml(datoNoDisponible())}</dd>
          <dt>Tasa anual ref.</dt>
          <dd>${info.cupon_tasa_anual != null ? `${info.cupon_tasa_anual}%` : C().escapeHtml(datoNoDisponible())}</dd>
          <dt>Frecuencia de pago</dt>
          <dd>${info.cupon_frecuencia ? C().escapeHtml(info.cupon_frecuencia) : C().escapeHtml(datoNoDisponible())}</dd>
          <dt>Amortización</dt>
          <dd>${info.amortizacion ? C().escapeHtml(info.amortizacion) : C().escapeHtml(datoNoDisponible())}</dd>
          <dt>Tipo amort.</dt>
          <dd>${info.amortizacion_tipo ? C().escapeHtml(info.amortizacion_tipo) : C().escapeHtml(datoNoDisponible())}</dd>
          <dt>TIR referencia</dt>
          <dd>${info.tir_referencia != null ? `${info.tir_referencia}%` : C().escapeHtml(datoNoDisponible())}${info.tir_rango ? ` <span class="meta">(rango ${C().escapeHtml(info.tir_rango)})</span>` : ""}</dd>
          <dt>Moneda</dt>
          <dd>${info.moneda ? C().escapeHtml(info.moneda) : C().escapeHtml(datoNoDisponible())}</dd>
          <dt>Ley aplicable</dt>
          <dd>${info.ley ? C().escapeHtml(info.ley) : C().escapeHtml(datoNoDisponible())}</dd>
          <dt>Sector</dt>
          <dd>${info.sector ? C().escapeHtml(info.sector) : C().escapeHtml(datoNoDisponible())}</dd>
          <dt>Fecha de emisión</dt>
          <dd>${emision}</dd>
          ${info.notas ? `<dt>Notas panel</dt><dd>${C().escapeHtml(info.notas)}</dd>` : ""}
        </dl>
      </section>
    `;
  }

  function renderPlazosBlock(info) {
    const plazo = A().plazoRestante(info);
    const proxCupon = A().estimarProximoCupon(info);
    let plazoHtml = C().escapeHtml(datoNoDisponible());
    if (plazo) {
      if (plazo.dias < 0) plazoHtml = "Vencido";
      else plazoHtml = `${plazo.anos} años (${plazo.dias} días)`;
    }

    let cuponHtml = C().escapeHtml(datoNoDisponible());
    if (proxCupon) {
      cuponHtml = `${proxCupon.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
    } else if (!info.vencimiento || !info.cupon_frecuencia) {
      cuponHtml = C().escapeHtml(datoNoDisponible());
    }

    return `
      <section class="ficha-section ficha-section--calc">
        <div class="ficha-section__head">
          <h2>Plazos y flujos</h2>
          ${sectionBadge("calc")}
        </div>
        <div class="ficha-kpi-grid ficha-kpi-grid--3">
          <div class="ficha-kpi">
            <span class="label">Plazo restante</span>
            <strong>${plazoHtml}</strong>
            <span class="meta">Calculado desde hoy</span>
          </div>
          <div class="ficha-kpi">
            <span class="label">Próximo cupón</span>
            <strong>${cuponHtml}</strong>
            <span class="meta ficha-estimado">Fecha estimada — verificar en prospecto oficial</span>
          </div>
        </div>
      </section>
    `;
  }

  function renderConfirmacionCruzadaBlock(row) {
    const det = C().detalleConfirmacionPrecio(row.item);
    if (!det) return "";

    const fmtTs = (ts) => (ts ? C().formatearFecha(ts) : "—");
    const diffStr = det.diffPct != null ? `${det.diffPct.toFixed(3)}%` : "—";

    return `
      <section class="ficha-section ficha-section--confirm">
        <div class="ficha-section__head">
          <h2>Confirmación cruzada de precio</h2>
          <span class="badge badge--confirm">✓ 2 fuentes</span>
        </div>
        <p class="header__meta">
          BYMA (principal) y Data912 (respaldo) coinciden dentro de ±${det.margenPct}%.
          Data912 es referencia educativa con cache ~2h; el precio operativo sigue siendo BYMA.
        </p>
        <dl class="ficha-dl ficha-dl--confirm">
          <dt>Precio BYMA</dt>
          <dd>${C().formatearPrecio(det.precioByma)} <span class="meta">(${C().escapeHtml(C().etiquetaPrecioTipo(row.item))})</span></dd>
          <dt>Consulta BYMA</dt>
          <dd>${C().escapeHtml(fmtTs(det.tsByma))}</dd>
          <dt>Precio Data912</dt>
          <dd>${C().formatearPrecio(det.precioData912)}${det.panelData912 ? ` <span class="meta">(panel ${C().escapeHtml(det.panelData912)})</span>` : ""}</dd>
          <dt>Consulta Data912</dt>
          <dd>${C().escapeHtml(fmtTs(det.tsData912))} <span class="meta">(misma corrida del panel)</span></dd>
          <dt>Diferencia</dt>
          <dd><strong class="num">${diffStr}</strong> <span class="meta">sobre el mayor de ambos precios</span></dd>
        </dl>
      </section>
    `;
  }

  function renderMercadoBlock(row) {
    const { item, info } = row;
    const varFmt = C().formatearVariacion(item.variacion_pct);
    const tirMerc = C().calcularTirMercado(item.precio, info);
    let tirMercHtml = "—";
    if (tirMerc.valor != null) {
      tirMercHtml = `${tirMerc.valor}% <span class="meta">(${C().escapeHtml(tirMerc.nota)})</span>`;
    } else if (tirMerc.nota) {
      tirMercHtml = `<span class="meta">${C().escapeHtml(tirMerc.nota)}</span>`;
    }

    const ultima = C().state.cotizaciones?.ultima_actualizacion;

    return `
      <section class="ficha-section ficha-section--live">
        <div class="ficha-section__head">
          <h2>Mercado y rendimiento</h2>
          ${sectionBadge("live")}
        </div>
        <div class="ficha-columns">
          <div class="ficha-kpi-grid">
            <div class="ficha-kpi">
              <span class="label">Precio</span>
              <strong>${item.error ? C().escapeHtml(item.mensaje_error || datoNoDisponible()) : C().formatearPrecioConTipo(item)}</strong>
              <span class="meta">${C().escapeHtml(C().etiquetaPrecioTipo(item))}</span>
            </div>
            <div class="ficha-kpi">
              <span class="label">Variación día</span>
              <strong class="num ${varFmt.clase}">${varFmt.texto}</strong>
            </div>
            <div class="ficha-kpi">
              <span class="label">TIR mercado</span>
              <strong>${tirMercHtml}</strong>
              <span class="meta ficha-estimado">Calculada en runtime desde precio BYMA</span>
            </div>
          </div>
        </div>
        ${ultima ? `<p class="header__meta">Última actualización panel: ${C().escapeHtml(C().formatearFecha(ultima))}</p>` : ""}
      </section>
    `;
  }

  function renderRiesgoBlock(row) {
    const hp = row.hp;
    const liq = row.liquidez;
    if (!hp && !liq) {
      return `
        <section class="ficha-section ficha-section--live">
          <div class="ficha-section__head"><h2>Riesgo de precio (BYMA ~90d)</h2>${sectionBadge("live")}</div>
          <p class="ficha-empty">${C().escapeHtml(datoNoDisponible())} — ejecutá el workflow «Bootstrap histórico precios».</p>
        </section>
      `;
    }

    return `
      <section class="ficha-section ficha-section--live">
        <div class="ficha-section__head">
          <h2>Riesgo de precio (BYMA ~90d)</h2>
          ${sectionBadge("live")}
        </div>
        <div class="ficha-kpi-grid ficha-kpi-grid--5">
          <div class="ficha-kpi"><span class="label">Liquidez</span><strong>${C().escapeHtml(liq?.label || "—")}</strong></div>
          <div class="ficha-kpi"><span class="label">Vol. prom.</span><strong>${hp?.volumen_promedio != null ? H().formatearVolumen(hp.volumen_promedio) : "—"}</strong></div>
          <div class="ficha-kpi"><span class="label">Var. 7d</span><strong>${H()?.formatearPct(hp?.var_7d_pct) ?? "—"}</strong></div>
          <div class="ficha-kpi"><span class="label">Var. 30d</span><strong>${H()?.formatearPct(hp?.var_30d_pct) ?? "—"}</strong></div>
          <div class="ficha-kpi"><span class="label">Drawdown máx.</span><strong>${hp?.drawdown_max_pct != null ? `${hp.drawdown_max_pct.toFixed(2)}%` : "—"}</strong></div>
        </div>
        <p class="header__meta">Volatilidad 30d: ${hp?.volatilidad_30d_pct != null ? `${hp.volatilidad_30d_pct.toFixed(2)}% (desvío diario)` : "—"} — riesgo de precio, no crediticio.</p>
      </section>
    `;
  }

  function renderChartsBlock(ticker) {
    const hasData = H()?.serie(ticker)?.length > 0;
    return `
      <section class="ficha-section ficha-section--live">
        <div class="ficha-section__head">
          <h2>Gráficos</h2>
          ${sectionBadge("live")}
        </div>
        <div id="ficha-charts-empty" class="ficha-empty ${hasData ? "hidden" : ""}" role="status">
          Sin serie BYMA para este ticker — ${C().escapeHtml(datoNoDisponible())}.
        </div>
        <div class="ficha-charts-grid ${hasData ? "" : "hidden"}">
          <div class="ficha-chart-card">
            <h3>Evolución precio ~90d</h3>
            <div class="chart-box ficha-chart-box"><canvas id="ficha-chart-precio"></canvas></div>
          </div>
          <div class="ficha-chart-card">
            <h3>Drawdown desde máximo</h3>
            <div class="chart-box ficha-chart-box"><canvas id="ficha-chart-drawdown"></canvas></div>
          </div>
        </div>
      </section>
    `;
  }

  function renderComisionesBlock() {
    return `
      <section class="ficha-section ficha-section--edu">
        <h2>Costos típicos al operar</h2>
        <p class="ficha-edu-intro">${C().escapeHtml(COMISIONES_INTRO)}</p>
        <ul class="ficha-edu-list">
          ${COMISIONES_ITEMS.map((t) => `<li>${C().escapeHtml(t)}</li>`).join("")}
        </ul>
        <p class="header__meta">No es asesoramiento. Comisiones y aranceles cambian; verificar en la web del broker antes de operar. Este panel no cotiza costos por operación.</p>
      </section>
    `;
  }

  function renderFicha(row, helpers) {
    const { item, info } = row;
    const nombre = item.nombre || info.nombre || item.ticker;
    const categoria = row.categoria || C().categoriaDe(info);
    const sem = helpers.semaforoHtml(item.ticker);
    const badges = helpers.badgesHtml(row);

    return `
      <header class="ficha-hero">
        <div class="ficha-hero__title">
          ${sem}
          <span class="ticker ficha-hero__ticker">${C().escapeHtml(item.ticker)}</span>
          <h2 class="ficha-hero__name">${C().escapeHtml(nombre)}</h2>
        </div>
        <div class="ficha-hero__badges">${badges}</div>
        <p class="header__meta">Categoría: ${C().escapeHtml(categoria)} · Sector: ${C().escapeHtml(row.sector)}</p>
      </header>
      ${renderMercadoBlock(row)}
      ${renderConfirmacionCruzadaBlock(row)}
      ${renderPlazosBlock(info)}
      ${renderManualBlock(info)}
      ${renderRiesgoBlock(row)}
      ${renderChartsBlock(item.ticker)}
      ${renderComisionesBlock()}
    `;
  }

  window.CotizFicha = {
    manualDataDisclaimer,
    renderFicha,
    COMISIONES_INTRO,
  };
})();
