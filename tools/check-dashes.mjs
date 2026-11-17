// check-dashes.mjs: no em dash (U+2014) and no en dash (U+2013) in any committed text file.
//
// Walks the repository (skipping .git, ignored caches, virtual environments and
// binary files) and prints every occurrence with its file and line. The research
// note's own text is checked by scripts/note.py when it writes the PDF.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set([".git", ".venv", "node_modules", ".work", ".claude", "__pycache__", ".pytest_cache", ".ruff_cache"]);
const SKIP_PATHS = ["data/raw", "data/cache"];
const TEXT = /\.(md|txt|html|css|js|mjs|cjs|json|csv|py|toml|yml|yaml|cfg|ini|svg|xml|sh|lock)$|^(Makefile|LICENSE|NOTICE|SHA256SUMS|\.gitignore)$/;
const BAD = /[\u2013\u2014]/g;

let hits = 0;
let files = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (SKIP.has(name) || SKIP_PATHS.some((p) => rel === p || rel.startsWith(p + "/"))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (TEXT.test(name)) {
      files += 1;
      const lines = readFileSync(full, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (BAD.test(line)) {
          hits += 1;
          console.error(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
        BAD.lastIndex = 0;
      });
    }
  }
}
walk(root);
if (hits) {
  console.error(`check-dashes: ${hits} line(s) with a long dash`);
  process.exit(1);
}
console.log(`check-dashes: ${files} text files, no em dash or en dash`);
