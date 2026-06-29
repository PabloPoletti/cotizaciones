/**
 * Integridad TIR cartera: UI y ponderada usan solo TIR mercado confiable.
 * Uso: node scripts/test_tir_cartera.mjs
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
  runInContext(readFileSync(join(DOCS, "js", "core.js"), "utf8"), sandbox);
  return sandbox.window.CotizCore;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  const C = loadPanel();
  const cot = JSON.parse(readFileSync(join(DOCS, "data/cotizaciones.json"), "utf8"));
  const info = JSON.parse(readFileSync(join(DOCS, "data/info_fija.json"), "utf8"));
  C.state.cotizaciones = cot;
  C.state.infoFija = info;
  const u = C.enriquecerTodos().filter((r) => C.esVigente(r));

  const bacad = u.find((r) => r.item.ticker === "BACAD");
  assert(bacad, "BACAD en universo");
  assert(bacad.tirMerc.valor == null, "BACAD: mercado no calculable");
  assert(bacad.tirCalc.fuente === "referencia", "BACAD: tirCalc sigue pudiendo usar ref (análisis)");
  assert(C.valorTirCartera(bacad.tirMerc) === null, "BACAD: cartera no usa referencia");
  assert(!C.esTirElegibleCartera(bacad), "BACAD: no elegible para preset");

  const html = C.formatearCeldaTirCartera(bacad.info, bacad.item, bacad.tirMerc);
  assert(html.includes("solo informativa"), "BACAD UI: ref marcada informativa");
  assert(html.includes("sin TIR confiable"), "BACAD UI: sin TIR confiable");
  assert(html.includes("tir-cartera-line--na"), "BACAD UI: línea cartera excluida");
  assert(!html.includes('tir-cartera-line" title="TIR usada en ponderada">'), "BACAD UI: no usa 15% en línea cartera");

  const ao28 = u.find((r) => r.item.ticker === "AO28");
  assert(C.valorTirCartera(ao28.tirMerc) === ao28.tirMerc.valor, "AO28: mercado entra en cartera");
  const aoHtml = C.formatearCeldaTirCartera(ao28.info, ao28.item, ao28.tirMerc);
  assert(aoHtml.includes(`${ao28.tirMerc.valor}%`), "AO28 UI muestra mismo valor que cartera");

  const co27 = u.find((r) => r.item.ticker === "CO27D");
  assert(!C.esTirElegibleCartera(co27), "CO27D fuera de rango preset USD (-5..20)");

  console.log("OK test_tir_cartera.mjs");
}

main();
