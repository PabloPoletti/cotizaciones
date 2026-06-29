/**
 * Integridad del universo: info_fija ↔ cotizaciones ↔ metadata Data912.
 * Uso: node scripts/test_integridad_universo.mjs [--simular-ce8e6c2]
 */
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INFO_PATH = join(ROOT, "docs/data/info_fija.json");
const COT_PATH = join(ROOT, "docs/data/cotizaciones.json");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function tickersInfoFija(info) {
  return Object.keys(info)
    .filter((k) => !k.startsWith("_"))
    .sort();
}

function verificarIntegridad(cot, info, etiqueta = "actual") {
  const infoKeys = tickersInfoFija(info);
  const nInfo = infoKeys.length;
  const instrumentos = cot.instrumentos || [];
  const nInst = instrumentos.length;
  const cotKeys = instrumentos.map((i) => i.ticker).sort();

  assert(nInfo === nInst, `[${etiqueta}] info_fija (${nInfo}) !== cotizaciones.instrumentos (${nInst})`);

  const setInfo = new Set(infoKeys);
  const setCot = new Set(cotKeys);
  const soloInfo = infoKeys.filter((t) => !setCot.has(t));
  const soloCot = cotKeys.filter((t) => !setInfo.has(t));
  assert(
    !soloInfo.length && !soloCot.length,
    `[${etiqueta}] tickers distintos — solo info_fija: ${soloInfo.join(", ") || "—"}; solo cotizaciones: ${soloCot.join(", ") || "—"}`
  );

  const d912 = cot.data912;
  if (d912 && d912.error !== true) {
    assert(
      d912.tickers_solicitados != null,
      `[${etiqueta}] data912.tickers_solicitados ausente`
    );
    assert(
      d912.tickers_solicitados === nInst,
      `[${etiqueta}] data912.tickers_solicitados (${d912.tickers_solicitados}) !== instrumentos (${nInst})`
    );
    if (d912.tickers_encontrados != null) {
      assert(
        d912.tickers_encontrados <= d912.tickers_solicitados,
        `[${etiqueta}] data912.tickers_encontrados (${d912.tickers_encontrados}) > tickers_solicitados (${d912.tickers_solicitados})`
      );
    }
  }

  const okPrecio = instrumentos.filter((i) => !i.error && i.precio != null).length;
  const msg = cot.fetch_mensaje || "";
  const m = msg.match(/\((\d+)\/(\d+)\s+instrumentos\)/);
  if (m) {
    const okMsg = Number(m[1]);
    const totalMsg = Number(m[2]);
    assert(totalMsg === nInst, `[${etiqueta}] fetch_mensaje total (${totalMsg}) !== instrumentos (${nInst})`);
    assert(
      okMsg === okPrecio,
      `[${etiqueta}] fetch_mensaje ok (${okMsg}) !== instrumentos con precio (${okPrecio})`
    );
  }

  return { nInfo, nInst, data912: d912, okPrecio };
}

function cargarCotizacionesCe8e6c2() {
  try {
    const raw = execSync("git show ce8e6c2:docs/data/cotizaciones.json", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function main() {
  const simularFlag = process.argv.includes("--simular-ce8e6c2");
  let failed = false;
  const fail = (name, err) => {
    console.error(`  FAIL ${name}: ${err.message}`);
    failed = true;
  };
  const ok = (name, detail = "") => {
    console.log(`  OK   ${name}${detail ? ` — ${detail}` : ""}`);
  };

  console.log("test_integridad_universo.mjs");

  if (!existsSync(INFO_PATH) || !existsSync(COT_PATH)) {
    console.error("Faltan docs/data/info_fija.json o cotizaciones.json");
    process.exit(1);
  }

  const info = JSON.parse(readFileSync(INFO_PATH, "utf8"));
  const cot = JSON.parse(readFileSync(COT_PATH, "utf8"));

  try {
    const r = verificarIntegridad(cot, info, "HEAD");
    ok(
      "universo actual alineado",
      `${r.nInfo} tickers, data912 solicitud=${r.data912?.tickers_solicitados}, encontrados=${r.data912?.tickers_encontrados}, precio=${r.okPrecio}/${r.nInst}`
    );
  } catch (e) {
    fail("universo actual alineado", e);
  }

  const cotCe8 = cargarCotizacionesCe8e6c2();
  if (cotCe8) {
    let debioFallar = false;
    try {
      verificarIntegridad(cotCe8, info, "ce8e6c2");
    } catch {
      debioFallar = true;
    }
    if (debioFallar) {
      ok(
        "regresión ce8e6c2 detectada",
        `instrumentos=${cotCe8.instrumentos.length}, data912.tickers_solicitados=${cotCe8.data912?.tickers_solicitados} (hubiera fallado el test)`
      );
    } else {
      fail("regresión ce8e6c2 detectada", new Error("ce8e6c2 pasó verificación — commit no reproducible"));
    }
  } else {
    console.log("  SKIP regresión ce8e6c2 (git show no disponible)");
  }

  if (simularFlag) {
    const fake = structuredClone(cot);
    fake.data912 = { ...fake.data912, tickers_solicitados: 59 };
    let debioFallar = false;
    try {
      verificarIntegridad(fake, info, "simulación 59/62");
    } catch {
      debioFallar = true;
    }
    if (debioFallar) {
      ok("simulación 59 vs 62 rechazada", "como en incidente ce8e6c2");
    } else {
      fail("simulación 59 vs 62 rechazada", new Error("no detectó desalineación simulada"));
    }
  }

  console.log(failed ? "\nFALLÓ integridad" : "\nOK integridad");
  process.exit(failed ? 1 : 0);
}

main();
