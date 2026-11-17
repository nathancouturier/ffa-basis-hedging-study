// validate-engine.mjs: src/engine.js against the Python engine, case by case, within 1e-9 (relative).
//
// Reads data/fixtures/engine_cases.json (scripts/gen_fixtures.py) and the
// constants in data/engine.json. Exit code 1 on any mismatch. No network.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = await import(pathToFileURL(path.join(root, "src", "engine.js")).href);
const constants = JSON.parse(readFileSync(path.join(root, "data", "engine.json"), "utf8")).constants;
engine.configure(constants);
const { cases } = JSON.parse(readFileSync(path.join(root, "data", "fixtures", "engine_cases.json"), "utf8"));

const TOLERANCE = 1e-9;
let failures = 0;
let worst = 0;

function compare(expected, actual, where) {
  if (typeof expected === "number") {
    if (typeof actual !== "number" || !Number.isFinite(actual)) return `${where}: expected ${expected}, got ${actual}`;
    const scale = Math.max(1, Math.abs(expected));
    const rel = Math.abs(actual - expected) / scale;
    worst = Math.max(worst, rel);
    return rel <= TOLERANCE ? null : `${where}: expected ${expected}, got ${actual} (relative ${rel})`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return `${where}: array length differs`;
    for (let i = 0; i < expected.length; i += 1) {
      const e = compare(expected[i], actual[i], `${where}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  if (expected !== null && typeof expected === "object") {
    const keys = Object.keys(expected).sort();
    if (actual === null || typeof actual !== "object") return `${where}: expected an object`;
    const got = Object.keys(actual).sort();
    if (JSON.stringify(keys) !== JSON.stringify(got)) return `${where}: keys ${got} instead of ${keys}`;
    for (const k of keys) {
      const e = compare(expected[k], actual[k], `${where}.${k}`);
      if (e) return e;
    }
    return null;
  }
  return expected === actual ? null : `${where}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

cases.forEach((c, i) => {
  const fn = engine[c.fn];
  if (typeof fn !== "function") {
    console.error(`case ${i}: no function ${c.fn} in src/engine.js`);
    failures += 1;
    return;
  }
  const error = compare(c.expected, fn(...c.args), `case ${i} ${c.fn}`);
  if (error) {
    console.error(error);
    failures += 1;
  }
});

if (failures) {
  console.error(`validate-engine: ${failures} of ${cases.length} cases differ`);
  process.exit(1);
}
console.log(`validate-engine: ${cases.length} cases, worst relative difference ${worst.toExponential(2)}`);
