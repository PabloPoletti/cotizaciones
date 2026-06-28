/**
 * Tests unitarios de cálculos del panel (core.js).
 * Uso: node scripts/test_calculos.mjs
 */
import { readFileSync } from "fs";
import { createContext, runInContext } from "vm";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_PATH = join(__dirname, "../docs/js/core.js");
const INFO_PATH = join(__dirname, "../docs/data/info_fija.json");

function loadCore() {
  const code = readFileSync(CORE_PATH, "utf8");
  const sandbox = {
    window: {},
    console,
    document: { createElement: () => ({ textContent: "", innerHTML: "" }) },
  };
  createContext(sandbox);
  runInContext(code, sandbox);
  return sandbox.window.CotizCore;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertNear(actual, expected, tol, label) {
  assert(
    actual != null && Math.abs(actual - expected) <= tol,
    `${label}: esperado ~${expected}, obtuvo ${actual}`
  );
}

function runTests(C, infoFija) {
  let passed = 0;
  const fail = (name, err) => {
    console.error(`  FAIL ${name}: ${err.message}`);
    process.exitCode = 1;
  };

  const test = (name, fn) => {
    try {
      fn();
      passed += 1;
      console.log(`  OK   ${name}`);
    } catch (e) {
      fail(name, e);
    }
  };

  console.log("\n=== estadoVigencia ===");
  test("TX26 vencido (Boncer 2026-03-15)", () => {
    assert(C.estadoVigencia(infoFija.TX26) === "vencido", "TX26 debería estar vencido");
  });
  test("TTC9O vigente", () => {
    assert(C.estadoVigencia(infoFija.TTC9O) === "vigente", "TTC9O debería estar vigente");
  });
  test("Perpetuo → sin_fecha", () => {
    assert(C.estadoVigencia({ vencimiento: "Perpetuo" }) === "sin_fecha", "Perpetuo → sin_fecha");
  });

  console.log("\n=== tirComparableGrupo ===");
  test("USD ON → USD_HARD", () => {
    assert(C.tirComparableGrupo(infoFija.TTC9O) === "USD_HARD", "TTC9O → USD_HARD");
  });
  test("ARS-CER vigente → ARS_CER_REAL", () => {
    const sample = Object.values(infoFija).find(
      (i) => i.moneda === "ARS-CER" && C.estadoVigencia(i) === "vigente"
    );
    assert(sample, "falta muestra ARS-CER vigente");
    assert(C.tirComparableGrupo(sample) === "ARS_CER_REAL", "ARS-CER → ARS_CER_REAL");
  });
  test("Vencido → NO_COMPARABLE", () => {
    assert(C.tirComparableGrupo(infoFija.TX26) === "NO_COMPARABLE", "vencido → NO_COMPARABLE");
  });
  test("Lecap S31G6 → ARS_NOMINAL", () => {
    assert(C.tirComparableGrupo(infoFija.S31G6) === "ARS_NOMINAL", "S31G6 → ARS_NOMINAL");
  });

  console.log("\n=== soportaTirMercado ===");
  test("Bullet USD semestral → ok", () => {
    assert(C.soportaTirMercado(infoFija.TTC9O).ok === true, "TTC9O soporta TIR mercado");
  });
  test("Cronograma GD38 → no (amort programada)", () => {
    const s = C.soportaTirMercado(infoFija.GD38);
    assert(s.ok === false, "GD38 no soporta TIR mercado bullet");
    assert(/referencia/i.test(s.nota), "nota menciona referencia");
  });
  test("ARS-CER → no", () => {
    assert(C.soportaTirMercado(infoFija.TX26).ok === false, "Boncer no soporta TIR mercado");
  });
  test("Lecap mensual → no", () => {
    assert(C.soportaTirMercado(infoFija.S31G6).ok === false, "Lecap no soporta TIR mercado");
  });

  console.log("\n=== calcularTirMercado ===");
  test("Bullet a la par ≈ cupón (TTC9O precio 100)", () => {
    const r = C.calcularTirMercado(100000, infoFija.TTC9O);
    assert(r.valor != null, "TIR debería calcularse");
    assertNear(r.valor, infoFija.TTC9O.cupon_tasa_anual, 0.15, "TIR a la par");
  });
  test("Sin soporte → valor null + nota", () => {
    const r = C.calcularTirMercado(100000, infoFija.GD38);
    assert(r.valor == null, "GD38 TIR mercado null");
    assert(r.nota, "debe tener nota explicativa");
  });
  test("Vencido → null", () => {
    const r = C.calcularTirMercado(100000, infoFija.TX26);
    assert(r.valor == null, "vencido sin TIR");
  });

  console.log("\n=== soportaDuracion / motivoDuracionNoDisponible ===");
  test("Bullet USD → soporta", () => {
    assert(C.soportaDuracion(infoFija.TTC9O), "TTC9O soporta duración");
  });
  test("GD38 cronograma → soporta", () => {
    assert(C.soportaDuracion(infoFija.GD38), "GD38 soporta duración");
  });
  test("S31G6 Lecap → motivo Lecap", () => {
    assert(!C.soportaDuracion(infoFija.S31G6), "S31G6 no soporta");
    assert(
      /Lecap|capitalización mensual/i.test(C.motivoDuracionNoDisponible(infoFija.S31G6)),
      "motivo Lecap"
    );
  });
  test("Boncer ARS-CER vigente → motivo CER", () => {
    const boncer = Object.values(infoFija).find(
      (i) => i.moneda === "ARS-CER" && C.estadoVigencia(i) === "vigente"
    );
    assert(boncer, "falta Boncer vigente");
    assert(/CER/i.test(C.motivoDuracionNoDisponible(boncer)), "motivo CER");
  });

  console.log("\n=== YTM / duración / convexidad (bono simple verificable) ===");
  test("YTM implícita 10% a la par (2 cupones semestrales)", () => {
    const flujos = [
      { tAnios: 0.5, monto: 5 },
      { tAnios: 1.0, monto: 105 },
    ];
    const ytm = C.calcularYtmDesdeFlujos(100, flujos, 2);
    assertNear(ytm.valor, 10, 0.05, "YTM");
    const dur = C.calcularDuracionModificada(flujos, 100, ytm.valor, 2);
    assertNear(dur.macaulay, 0.976, 0.002, "Macaulay (pesos PV)");
    assertNear(dur.modified, 0.976 / 1.05, 0.002, "Duración modificada");
    assertNear(dur.impacto1ppPct, -(0.976 / 1.05), 0.02, "Impacto 1pp");
    const conv = C.calcularConvexidad(flujos, 100, ytm.valor, 2);
    assert(conv > 0, "convexidad positiva");
  });
  test("calcularDuracionConvexidad exige YTM (sin fallback silencioso)", () => {
    const r = C.calcularDuracionConvexidad(infoFija.TTC9O, { precio: 100000 });
    assert(r.ok === true, "TTC9O con precio válido");
    assert(r.ytm != null, "YTM explícita");
    assert(r.duracionModificada > 0, "duración > 0");
    assert(r.convexidad > 0, "convexidad > 0");
    assert(!String(r.ytmNota || "").includes("referencia"), "nota no es TIR referencia");
  });
  test("YTM negativa en premium (precio > suma flujos)", () => {
    const flujos = [{ tAnios: 1, monto: 100 }];
    const ytm = C.calcularYtmDesdeFlujos(110, flujos, 1);
    assert(ytm.valor != null && ytm.valor < 0, "YTM negativa en premium");
  });

  console.log("\n=== cobertura universo duración ===");
  test("26 vigentes con flujos modelables", () => {
    const tickers = Object.keys(infoFija).filter((k) => !k.startsWith("_"));
    let soporta = 0;
    let flujosOk = 0;
    for (const t of tickers) {
      const info = infoFija[t];
      if (C.estadoVigencia(info) === "vencido") continue;
      if (C.soportaDuracion(info)) {
        soporta += 1;
        if (C.generarFlujosCaja(info).ok) flujosOk += 1;
      }
    }
    assert(soporta === 26, `esperado 26 soporta, obtuvo ${soporta}`);
    assert(flujosOk === 26, `esperado 26 flujos, obtuvo ${flujosOk}`);
  });

  return passed;
}

function main() {
  const C = loadCore();
  const infoFija = JSON.parse(readFileSync(INFO_PATH, "utf8"));
  console.log("test_calculos.mjs — core.js");
  const passed = runTests(C, infoFija);
  const failed = process.exitCode === 1;
  console.log(`\n${failed ? "FALLÓ" : "OK"}: ${passed} tests${failed ? " (con errores)" : ""}`);
  if (failed) process.exit(1);
}

main();
