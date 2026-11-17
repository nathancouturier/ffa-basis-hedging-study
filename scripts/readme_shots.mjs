// readme_shots.mjs: the first screen of each view for the README, written to assets/.
//
//   node scripts/readme_shots.mjs [--base http://127.0.0.1:8150/ffa-basis-hedging-study/]
//
// The full set (every view at 1440, 768, 390 and 320 px in both themes, sections open, every secondary
// chart) is scripts/screenshots.mjs; these are the few the README shows. Motion is off (reduced motion).

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argBase = process.argv.indexOf("--base");
const BASE = argBase > 0 ? process.argv[argBase + 1] : "http://127.0.0.1:8150/ffa-basis-hedging-study/";
const OUT = path.join(ROOT, "assets");

const SHOTS = [
  { view: "overview", width: 1440, height: 1000, theme: "light" },
  { view: "curve", width: 1440, height: 1000, theme: "light" },
  { view: "roll", width: 1440, height: 1000, theme: "dark" },
  { view: "lab", width: 1440, height: 1000, theme: "light" },
  { view: "td3c", width: 1440, height: 1000, theme: "dark" },
  { view: "method", width: 1440, height: 1000, theme: "light" },
  { view: "overview", width: 390, height: 844, theme: "dark" },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const s of SHOTS) {
  const context = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: s.theme,
  });
  await context.addInitScript((theme) => {
    try {
      window.localStorage.setItem("nc-theme", theme);
    } catch (e) {
      /* storage blocked: the default theme stays */
    }
  }, s.theme);
  const page = await context.newPage();
  await page.goto(`${BASE}#/${s.view}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const file = path.join(OUT, `${s.view}-${s.width}-${s.theme}.png`);
  await page.screenshot({ path: file });
  console.log(path.relative(ROOT, file));
  await context.close();
}
await browser.close();
