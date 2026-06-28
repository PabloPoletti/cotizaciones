/**
 * Auditoría completa de proximoCuponInfo() para todos los instrumentos.
 * Uso: node scripts/audit_proximo_cupon.mjs
 */
import { readFileSync } from "fs";
import { createContext, runInContext } from "vm";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCore() {
  const code = readFileSync(join(__dirname, "../docs/js/core.js"), "utf8");
  const sandbox = {
    window: {},
    console,
    document: { createElement: () => ({ textContent: "", innerHTML: "" }) },
  };
  createContext(sandbox);
  runInContext(code, sandbox);
  return sandbox.window.CotizCore;
}

const METODO_LABEL = {
  canje_2020: "Calendario real canje 2020",
  heuristica: "Heurística (advertencia fuerte)",
  no_aplica: "No aplica",
};

function main() {
  const C = loadCore();
  const infoFija = JSON.parse(readFileSync(join(__dirname, "../docs/data/info_fija.json"), "utf8"));
  const tickers = Object.keys(infoFija)
    .filter((k) => !k.startsWith("_"))
    .sort();

  const rows = [];
  const resumen = { canje_2020: 0, heuristica: 0, no_aplica: 0 };

  for (const ticker of tickers) {
    const info = infoFija[ticker];
    const pc = C.proximoCuponInfo(info);
    resumen[pc.metodo] = (resumen[pc.metodo] || 0) + 1;
    rows.push({
      ticker,
      vigencia: C.estadoVigencia(info),
      metodo: pc.metodo,
      metodoLabel: METODO_LABEL[pc.metodo] || pc.metodo,
      categoria: pc.categoria || "—",
      fecha: pc.fecha ? pc.fecha.toLocaleDateString("es-AR") : "—",
      detalle: pc.metodo === "no_aplica" ? pc.motivo : pc.meta,
    });
  }

  console.log(`\n=== Resumen (${tickers.length} instrumentos) ===`);
  console.log(`  Calendario canje 2020: ${resumen.canje_2020}`);
  console.log(`  Heurística:            ${resumen.heuristica}`);
  console.log(`  No aplica:             ${resumen.no_aplica}`);
  console.log(`  Vigentes:              ${rows.filter((r) => r.vigencia === "vigente").length}`);

  console.log("\n=== Listado completo ===\n");
  const col = (s, w) => String(s ?? "—").slice(0, w).padEnd(w);
  console.log(
    col("Ticker", 10) +
      col("Vig.", 8) +
      col("Método", 28) +
      col("Fecha", 12) +
      "Detalle"
  );
  console.log("-".repeat(120));
  for (const r of rows) {
    console.log(
      col(r.ticker, 10) +
        col(r.vigencia, 8) +
        col(r.metodoLabel, 28) +
        col(r.fecha, 12) +
        (r.detalle || "").replace(/\s+/g, " ").slice(0, 80)
    );
  }

  console.log("\n=== Por categoría (no_aplica) ===");
  const porCat = {};
  for (const r of rows.filter((x) => x.metodo === "no_aplica")) {
    porCat[r.categoria] = (porCat[r.categoria] || 0) + 1;
  }
  console.log(porCat);
}

main();
