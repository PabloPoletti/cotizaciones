/**
 * Reorganiza instrumentos_pendientes.json según auditoría P3.
 * Uso: node scripts/reorganizar_pendientes.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PEND_PATH = join(__dirname, "../docs/data/instrumentos_pendientes.json");
const INFO_PATH = join(__dirname, "../docs/data/info_fija.json");

const info = JSON.parse(readFileSync(INFO_PATH, "utf8"));
const old = JSON.parse(readFileSync(PEND_PATH, "utf8"));

const panelTickers = new Set(Object.keys(info).filter((k) => !k.startsWith("_")));
const PANEL_REVERIFICAR = new Set(["BPO27", "BPO28", "BPOD7"]);
const VENCIDOS_PANEL = new Set(["TX26", "CO26D"]);

function stripCategoria(entry) {
  const { categoria, ...rest } = entry;
  return rest;
}

const panel_activo = [...panelTickers].sort().map((ticker) => ({
  ticker,
  nombre: info[ticker]?.nombre || null,
  categoria: info[ticker]?.categoria || null,
}));

const panel_activo_a_reverificar = [];
const candidatos_pendientes = [];
const rechazados = [];
const vencidos_legacy = [];

for (const entry of old.pendiente_verificar_dia_habil || []) {
  const e = stripCategoria(entry);
  if (panelTickers.has(entry.ticker) && PANEL_REVERIFICAR.has(entry.ticker)) {
    panel_activo_a_reverificar.push({ ...e, motivo: "En panel activo — re-verificar día hábil" });
  } else if (!panelTickers.has(entry.ticker)) {
    candidatos_pendientes.push({ ...e, motivo: "Candidato — pendiente verificación día hábil" });
  }
}

for (const entry of old.rechazado_liquidez_baja || []) {
  rechazados.push({ ...stripCategoria(entry), motivo: "Rechazado — liquidez baja" });
}

for (const entry of old.ticker_no_existe_byma || []) {
  rechazados.push({ ...stripCategoria(entry), motivo: "Rechazado — ticker no existe en BYMA" });
}

for (const entry of old.rechazado_vencimiento || []) {
  const e = stripCategoria(entry);
  if (VENCIDOS_PANEL.has(entry.ticker) || panelTickers.has(entry.ticker)) {
    vencidos_legacy.push({ ...e, motivo: "Vencido / legacy en panel o histórico" });
  } else {
    rechazados.push({ ...e, motivo: "Rechazado — vencimiento anterior al corte del panel" });
  }
}

for (const t of VENCIDOS_PANEL) {
  if (!vencidos_legacy.some((e) => e.ticker === t) && panelTickers.has(t)) {
    vencidos_legacy.push({
      ticker: t,
      nombre: info[t]?.nombre || null,
      motivo: "Vencido — incluido en panel solo con «mostrar vencidos»",
    });
  }
}

const out = {
  _comentario:
    "Inventario fuera del universo operativo del panel (59 inst. en info_fija.json). No modifica info_fija.json.",
  fecha_reorganizacion: "2026-06-28",
  criterios_panel_referencia: old.criterios_panel_referencia,
  conteo: {
    panel_activo: panel_activo.length,
    panel_activo_a_reverificar: panel_activo_a_reverificar.length,
    candidatos_pendientes: candidatos_pendientes.length,
    rechazados: rechazados.length,
    vencidos_legacy: vencidos_legacy.length,
  },
  panel_activo,
  panel_activo_a_reverificar,
  candidatos_pendientes,
  rechazados,
  vencidos_legacy,
};

writeFileSync(PEND_PATH, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(JSON.stringify(out.conteo, null, 2));
