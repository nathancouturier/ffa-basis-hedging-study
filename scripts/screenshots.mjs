// screenshots.mjs: every view at 1440, 1024, 768, 390 and 320 px wide in both themes, each view with its
// sections open, and each secondary panel, written to the folder given by --out.
//
//   node scripts/screenshots.mjs --out <folder> [--base http://127.0.0.1:8150/ffa-basis-hedging-study/]
//                                [--port 8150] [--views overview,curve] [--widths 1440,390]
//
// Starts scripts/serve.py when nothing answers at --base, and stops it at the end. Motion is turned off
// (reduced motion) so no capture lands mid-animation. Prints any console error it sees.

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEWS = ["overview", "curve", "roll", "lab", "td3c", "method"];
const WIDTHS = [1440, 1024, 768, 390, 320];
const THEMES = ["light", "dark"];
const HEIGHT = 900;

function args() {
  const out = { port: 8150, base: null, out: null, views: VIEWS, widths: WIDTHS, openWidths: [1440, 390], panelWidths: [1440, 390, 320] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    const [k, inline] = a[i].split("=");
    const v = inline ?? a[i + 1];
    const take = () => {
      if (inline === undefined) i += 1;
      return v;
    };
    if (k === "--out") out.out = take();
    else if (k === "--base") out.base = take();
    else if (k === "--port") out.port = Number(take());
    else if (k === "--views") out.views = take().split(",");
    else if (k === "--widths") out.widths = take().split(",").map(Number);
    else if (k === "--open-widths") out.openWidths = take().split(",").map(Number);
    else if (k === "--panel-widths") out.panelWidths = take().split(",").map(Number);
  }
  if (!out.out) {
    console.error("usage: node scripts/screenshots.mjs --out <folder> [--base URL] [--port N]");
    process.exit(2);
  }
  out.base = out.base || `http://127.0.0.1:${out.port}/ffa-basis-hedging-study/`;
  return out;
}

async function reachable(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer(opts) {
  if (await reachable(opts.base)) return null;
  const child = spawn("python3", [path.join(ROOT, "scripts", "serve.py"), "--port", String(opts.port)], { stdio: "ignore" });
  for (let i = 0; i < 50; i += 1) {
    if (await reachable(opts.base)) return child;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`no server at ${opts.base}`);
}

async function settle(page, view) {
  await page.waitForSelector(`#view-${view} h1`, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450);
}

async function main() {
  const opts = args();
  mkdirSync(opts.out, { recursive: true });
  const server = await ensureServer(opts);
  const browser = await chromium.launch();
  const problems = [];
  let count = 0;
  try {
    for (const theme of THEMES) {
      for (const width of opts.widths) {
        const ctx = await browser.newContext({ viewport: { width, height: HEIGHT }, deviceScaleFactor: 1, reducedMotion: "reduce" });
        await ctx.addInitScript((t) => {
          try {
            window.localStorage.setItem("nc-theme", t);
          } catch (e) {
            // storage blocked: the default theme applies
          }
        }, theme);
        const page = await ctx.newPage();
        page.on("console", (m) => {
          if (m.type() === "error") problems.push(`${theme} ${width}: ${m.text()}`);
        });
        page.on("pageerror", (e) => problems.push(`${theme} ${width}: ${e.message}`));
        for (const view of opts.views) {
          await page.goto(`${opts.base}#/${view}`, { waitUntil: "networkidle" });
          await settle(page, view);
          await page.screenshot({ path: path.join(opts.out, `${view}_${width}_${theme}.png`), fullPage: true });
          count += 1;
          if (opts.openWidths.includes(width)) {
            const buttons = await page.$$(`#view-${view} button[aria-expanded="false"]:not(.more-rows)`);
            for (const b of buttons) await b.click();
            await page.waitForTimeout(450);
            await page.screenshot({ path: path.join(opts.out, `${view}_open_${width}_${theme}.png`), fullPage: true });
            count += 1;
          }
          if (opts.panelWidths.includes(width)) {
            await page.goto(`${opts.base}#/${view}`, { waitUntil: "networkidle" });
            await settle(page, view);
            const panels = await page.$$eval(`#view-${view} .panels button[aria-pressed]`, (bs) => bs.map((b) => b.dataset.panel));
            for (const id of panels) {
              await page.click(`#view-${view} .panels button[data-panel="${id}"]`);
              await page.waitForTimeout(450);
              const el = await page.$(`#view-${view} .panels`);
              await el.screenshot({ path: path.join(opts.out, `${view}_panel-${id}_${width}_${theme}.png`) });
              count += 1;
            }
          }
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log(`screenshots: ${count} images in ${opts.out}`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
