// check-policy.mjs: the data policy of data/AUDIT.md, enforced on what the site and the downloads carry.
//
// 1. No daily index series: no artifact holds a list of more than MAX_CITED dated spot levels, and no key
//    named daily, value_180 or c5tc_usd_day appears outside the cited curves.
// 2. No weekly FFA panel: FFA tenor levels appear only on the cited dated curves (at most MAX_CITED dates)
//    and in the lab's default curve, which must be one of them; SEC marks are public records and allowed.
// 3. Monthly aggregates only: settlement rows are keyed by month (YYYY-MM).
// 4. No flat rate table: no implied flat rate figure in any artifact or download.
// 5. Quality tables without levels: flags carry gaps in percent, the SEC comparison a band beside the public mark.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_CITED = 6;
const problems = [];
const read = (f) => JSON.parse(readFileSync(path.join(root, "data", f), "utf8"));

function walk(value, at, visit) {
  visit(value, at);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${at}[${i}]`, visit));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${at}.${k}`, visit);
}

const artifacts = readdirSync(path.join(root, "data")).filter((f) => f.endsWith(".json"));
for (const f of artifacts) {
  const data = read(f);
  walk(data, f, (value, at) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const key of Object.keys(value)) {
        if (/^(daily|value_180|c5tc_usd_day|implied_flat_usd_t|flat_rate_usd_t|median_flat)$/.test(key)) {
          problems.push(`${at}.${key}: forbidden key (daily level or flat rate)`);
        }
      }
    }
    if (Array.isArray(value) && value.length > MAX_CITED && value.every((v) => v && typeof v === "object" && "spot_usd_day" in v)) {
      problems.push(`${at}: ${value.length} dated spot levels (limit ${MAX_CITED})`);
    }
  });
}

if (existsSync(path.join(root, "data", "curve.json"))) {
  const curve = read("curve.json");
  const dates = (curve.cited_curves || []).map((c) => c.date);
  if (dates.length > MAX_CITED) problems.push(`curve.json: ${dates.length} cited curves (limit ${MAX_CITED})`);
  if ((curve.weeks || []).some((w) => Object.keys(w).some((k) => /usd|level|price/.test(k)))) {
    problems.push("curve.json weeks: a weekly row carries a level");
  }
  if (existsSync(path.join(root, "data", "lab.json"))) {
    const lab = read("lab.json");
    if (lab.curve && !dates.includes(lab.curve.date)) problems.push(`lab.json curve ${lab.curve.date} is not a cited curve`);
    for (const h of lab.history || []) {
      if (Object.keys(h).some((k) => /^(f0|tce|spot|settlement)/.test(k))) problems.push("lab.json history carries a level");
    }
  }
}
if (existsSync(path.join(root, "data", "method.json"))) {
  const qc = read("method.json").qc || {};
  for (const f of qc.flags || []) {
    for (const k of ["first", "reprint", "curve_usd_day_180", "usd_day"]) if (k in f) problems.push(`method.json qc flag on ${f.curve}: carries the level ${k}`);
  }
  for (const r of qc.sec_check || []) {
    for (const k of ["curve_usd_day_180", "gap"]) if (k in r) problems.push(`method.json qc sec_check ${r.curve}: ${k} would give the curve's level`);
  }
}
if (existsSync(path.join(root, "data", "roll.json"))) {
  const roll = read("roll.json");
  for (const s of roll.settlements || []) if (!/^\d{4}-\d{2}$/.test(s.month)) problems.push(`roll.json settlement ${s.month} is not a month`);
  for (const e of roll.errors || []) if ("price_usd_day" in e || "settlement_usd_day" in e) problems.push("roll.json errors carry levels");
}
const downloads = path.join(root, "data", "downloads");
if (existsSync(downloads)) {
  for (const f of readdirSync(downloads)) {
    const header = readFileSync(path.join(downloads, f), "utf8").split("\n")[0];
    if (/flat/i.test(header)) problems.push(`downloads/${f}: flat rate column`);
    if (/(^|,)(spot|f0|price_usd_day|tce_gross)/.test(header) && f !== "sec_freight_futures_marks.csv") {
      problems.push(`downloads/${f}: level column in ${header}`);
    }
  }
}
if (problems.length) {
  problems.forEach((p) => console.error(p));
  process.exit(1);
}
console.log(`check-policy: ${artifacts.length} artifacts and the downloads keep to the data policy`);
