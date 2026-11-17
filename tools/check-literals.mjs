// check-literals.mjs: no market figure typed into the page's code.
//
// Every number the site shows comes from data/*.json. In src/*.js (engine.js
// aside, whose constants come from data/engine.json) and index.html:
//   - a numeric literal of 100 or more is an error unless its line carries a
//     "// literal: <reason>" comment (layout widths, durations, SVG sizes);
//   - the study's contract and market constants are errors wherever they appear:
//     3503, 3.75, 182000, 180000, 270000, 1000 as a lot size, 5.0 as a commission.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
if (existsSync(path.join(root, "src"))) {
  for (const f of readdirSync(path.join(root, "src"))) if (f.endsWith(".js") && f !== "engine.js") files.push(`src/${f}`);
}
if (existsSync(path.join(root, "index.html"))) files.push("index.html");
const FORBIDDEN = /(?<![\w.])(3503|3,503|3\.75|182000|180000|182_000|180_000|270000|270_000)(?![\w])/;
const NUMBER = /(?<![\w.$#\-])(\d+(?:\.\d+)?)(?![\w.])/g;
const problems = [];
for (const f of files) {
  const lines = readFileSync(path.join(root, f), "utf8").split("\n");
  let inBlockComment = false;
  lines.forEach((raw, i) => {
    let line = raw;
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      return;
    }
    if (line.trim().startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      return;
    }
    if (/^\s*(\/\/|\*)/.test(line)) return;
    const allowed = /\/\/\s*literal:/.test(line);
    line = line.replace(/\/\/.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, (s) => (s.includes("${") ? s : '""'));
    if (FORBIDDEN.test(line)) problems.push(`${f}:${i + 1}: contract or market constant typed in: ${raw.trim().slice(0, 100)}`);
    if (allowed) return;
    for (const m of line.matchAll(NUMBER)) {
      if (Number(m[1]) >= 100 && !/^#[0-9a-f]+$/i.test(m[0])) {
        problems.push(`${f}:${i + 1}: literal ${m[1]} needs a "// literal: <reason>" comment or a value from data/: ${raw.trim().slice(0, 100)}`);
      }
    }
  });
}
if (problems.length) {
  problems.forEach((p) => console.error(p));
  process.exit(1);
}
console.log(`check-literals: ${files.length} files, no market figure in the page's code`);
