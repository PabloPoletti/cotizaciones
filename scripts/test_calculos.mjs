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
  return { C: sandbox.window.CotizCore, window: sandbox.window };
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

function runTests(C, infoFija, win) {
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
  test("Cronograma GD38 → ok (YTM desde flujos)", () => {
    const s = C.soportaTirMercado(infoFija.GD38);
    assert(s.ok === true, "GD38 soporta TIR mercado cronograma");
    assert(s.metodo === "cronograma", "metodo cronograma");
  });
  test("AL29 cupón fijo + cronograma → ok cronograma", () => {
    const s = C.soportaTirMercado(infoFija.AL29);
    assert(s.ok === true && s.metodo === "cronograma", "AL29 cronograma");
  });
  test("ARS-CER → no", () => {
    assert(C.soportaTirMercado(infoFija.TX26).ok === false, "Boncer no soporta TIR mercado");
  });
  test("Lecap mensual → no", () => {
    assert(C.soportaTirMercado(infoFija.S31G6).ok === false, "Lecap no soporta TIR mercado");
    assert(C.cuponMecanica(infoFija.S31G6) === "capitalizable", "S31G6 capitalizable");
  });
  test("AO27 mensual corriente → soporta TIR mercado bullet", () => {
    assert(C.cuponMecanica(infoFija.AO27) === "corriente", "AO27 corriente");
    assert(!C.esLecapCapitalizable(infoFija.AO27), "AO27 no es Lecap");
    assert(C.soportaTirMercado(infoFija.AO27).ok === true, "AO27 soporta TIR");
    assert(C.soportaDuracion(infoFija.AO27), "AO27 soporta duración");
  });

  console.log("\n=== calcularTirMercado ===");
  test("Bullet a la par ≈ cupón (TTC9O precio 100)", () => {
    const r = C.calcularTirMercado(100000, infoFija.TTC9O);
    assert(r.valor != null, "TIR debería calcularse");
    assertNear(r.valor, infoFija.TTC9O.cupon_tasa_anual, 0.15, "TIR a la par");
  });
  test("GD38 TIR mercado desde cronograma (precio panel)", () => {
    const r = C.calcularTirMercado(132450, infoFija.GD38);
    assert(r.valor != null, "GD38 TIR mercado calculada");
    assert(r.metodo === "cronograma", "metodo cronograma");
    assert(/cronograma completo/i.test(r.nota), "nota cronograma");
  });
  test("GD38 TIR mercado = YTM duración (misma base de flujos)", () => {
    const item = { precio: 132450 };
    const tir = C.calcularTirMercado(item.precio, infoFija.GD38);
    const dur = C.calcularDuracionConvexidad(infoFija.GD38, item);
    assert(dur.ok && tir.valor != null, "ambos cálculos ok");
    assertNear(tir.valor, dur.ytm, 0.01, "TIR mercado vs YTM duración");
  });
  test("Amort parcial sin cronograma → valor null + nota", () => {
    const r = C.calcularTirMercado(100000, infoFija.YMCIO);
    assert(r.valor == null, "YMCIO TIR mercado null");
    assert(r.nota, "debe tener nota explicativa");
  });
  test("Vencido → null", () => {
    const r = C.calcularTirMercado(100000, infoFija.TX26);
    assert(r.valor == null, "vencido sin TIR");
  });
  test("AO27 TIR mercado mensual corriente (precio panel)", () => {
    const r = C.calcularTirMercado(102575.7072, infoFija.AO27);
    assert(r.valor != null, "AO27 TIR calculada");
    assert(r.valor > 0 && r.valor < 15, "AO27 TIR coherente (~5% esperado, no negativa)");
    assert(r.metodo === "bullet", "vía bullet mensual");
    assert(/bullet/i.test(r.nota), "nota bullet");
  });
  test("AO27 TIR mercado = YTM duración (mensual corriente)", () => {
    const item = { precio: 102575.7072 };
    const tir = C.calcularTirMercado(item.precio, infoFija.AO27);
    const dur = C.calcularDuracionConvexidad(infoFija.AO27, item);
    assert(dur.ok && tir.valor != null, "ambos ok");
    assertNear(tir.valor, dur.ytm, 0.01, "TIR vs YTM AO27");
  });
  test("AO28 TIR mercado mensual corriente", () => {
    const r = C.calcularTirMercado(97830.2829, infoFija.AO28);
    assert(r.valor != null && r.metodo === "bullet", "AO28 TIR");
    assert(r.valor > 0 && r.valor < 20, "AO28 TIR coherente (no negativa por escala)");
  });

  console.log("\n=== flujos bullet calendario (AO27/AO28) ===");
  test("AO27 primer flujo coincide con proximoCuponInfo", () => {
    const flujos = C.generarFlujosCaja(infoFija.AO27);
    assert(flujos.ok && flujos.flujos[0]?.fecha, "AO27 flujos con fecha calendario");
    const pc = C.proximoCuponInfo(infoFija.AO27);
    assert(pc.fecha, "próximo cupón AO27");
    assert(
      flujos.flujos[0].fecha.getTime() === pc.fecha.getTime(),
      `flujo ${flujos.flujos[0].fecha.toISOString()} vs cupón ${pc.fecha.toISOString()}`
    );
  });
  test("AO28 primer flujo coincide con proximoCuponInfo", () => {
    const flujos = C.generarFlujosCaja(infoFija.AO28);
    assert(flujos.ok && flujos.flujos[0]?.fecha, "AO28 flujos con fecha calendario");
    const pc = C.proximoCuponInfo(infoFija.AO28);
    assert(pc.fecha, "próximo cupón AO28");
    assert(
      flujos.flujos[0].fecha.getTime() === pc.fecha.getTime(),
      `flujo vs cupón AO28`
    );
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
  test("29 vigentes con flujos modelables (+ AO27/AO28/AN29)", () => {
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
    assert(soporta === 29, `esperado 29 soporta, obtuvo ${soporta}`);
    assert(flujosOk === 29, `esperado 29 flujos, obtuvo ${flujosOk}`);
  });

  console.log("\n=== serieDuracionModificadaHistorica ===");
  test("GD38 duración en ventana histórica simulada", () => {
    win.CotizHistorico = {
      serie: (ticker) =>
        ticker === "GD38"
          ? [
              { date: "2026-01-15", close: 72000 },
              { date: "2026-02-15", close: 73500 },
              { date: "2026-03-15", close: 74800 },
            ]
          : [],
    };
    const r = C.serieDuracionModificadaHistorica(infoFija.GD38, "GD38");
    assert(r.ok, r.motivo || "serie ok");
    assert(r.puntos.length === 3, `3 puntos, obtuvo ${r.puntos.length}`);
    assert(r.puntos.every((p) => p.duracion > 0), "duración positiva");
  });
  test("S31G6 Lecap → motivo Tier C", () => {
    const r = C.serieDuracionModificadaHistorica(infoFija.S31G6, "S31G6");
    assert(!r.ok, "Lecap sin serie duración");
    assert(/Lecap|capitalización/i.test(r.motivo), "motivo Lecap");
  });

  console.log("\n=== proximoCuponInfo ===");
  test("Lecap S30O6 → no_aplica capitalizable", () => {
    const pc = C.proximoCuponInfo(infoFija.S30O6);
    assert(pc.metodo === "no_aplica", "metodo no_aplica");
    assert(pc.categoria === "lecap_capitalizable", "categoria lecap");
    assert(/capitaliza interés/i.test(pc.motivo), "motivo capitalización");
    assert(pc.fecha == null, "sin fecha");
  });
  test("S31G6 Lecap → no_aplica (sin bug null)", () => {
    const pc = C.proximoCuponInfo(infoFija.S31G6);
    assert(pc.metodo === "no_aplica" && pc.categoria === "lecap_capitalizable", "S31G6 lecap");
  });
  test("GD38 → canje_2020 con calendario real", () => {
    const pc = C.proximoCuponInfo(infoFija.GD38);
    assert(pc.metodo === "canje_2020", "canje_2020");
    assert(pc.fecha != null, "tiene fecha");
    assert(/canje 2020/i.test(pc.meta), "meta canje");
    assert(pc.fecha.getMonth() === 6 && pc.fecha.getDate() === 9, "9 jul");
  });
  test("YMCIO → heuristica con advertencia", () => {
    const pc = C.proximoCuponInfo(infoFija.YMCIO);
    assert(pc.metodo === "heuristica", "heuristica");
    assert(/intervalos regulares/i.test(pc.meta), "advertencia fuerte");
  });
  test("TZX26 Boncer 0% → no_aplica", () => {
    const pc = C.proximoCuponInfo(infoFija.TZX26);
    assert(pc.metodo === "no_aplica" && pc.categoria === "cupon_cero_boncer", "boncer cero");
  });
  test("BPO27 → no_aplica BCRA", () => {
    const pc = C.proximoCuponInfo(infoFija.BPO27);
    assert(pc.metodo === "no_aplica" && pc.categoria === "cupon_cero_bcra", "bcra");
  });
  test("BACAD fin de mes → día 30 jun/dic (no 1/7 por desborde addMonths)", () => {
    const pc = C.proximoCuponInfo(infoFija.BACAD);
    assert(pc.metodo === "heuristica", "heuristica");
    assert(pc.fecha != null, "fecha");
    assert(pc.fecha.getDate() === 30, "día 30 fin de mes");
    const mes = pc.fecha.getMonth();
    assert(mes === 5 || mes === 11, `semestral jun/dic, obtuvo mes ${mes + 1}`);
    const hoy = new Date();
    hoy.setHours(12, 0, 0, 0);
    assert(pc.fecha >= hoy, "próximo cupón futuro (o hoy al mediodía)");
  });
  test("10 tickers canje 2020 en universo", () => {
    const tickers = Object.keys(infoFija).filter((k) => !k.startsWith("_"));
    const n = tickers.filter((t) => C.proximoCuponInfo(infoFija[t]).metodo === "canje_2020").length;
    assert(n === 10, `esperado 10 canje, obtuvo ${n}`);
  });
  test("AO27 próximo cupón calendario mensual (no heurística)", () => {
    const pc = C.proximoCuponInfo(infoFija.AO27);
    assert(pc.metodo === "calendario", "calendario");
    assert(pc.categoria === "calendario_mensual", "mensual");
    assert(pc.fecha != null, "fecha");
    assert(pc.fecha.getDate() === 29, "día 29");
    assert(!/intervalos regulares/i.test(pc.meta), "no heurística");
  });
  test("AO28 próximo cupón calendario mensual (día 31 → fin de mes si aplica)", () => {
    const pc = C.proximoCuponInfo(infoFija.AO28);
    assert(pc.metodo === "calendario" && pc.fecha != null, "calendario AO28");
    assert(pc.fecha.getDate() >= 28, "pago cerca de fin de mes");
    assert(/día 31/.test(pc.meta), "meta día nominal 31");
  });
  test("AN29 próximo cupón calendario 30 may / 30 nov", () => {
    const pc = C.proximoCuponInfo(infoFija.AN29);
    assert(pc.metodo === "calendario", "calendario semestral");
    assert(pc.fecha != null, "fecha AN29");
    assert(pc.fecha.getMonth() === 10 && pc.fecha.getDate() === 30, "30 nov");
    assert(/30 may \/ 30 nov/i.test(pc.meta), "meta calendario");
  });

  return passed;
}

function main() {
  const { C, window: win } = loadCore();
  const infoFija = JSON.parse(readFileSync(INFO_PATH, "utf8"));
  console.log("test_calculos.mjs — core.js");
  const passed = runTests(C, infoFija, win);
  const failed = process.exitCode === 1;
  console.log(`\n${failed ? "FALLÓ" : "OK"}: ${passed} tests${failed ? " (con errores)" : ""}`);
  if (failed) process.exit(1);
}

main();
