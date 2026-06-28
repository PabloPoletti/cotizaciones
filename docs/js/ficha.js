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

  function fmtFechaCorta(iso) {
    if (!iso) return "—";
    return C().formatearFechaCorta(iso);
  }

  function tablaCronogramaCupon(info) {
    const filas = info.cronograma_cupon;
    if (!filas?.length) return "";
    const esStep = info.cupon_tipo === "step_up";
    const titulo = esStep ? "Cronograma de cupón step-up" : "Cronograma de cupón";
    const rows = filas
      .map(
        (r) => `<tr>
          <td>${C().escapeHtml(fmtFechaCorta(r.desde))} → ${C().escapeHtml(fmtFechaCorta(r.hasta))}</td>
          <td class="num">${r.tasa_anual}%</td>
        </tr>`
      )
      .join("");
    return `
      <div class="ficha-cronograma-wrap">
        <h3 class="ficha-cronograma-title">${C().escapeHtml(titulo)}</h3>
        ${info.cupon_fecha_pago ? `<p class="header__meta">Pagos: ${C().escapeHtml(info.cupon_fecha_pago)}</p>` : ""}
        <div class="table-wrap ficha-cronograma-table-wrap">
          <table class="ficha-cronograma-table">
            <thead><tr><th>Período vigente</th><th class="num">Tasa anual</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${info.fuente_cronograma ? `<p class="header__meta">Fuente: ${C().escapeHtml(info.fuente_cronograma)}</p>` : ""}
      </div>`;
  }

  function tablaCronogramaAmort(info) {
    const filas = info.cronograma_amortizacion;
    if (!filas?.length) return "";
    let rem = 100;
    const rows = filas
      .map((r) => {
        const pct = Number(r.porcentaje) || 0;
        rem = Math.max(0, Math.round((rem - pct) * 10000) / 10000);
        return `<tr>
          <td>${C().escapeHtml(fmtFechaCorta(r.fecha))}</td>
          <td class="num">${pct.toFixed(3).replace(/\.?0+$/, "")}%</td>
          <td class="num">${rem.toFixed(2)}%</td>
        </tr>`;
      })
      .join("");
    return `
      <div class="ficha-cronograma-wrap">
        <h3 class="ficha-cronograma-title">Cronograma de amortización de capital</h3>
        <p class="header__meta">Capital remanente estimado sobre VN 100, restando cuotas acumuladas.</p>
        <div class="table-wrap ficha-cronograma-table-wrap">
          <table class="ficha-cronograma-table">
            <thead><tr><th>Fecha</th><th class="num">% amortizado</th><th class="num">Remanente</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${info.fuente_cronograma ? `<p class="header__meta">Fuente: ${C().escapeHtml(info.fuente_cronograma)}</p>` : ""}
      </div>`;
  }

  function renderAmortizacionBlock(info) {
    if (info.cronograma_amortizacion?.length) {
      return `<section class="ficha-section ficha-section--manual">${tablaCronogramaAmort(info)}</section>`;
    }
    const esParcial =
      info.amortizacion_tipo === "amortizacion_parcial" ||
      (info.amortizacion && !/bullet/i.test(String(info.amortizacion_tipo || "")));
    if (!esParcial || info.amortizacion_tipo === "bullet") return "";
    const texto = info.amortizacion || datoNoDisponible();
    return `
      <section class="ficha-section ficha-section--manual">
        <div class="ficha-cronograma-wrap">
          <h3 class="ficha-cronograma-title">Devolución de capital (referencia)</h3>
          <p>${C().escapeHtml(texto)}</p>
          <p class="header__meta ficha-cronograma-nota">
            Cronograma detallado no disponible en este panel — consultar prospecto oficial para fechas exactas de amortización.
          </p>
        </div>
      </section>`;
  }

  function renderManualBlock(info) {
    const disc = manualDataDisclaimer(info);
    const emision = info.fecha_emision
      ? C().escapeHtml(info.fecha_emision)
      : "No disponible — consultar prospecto oficial";
    const esStep = info.cupon_tipo === "step_up";
    const tasaHtml = esStep
      ? `<span class="meta">Step-up — ver cronograma abajo</span>`
      : info.cupon_tasa_anual != null
        ? `${info.cupon_tasa_anual}%`
        : info.cronograma_cupon?.length
          ? `<span class="meta">Ver cronograma</span>`
          : C().escapeHtml(datoNoDisponible());

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
          <dd>${tasaHtml}</dd>
          <dt>Frecuencia de pago</dt>
          <dd>${info.cupon_frecuencia ? C().escapeHtml(info.cupon_frecuencia) : C().escapeHtml(datoNoDisponible())}${info.cupon_fecha_pago ? ` <span class="meta">(${C().escapeHtml(info.cupon_fecha_pago)})</span>` : ""}</dd>
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
        ${tablaCronogramaCupon(info)}
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
    const tirMerc = row.tirMerc || C().calcularTirMercado(item.precio, info);
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

  function renderSensibilidadTasasBlock(row) {
    const rp = row.riesgoPrecio || C().calcularDuracionConvexidad(row.info, row.item);
    if (rp.ok) {
      const impacto = rp.impacto1ppPct;
      const impactoTxt =
        impacto != null
          ? `Si las tasas de mercado suben 1 punto porcentual (1 pp), el precio de este bono caería aproximadamente ${Math.abs(impacto).toFixed(2)}%. Si bajan 1 pp, subiría aproximadamente lo mismo en sentido contrario.`
          : "";
      return `
        <div class="ficha-subsection ficha-subsection--sensibilidad">
          <h3>Sensibilidad a tasas (YTM implícita)</h3>
          <div class="ficha-kpi-grid ficha-kpi-grid--4">
            <div class="ficha-kpi">
              <span class="label">YTM implícita</span>
              <strong class="num">${rp.ytm.toFixed(2)}%</strong>
              <span class="meta">Desde precio BYMA y flujos del panel</span>
            </div>
            <div class="ficha-kpi">
              <span class="label">Duración modificada</span>
              <strong class="num">${rp.duracionModificada.toFixed(2)} años</strong>
              <span class="meta">Macaulay ${rp.duracionMacaulay.toFixed(2)} a</span>
            </div>
            <div class="ficha-kpi">
              <span class="label">Convexidad</span>
              <strong class="num">${rp.convexidad.toFixed(2)}</strong>
              <span class="meta">Curvatura del precio vs tasa</span>
            </div>
            <div class="ficha-kpi">
              <span class="label">Flujos modelados</span>
              <strong class="num">${rp.flujosCount}</strong>
              <span class="meta">Cupones + amort. futuros</span>
            </div>
          </div>
          <p class="header__meta ficha-edu-intro">${C().escapeHtml(impactoTxt)} Estimación sobre nominal 100; no incluye riesgo crediticio ni cambios de curva compleja.</p>
        </div>
      `;
    }
    const motivo =
      rp.motivo ||
      C().motivoDuracionNoDisponible(row.info) ||
      "Duración no disponible — no se pudo calcular con los datos del panel.";
    return `
      <div class="ficha-subsection ficha-subsection--sensibilidad">
        <h3>Sensibilidad a tasas</h3>
        <p class="ficha-empty">${C().escapeHtml(motivo)}</p>
      </div>
    `;
  }

  function renderRiesgoBlock(row) {
    const hp = row.hp;
    const liq = row.liquidez;
    const sensibilidad = renderSensibilidadTasasBlock(row);

    if (!hp && !liq) {
      return `
        <section class="ficha-section ficha-section--live">
          <div class="ficha-section__head"><h2>Riesgo de precio</h2>${sectionBadge("live")}</div>
          ${sensibilidad}
          <p class="ficha-empty">${C().escapeHtml(datoNoDisponible())} — histórico BYMA ~90d: ejecutá el workflow «Bootstrap histórico precios».</p>
        </section>
      `;
    }

    return `
      <section class="ficha-section ficha-section--live">
        <div class="ficha-section__head">
          <h2>Riesgo de precio</h2>
          ${sectionBadge("live")}
        </div>
        ${sensibilidad}
        <h3 class="ficha-subhead">Histórico BYMA ~90d</h3>
        <div class="ficha-kpi-grid ficha-kpi-grid--5">
          <div class="ficha-kpi"><span class="label">Liquidez</span><strong>${C().escapeHtml(liq?.label || "—")}</strong></div>
          <div class="ficha-kpi"><span class="label">Vol. prom.</span><strong>${hp?.volumen_promedio != null ? H().formatearVolumen(hp.volumen_promedio) : "—"}</strong></div>
          <div class="ficha-kpi"><span class="label">Var. 7d</span><strong>${H()?.formatearPct(hp?.var_7d_pct) ?? "—"}</strong></div>
          <div class="ficha-kpi"><span class="label">Var. 30d</span><strong>${H()?.formatearPct(hp?.var_30d_pct) ?? "—"}</strong></div>
          <div class="ficha-kpi"><span class="label">Drawdown máx.</span><strong>${hp?.drawdown_max_pct != null ? `${hp.drawdown_max_pct.toFixed(2)}%` : "—"}</strong></div>
        </div>
        <p class="header__meta">Volatilidad 30d: ${hp?.volatilidad_30d_pct != null ? `${hp.volatilidad_30d_pct.toFixed(2)}% (desvío diario)` : "—"} — riesgo de precio observado, distinto del riesgo crediticio.</p>
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
      ${renderAmortizacionBlock(info)}
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
