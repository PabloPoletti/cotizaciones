/**
 * Verifica conteo de tir_comparable_grupo antes de cargar el campo en info_fija.json.
 * Usa las mismas reglas de inferencia que core.js (sin campo explícito en JSON).
 *
 * Uso: node scripts/verify_tir_grupos.mjs
 */
import { readFileSync } from "fs";
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
  if (info.tir_comparable_grupo && GRUPOS.includes(info.tir_comparable_grupo)) {
    return info.tir_comparable_grupo;
  }
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
const tickers = Object.keys(data).filter((k) => !k.startsWith("_"));

const porGrupo = Object.fromEntries(GRUPOS.map((g) => [g, []]));
const detalle = [];

for (const ticker of tickers.sort()) {
  const info = data[ticker];
  const grupo = inferirTirComparableGrupo(info);
  porGrupo[grupo].push(ticker);
  detalle.push({
    ticker,
    grupo,
    categoria: info.categoria || "—",
    moneda: info.moneda || "—",
    vigencia: estadoVigencia(info),
  });
}

const conteo = Object.fromEntries(GRUPOS.map((g) => [g, porGrupo[g].length]));
const total = tickers.length;
const suma = Object.values(conteo).reduce((a, b) => a + b, 0);

const report = {
  total,
  suma,
  ok: total === 59 && suma === 59,
  conteo,
  porGrupo: Object.fromEntries(GRUPOS.map((g) => [g, porGrupo[g].sort()])),
};

// Validar campo explícito en JSON (si existe) contra inferencia base
const mismatches = [];
for (const ticker of tickers) {
  const info = { ...data[ticker] };
  const explicit = info.tir_comparable_grupo;
  delete info.tir_comparable_grupo;
  const inferred = inferirTirComparableGrupo(info);
  if (explicit && explicit !== inferred) {
    mismatches.push({ ticker, explicit, inferred });
  }
}
report.explicitFieldOk = mismatches.length === 0;
report.mismatches = mismatches;

console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error(`ERROR: total=${total}, suma=${suma} (esperado 59/59)`);
  process.exit(1);
}
if (!report.explicitFieldOk) {
  console.error("ERROR: tir_comparable_grupo en JSON no coincide con inferencia:", mismatches);
  process.exit(1);
}

console.log("\nOK: 59 instrumentos, suma de grupos = 59.");
