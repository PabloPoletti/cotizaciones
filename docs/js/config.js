/**
 * Configuración pública del panel (sin secretos).
 * Tras deploy del Worker, actualizá DISPATCH_WORKER_URL y commiteá.
 */
(function () {
  "use strict";

  window.CotizConfig = {
    /** URL del Cloudflare Worker (POST). Vacío = usar token local (opciones avanzadas). */
    DISPATCH_WORKER_URL: "https://cotizaciones-dispatch.lic-poletti.workers.dev/dispatch",
    /** Debe coincidir con RATE_LIMIT_SECONDS del Worker (300). */
    DISPATCH_COOLDOWN_MS: 300000,
    STORAGE_KEY_WORKER_URL: "cotizaciones_worker_url",
  };
})();
