/**
 * Tests locales de presets por grupo TIR (solo TIR mercado confiable en rango).
 * Uso: node scripts/test_presets.mjs
 */
import { readFileSync } from "fs";
import { createContext, runInContext } from "vm";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = join(__dirname, "../docs");

function loadPanel() {
  const sandbox = {
    window: {},
    console,
    document: { createElement: () => ({ textContent: "", innerHTML: "" }) },
  };
  createContext(sandbox);
  for (const f of ["core.js", "analytics.js"]) {
    runInContext(readFileSync(join(DOCS, "js", f), "utf8"), sandbox);
  }
  return sandbox.window;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  const { CotizCore: C, CotizAnalytics: A } = loadPanel();
  const cot = JSON.parse(readFileSync(join(DOCS, "data/cotizaciones.json"), "utf8"));
  const info = JSON.parse(readFileSync(join(DOCS, "data/info_fija.json"), "utf8"));
  C.state.cotizaciones = cot;
  C.state.infoFija = info;
  const u = C.enriquecerTodos().filter((r) => C.esVigente(r));

  const mayor = A.presetMayorTir(u);
  const tickersMayor = Object.keys(mayor.pesos).filter((t) => mayor.pesos[t] > 0);
  assert(tickersMayor.length > 0, "Mayor TIR: al menos un ticker");
  assert(!tickersMayor.includes("BPO28"), "Mayor TIR no debe incluir NO_COMPARABLE");
  assert(!tickersMayor.includes("BACAD"), "Mayor TIR no debe incluir sin TIR mercado");
  assert(!tickersMayor.includes("CO27D"), "Mayor TIR no debe incluir TIR fuera de rango");
  for (const items of Object.values(mayor.porGrupo)) {
    assert(items.length <= 2, "Mayor TIR: max 2 por grupo");
    for (const item of items) {
      assert(item.tirFuente === "mercado", `${item.ticker} debe usar TIR mercado`);
      assert(C.esTirElegibleCartera(u.find((r) => r.item.ticker === item.ticker)), item.ticker);
    }
  }

  const bal = A.presetBalanceado(u);
  assert(Object.keys(bal.pesos).length > 0, "Balanceado: al menos un ticker");
  assert(!Object.keys(bal.pesos).includes("BACAD"), "Balanceado no incluye BACAD");
  assert(!Object.keys(bal.pesos).includes("CO27D"), "Balanceado no incluye CO27D");
  for (const items of Object.values(bal.porGrupo)) {
    for (const item of items) {
      const row = u.find((r) => r.item.ticker === item.ticker);
      assert(row && C.esTirElegibleCartera(row), `Balanceado: ${item.ticker} no elegible`);
    }
  }

  const cons = A.presetConservador(u);
  for (const items of Object.values(cons.porGrupo)) {
    for (const item of items) {
      assert(item.tirEff < 8, `Conservador: ${item.ticker} TIR >= 8%`);
      assert(item.tirEff >= 0, `Conservador: ${item.ticker} TIR negativa`);
    }
  }

  console.log("OK test_presets.mjs");
  console.log(
    "Mayor TIR por grupo:",
    Object.fromEntries(
      Object.entries(mayor.porGrupo).map(([g, items]) => [g, items.map((i) => i.ticker)])
    )
  );
  console.log("Balanceado tickers:", Object.keys(bal.pesos).length);
}

main();
