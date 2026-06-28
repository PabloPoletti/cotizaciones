/**
 * Agrega tir_comparable_grupo a cada instrumento en info_fija.json.
 * Uso: node scripts/aplicar_tir_grupos_json.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INFO_PATH = join(__dirname, "../docs/data/info_fija.json");

const GRUPOS = ["USD_HARD", "ARS_NOMINAL", "ARS_CER_REAL", "ARS_DOLLAR_LINKED", "NO_COMPARABLE"];

function parsearVencimiento(texto) {
  if (!texto) return null;
  const partes = String(texto).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (partes) {
    const [, d, m, y] = partes;
    return new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00`);
  }
  if (/^\d{4}$/.test(String(texto))) return new Date(`${texto}-12-31T12:00:00`);
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

function inferirTirComparableGrupo(info) {
  if (estadoVigencia(info) === "vencido") return "NO_COMPARABLE";
  const cat = info.categoria || "";
  if (cat === "CEDEAR" || cat === "BCRA") return "NO_COMPARABLE";
  const moneda = info.moneda || "USD";
  if (moneda === "USD") return "USD_HARD";
  if (moneda === "ARS-CER") return "ARS_CER_REAL";
  if (moneda === "ARS dollar-linked") return "ARS_DOLLAR_LINKED";
  if (moneda === "ARS") return "ARS_NOMINAL";
  return "NO_COMPARABLE";
}

const data = JSON.parse(readFileSync(INFO_PATH, "utf8"));
let n = 0;
for (const [ticker, info] of Object.entries(data)) {
  if (ticker.startsWith("_")) continue;
  info.tir_comparable_grupo = inferirTirComparableGrupo(info);
  n++;
}
writeFileSync(INFO_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`Actualizados ${n} instrumentos en info_fija.json`);
