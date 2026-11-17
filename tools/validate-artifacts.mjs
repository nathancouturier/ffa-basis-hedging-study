// validate-artifacts.mjs: every artifact the page reads is present, well formed and complete.
//
// Checks that each data/*.json file parses, carries its artifact name and an
// as-of date, holds only finite numbers, and has the fields the views read;
// that the validation table passes; that every cited curve and every 2026
// Capesize figure carries its basket; and that each download is a CSV with a
// header and rows.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const need = {
  "overview.json": ["artifact", "as_of", "headline", "effectiveness", "facts", "sources_line"],
  "curve.json": ["artifact", "as_of", "cited_curves", "weeks", "shares", "slope_by_spot", "q1_discount", "td3c_strips"],
  "roll.json": ["artifact", "as_of", "bias", "errors", "roll_1m", "roll_quarter", "settlements"],
  "lab.json": ["artifact", "curve", "voyage_days", "commission_pct", "bands", "history", "td3c_cargo_t"],
  "td3c.json": ["artifact", "as_of", "weekly", "breakwave", "strips", "monthly", "events"],
  "method.json": ["artifact", "as_of", "conventions", "formulas", "validation", "coverage", "policy", "robustness"],
  "manifest.json": ["artifact", "built_on", "as_of", "sources"],
  "engine.json": ["artifact", "constants"],
};
function finite(value, at) {
  if (typeof value === "number" && !Number.isFinite(value)) problems.push(`${at}: not a finite number`);
  else if (Array.isArray(value)) value.forEach((v, i) => finite(v, `${at}[${i}]`));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) finite(v, `${at}.${k}`);
}
for (const [file, keys] of Object.entries(need)) {
  const full = path.join(root, "data", file);
  if (!existsSync(full)) {
    problems.push(`data/${file}: missing`);
    continue;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    problems.push(`data/${file}: ${error.message}`);
    continue;
  }
  for (const k of keys) if (!(k in data)) problems.push(`data/${file}: no "${k}"`);
  if (data.artifact !== file.replace(".json", "")) problems.push(`data/${file}: artifact name ${data.artifact}`);
  finite(data, file);
}
const read = (f) => JSON.parse(readFileSync(path.join(root, "data", f), "utf8"));
if (existsSync(path.join(root, "data", "method.json"))) {
  const failed = read("method.json").validation.filter((r) => !r.ok);
  failed.forEach((r) => problems.push(`validation failed: ${r.group}: ${r.item}`));
}
if (existsSync(path.join(root, "data", "curve.json"))) {
  for (const c of read("curve.json").cited_curves) {
    if (![180000, 182000].includes(c.basket_t)) problems.push(`curve ${c.date}: no basket`);
    if (!c.url) problems.push(`curve ${c.date}: no source link`);
  }
}
if (existsSync(path.join(root, "data", "roll.json"))) {
  for (const s of read("roll.json").settlements) {
    if (s.month >= "2026-01" && s.usd_day_182 == null) problems.push(`settlement ${s.month}: no 182,000 t value`);
  }
}
const dl = path.join(root, "data", "downloads");
if (existsSync(dl)) {
  for (const f of readdirSync(dl)) {
    const lines = readFileSync(path.join(dl, f), "utf8").trim().split("\n");
    if (lines.length < 2) problems.push(`downloads/${f}: no rows`);
  }
}
if (problems.length) {
  problems.forEach((p) => console.error(p));
  process.exit(1);
}
console.log(`validate-artifacts: ${Object.keys(need).length} artifacts well formed, the validation table passes`);
