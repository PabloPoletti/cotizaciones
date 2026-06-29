#!/usr/bin/env node
/**
 * Suite de tests del panel (local y CI).
 * Uso: node scripts/run_tests.mjs
 */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

const SUITE = [
  { script: "test_calculos.mjs", label: "Cálculos (core.js)" },
  { script: "test_tir_cartera.mjs", label: "TIR cartera (UI vs ponderada)" },
  { script: "test_integridad_universo.mjs", label: "Integridad universo" },
];

let failed = false;

for (const { script, label } of SUITE) {
  console.log(`\n========== ${label} ==========`);
  const r = spawnSync(node, [join(__dirname, script)], { stdio: "inherit", cwd: join(__dirname, "..") });
  if (r.status !== 0) failed = true;
}

console.log(failed ? "\n=== SUITE FALLÓ ===" : "\n=== SUITE OK ===");
process.exit(failed ? 1 : 0);
