// check-paths.mjs: every path the page loads is relative, so the subpath deploy works,
// and the page requests nothing from another host at run time.
//
// The site is served from /ffa-basis-hedging-study/, never from a domain root: a
// leading slash in an href, src, import or url() breaks the deploy.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["index.html"];
for (const dir of ["src", "styles"]) {
  if (existsSync(path.join(root, dir))) {
    for (const f of readdirSync(path.join(root, dir))) if (/\.(js|css)$/.test(f)) files.push(`${dir}/${f}`);
  }
}
const problems = [];
const LEADING = [/(?:href|src)\s*=\s*["']\/(?!\/)/g, /url\(\s*["']?\/(?!\/)/g, /import\s*(?:[^"']*from\s*)?["']\/(?!\/)/g,
  /fetch\(\s*["']\/(?!\/)/g];
const REMOTE_LOAD = [/<script[^>]+src\s*=\s*["']https?:/gi, /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]+href\s*=\s*["']https?:/gi,
  /url\(\s*["']?https?:/gi, /import\s*(?:[^"']*from\s*)?["']https?:/g, /fetch\(\s*["']https?:/g];
for (const f of files) {
  const full = path.join(root, f);
  if (!existsSync(full)) continue;
  const text = readFileSync(full, "utf8");
  for (const re of LEADING) for (const m of text.matchAll(re)) problems.push(`${f}: root-relative path: ${m[0]}`);
  for (const re of REMOTE_LOAD) for (const m of text.matchAll(re)) problems.push(`${f}: loads from another host: ${m[0]}`);
}
if (problems.length) {
  problems.forEach((p) => console.error(p));
  process.exit(1);
}
console.log(`check-paths: ${files.length} files, every path relative, nothing loaded from another host`);
