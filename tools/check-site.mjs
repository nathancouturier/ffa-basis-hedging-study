// check-site.mjs: a browser smoke test of the site, served under its subpath.
//
//   node tools/check-site.mjs [--base http://127.0.0.1:8150/ffa-basis-hedging-study/] [--port 8150]
//
// Checks: every view renders its takeaway and charts without console errors; no horizontal page scroll
// at 320 px wide, with every section open; hash routing (views, open sections, panels); disclosure
// bodies are hidden and inert when closed; the hash carries the panel and open sections of the view shown;
// the theme toggle persists; a chart answers the keyboard; the colour tokens keep their contrast in both
// themes; and the hedge lab's figures match src/engine.js run here in Node on the same inputs, including
// the per-month paper table when the hedge ratio k changes. Starts scripts/serve.py when nothing answers. Exit code 1 on failure.

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEWS = { overview: "Overview", curve: "Curve", roll: "Bias and roll", lab: "Hedge lab", td3c: "TD3C 2026", method: "Method and data" };
const NARROW = 320;
const WIDE = 1280;
const TOLERANCE = 0.5; // a figure printed to whole dollars matches the engine within half a dollar

const failures = [];
let checks = 0;
function check(ok, message) {
  checks += 1;
  if (!ok) failures.push(message);
}

function args() {
  const out = { port: 8150, base: null };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--base") out.base = a[++i];
    else if (a[i] === "--port") out.port = Number(a[++i]);
  }
  out.base = out.base || `http://127.0.0.1:${out.port}/ffa-basis-hedging-study/`;
  return out;
}

async function reachable(url) {
  try {
    return (await fetch(url)).ok;
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

function watch(page, label) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${label}: console error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`${label}: page error: ${e.message}`));
  page.on("requestfailed", (r) => {
    const reason = r.failure()?.errorText || "";
    // a HEAD request is reported as aborted once its headers arrive; that is not a failure
    if (r.method() === "HEAD" && reason.includes("ERR_ABORTED")) return;
    errors.push(`${label}: request failed: ${r.url()} ${reason}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && res.request().method() !== "HEAD") errors.push(`${label}: ${res.status()} for ${res.url()}`);
  });
  return errors;
}

async function settle(page, view) {
  await page.waitForSelector(`#view-${view} h1`, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

/** Parse "USD 41,406 a day" or "Sell 27.79 days" style text to a number (minus sign aware). */
function figure(text) {
  const m = String(text).replace(/−/g, "-").match(/-?[\d,]+(?:\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, "")) : NaN;
}

async function engineInNode() {
  const engine = await import(pathToFileURL(path.join(ROOT, "src", "engine.js")).href);
  const constants = JSON.parse(readFileSync(path.join(ROOT, "data", "engine.json"), "utf8")).constants;
  engine.configure(constants);
  return { engine, constants };
}

async function checkViews(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: WIDE, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = watch(page, "views");
  for (const [view, name] of Object.entries(VIEWS)) {
    await page.goto(`${opts.base}#/${view}`, { waitUntil: "networkidle" });
    await settle(page, view);
    const info = await page.evaluate((v) => {
      const sec = document.getElementById(`view-${v}`);
      const charts = [...sec.querySelectorAll('svg[role="img"]')];
      return {
        hidden: sec.hidden,
        others: [...document.querySelectorAll("section.view")].filter((s) => s !== sec && !s.hidden).length,
        h1: sec.querySelector("h1")?.textContent.trim() || "",
        title: document.title,
        charts: charts.length,
        titled: charts.every((c) => c.querySelector("title")?.textContent.trim() && c.querySelector("desc")?.textContent.trim()),
        current: document.querySelector(`.nav a[data-view="${v}"]`)?.getAttribute("aria-current"),
      };
    }, view);
    check(!info.hidden && info.others === 0, `${view}: the view is not the only one shown`);
    check(info.h1.length > 20 && !/not in this build/.test(info.h1), `${view}: takeaway missing or empty ("${info.h1}")`);
    check(info.title.startsWith(name), `${view}: document title "${info.title}" does not start with "${name}"`);
    check(info.charts >= 1, `${view}: no chart rendered`);
    check(info.titled, `${view}: a chart lacks its <title> or <desc>`);
    check(info.current === "page", `${view}: navigation does not mark the current view`);
  }
  for (const e of errors) failures.push(e);
  await ctx.close();
}

async function checkNarrow(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: NARROW, height: 800 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = watch(page, "narrow");
  for (const view of Object.keys(VIEWS)) {
    await page.goto(`${opts.base}#/${view}`, { waitUntil: "networkidle" });
    await settle(page, view);
    let sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(sw <= NARROW, `${view}: horizontal scroll at ${NARROW} px (${sw} px wide)`);
    for (const b of await page.$$(`#view-${view} button[aria-expanded="false"]`)) await b.click();
    for (const id of await page.$$eval(`#view-${view} .panels button[aria-pressed]`, (bs) => bs.map((b) => b.dataset.panel))) {
      await page.click(`#view-${view} .panels button[data-panel="${id}"]`);
      await page.waitForTimeout(250);
      sw = await page.evaluate(() => document.documentElement.scrollWidth);
      check(sw <= NARROW, `${view}: horizontal scroll at ${NARROW} px with panel ${id} (${sw} px wide)`);
    }
    await page.waitForTimeout(300);
    sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(sw <= NARROW, `${view}: horizontal scroll at ${NARROW} px with every section open (${sw} px wide)`);
    const small = await page.evaluate((v) => [...document.querySelectorAll(`#view-${v} button, .nav a, #view-${v} .seg label`)]
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44)
      .map((el) => el.textContent.trim().slice(0, 30)), view);
    check(small.length === 0, `${view}: touch targets under 44 px: ${small.join(", ")}`);
  }
  for (const e of errors) failures.push(e);
  await ctx.close();
}

async function checkRouting(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: WIDE, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = watch(page, "routing");
  await page.goto(opts.base, { waitUntil: "networkidle" });
  await settle(page, "overview");
  check(/^#\/overview(\?|$)/.test(await page.evaluate(() => location.hash)), "an empty hash does not open the overview");
  await page.goto(`${opts.base}#/curve?open=method,data&panel=slope`, { waitUntil: "networkidle" });
  await settle(page, "curve");
  const state = await page.evaluate(() => {
    const sec = document.getElementById("view-curve");
    const btn = (id) => sec.querySelector(`.disclosures button[data-section="${id}"]`);
    const body = (id) => document.getElementById(btn(id).getAttribute("aria-controls"));
    return {
      method: [btn("method").getAttribute("aria-expanded"), body("method").hidden, body("method").hasAttribute("inert")],
      assumptions: [btn("assumptions").getAttribute("aria-expanded"), body("assumptions").hidden, body("assumptions").hasAttribute("inert")],
      panel: sec.querySelector('.panels button[aria-pressed="true"]')?.dataset.panel,
    };
  });
  check(state.method[0] === "true" && !state.method[1] && !state.method[2], "curve: open=method does not open the Method section");
  check(state.assumptions[0] === "false" && state.assumptions[1] && state.assumptions[2], "curve: a closed section is not hidden and inert");
  check(state.panel === "slope", "curve: panel=slope does not select the slope panel");
  await page.click('#view-curve .disclosures button[data-section="assumptions"]');
  let hash = await page.evaluate(() => location.hash);
  check(/open=[^&]*assumptions/.test(hash) && /open=[^&]*method/.test(hash), `curve: opening a section does not reach the hash (${hash})`);
  await page.click('#view-curve .disclosures button[data-section="method"]');
  hash = await page.evaluate(() => location.hash);
  check(!/method/.test(hash), `curve: closing a section does not leave the hash (${hash})`);
  await page.click('#view-curve .panels button[data-panel="weekly"]');
  hash = await page.evaluate(() => location.hash);
  check(/panel=weekly/.test(hash), `curve: choosing a panel does not reach the hash (${hash})`);
  await page.click('.nav a[data-view="roll"]');
  await settle(page, "roll");
  const roll = await page.evaluate(() => [location.hash, document.activeElement?.tagName, document.title]);
  check(/^#\/roll(\?|$)/.test(roll[0]), `navigation link does not route to #/roll (${roll[0]})`);
  check(/panel=/.test(roll[0]), `roll: the hash does not carry the panel shown (${roll[0]})`);
  check(roll[1] === "H1", "navigating does not move focus to the view's takeaway");
  await page.goBack();
  await settle(page, "curve");
  check(await page.evaluate(() => !document.getElementById("view-curve").hidden), "back does not return to the curve view");

  // URL state: a view shown again through its link writes its panel and open sections back into the hash
  await page.click('#view-curve .panels button[data-panel="slope"]');
  const closed = await page.$eval('#view-curve .disclosures button[aria-expanded="false"]', (b) => b.dataset.section);
  await page.click(`#view-curve .disclosures button[data-section="${closed}"]`);
  await page.click('.nav a[data-view="method"]');
  await settle(page, "method");
  await page.click('.nav a[data-view="curve"]');
  await settle(page, "curve");
  hash = await page.evaluate(() => location.hash);
  const shown = await page.evaluate(() => document.querySelector('#view-curve .panels button[aria-pressed="true"]')?.dataset.panel);
  check(shown === "slope" && /panel=slope/.test(hash), `curve: back through the nav, the panel shown (${shown}) is not in the hash (${hash})`);
  check(new RegExp(`open=[^&]*${closed}`).test(hash), `curve: back through the nav, the open ${closed} section is not in the hash (${hash})`);
  const reopened = await page.evaluate((id) => document.querySelector(`#view-curve .disclosures button[data-section="${id}"]`)?.getAttribute("aria-expanded"), closed);
  check(reopened === "true", `curve: back through the nav, the ${closed} section the visitor opened is closed`);

  // theme toggle persists
  await page.click("[data-theme-toggle]");
  const theme = await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem("nc-theme")]);
  check(theme[0] === "dark" && theme[1] === "dark", "the theme toggle does not switch to dark and store it");
  await page.reload({ waitUntil: "networkidle" });
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "a stored dark theme does not survive a reload");
  await page.click("[data-theme-toggle]");

  // keyboard on a chart
  await page.goto(`${opts.base}#/overview`, { waitUntil: "networkidle" });
  await settle(page, "overview");
  await page.focus("#view-overview .plot");
  await page.keyboard.press("ArrowRight");
  const tip = await page.evaluate(() => {
    const t = document.querySelector("#view-overview .plot .tip");
    return t && !t.hidden ? t.textContent : "";
  });
  check(tip.length > 10, "overview: the arrow keys do not show a tooltip on the key chart");
  for (const e of errors) failures.push(e);
  await ctx.close();
}

async function checkContrast(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: WIDE, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${opts.base}#/overview`, { waitUntil: "networkidle" });
  await settle(page, "overview");
  for (const theme of ["light", "dark"]) {
    const ratios = await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
      const cs = getComputedStyle(document.documentElement);
      const hex = (name) => cs.getPropertyValue(name).trim();
      const lum = (h) => {
        const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const bg = hex("--bg");
      const marks = ["--c-spot", "--c-ffa", "--c-contango", "--c-backwardation", "--c-owner", "--c-charterer", "--c-timing", "--c-route", "--c-size", "--focus", "--axis"];
      const text = ["--ink", "--ink-2", "--ink-3"];
      return { marks: marks.map((m) => [m, ratio(hex(m), bg)]), text: text.map((m) => [m, ratio(hex(m), bg), ratio(hex(m), hex("--bg-raised"))]) };
    }, theme);
    for (const [name, r] of ratios.marks) check(r >= 3, `${theme}: ${name} is ${r.toFixed(2)}:1 on the page, under 3:1`);
    for (const [name, r, r2] of ratios.text) check(r >= 4.5 && r2 >= 4.5, `${theme}: ${name} is ${r.toFixed(2)}:1 (${r2.toFixed(2)}:1 raised), under 4.5:1`);
  }
  await ctx.close();
}

async function checkLab(browser, opts) {
  const { engine, constants } = await engineInNode();
  const lab = JSON.parse(readFileSync(path.join(ROOT, "data", "lab.json"), "utf8"));
  const ctx = await browser.newContext({ viewport: { width: WIDE, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const errors = watch(page, "lab");
  const tenors = Object.fromEntries(lab.curve.tenors.map((t) => [t.period, t.usd_day]));
  const priceOf = (m) => tenors[m] ?? tenors[engine.quarter_of(m)];

  async function read() {
    return page.evaluate(() => [...document.querySelectorAll("#view-lab .locked .figure")].map((el) => el.textContent));
  }

  // 1. defaults: C5 from a month after the curve's date, owner, k = 1
  await page.goto(`${opts.base}#/lab?voyage=C5&role=owner&start=2026-12-08`, { waitUntil: "networkidle" });
  await settle(page, "lab");
  let days = lab.voyage_days.C5;
  let weights = engine.month_days("2026-12-08", days);
  let f0 = engine.strip_price(weights, Object.fromEntries(weights.map((w) => [w.month, priceOf(w.month)])));
  let o = engine.outcome("owner", f0, f0, f0, days, lab.commission_pct, 1);
  let figs = await read();
  check(Math.abs(figure(figs[0]) - f0) <= TOLERANCE, `lab: F0 ${figs[0]} against the engine's ${f0.toFixed(2)}`);
  check(Math.abs(figure(figs[1]) * 1e6 - o.locked_usd) <= 0.005e6, `lab: locked ${figs[1]} against the engine's ${o.locked_usd.toFixed(0)}`);
  check(Math.abs(figure(figs[2]) - o.size_days) <= 0.005, `lab: FFA days ${figs[2]} against the engine's ${o.size_days.toFixed(3)}`);

  // 2. a C3 charterer: the scenario table's total equals the engine's at the first scenario
  await page.goto(`${opts.base}#/lab?voyage=C3&role=charterer&start=2026-12-08`, { waitUntil: "networkidle" });
  await settle(page, "lab");
  days = lab.voyage_days.C3;
  weights = engine.month_days("2026-12-08", days);
  f0 = engine.strip_price(weights, Object.fromEntries(weights.map((w) => [w.month, priceOf(w.month)])));
  figs = await read();
  check(Math.abs(figure(figs[0]) - f0) <= TOLERANCE, `lab: C3 F0 ${figs[0]} against the engine's ${f0.toFixed(2)}`);
  const down = engine.outcome("charterer", f0 * 0.5, f0, f0 * 0.5, days, lab.commission_pct, 1);
  const row = await page.evaluate(() => {
    const t = document.querySelector("#view-lab .outputs table");
    const heads = t ? [...t.querySelectorAll("thead th")].map((th) => th.textContent) : [];
    const tr = t?.querySelector("tbody tr");
    const cells = tr ? [...tr.cells].map((c) => c.textContent) : [];
    return cells[heads.findIndex((x) => /^Paper/.test(x))] ?? "";
  });
  check(row !== "" && Math.abs(figure(row) - down.paper_usd) <= TOLERANCE, `lab: charterer paper at the first scenario ${row} against the engine's ${down.paper_usd.toFixed(0)}`);

  // 3. typing a settlement adds a row marked as the visitor's own figure
  await page.click('#view-lab button[aria-controls="lab-step-scenario"]');
  await page.fill("#lab-step-scenario input", "30000");
  await page.waitForTimeout(200);
  const yours = await page.evaluate(() => [...document.querySelectorAll("#view-lab .outputs table tbody tr")].some((tr) => /Your figure/.test(tr.textContent)));
  check(yours, "lab: a typed settlement does not appear as 'Your figure' in the scenario table");
  const hash = await page.evaluate(() => location.hash);
  check(/open=[^&]*scenario/.test(hash), `lab: opening a step does not reach the hash (${hash})`);

  // 4. the hedge ratio k resizes the paper column of the per-month table, not the voyage's days
  await page.goto(`${opts.base}#/lab?voyage=C5&role=owner&start=2026-12-08&open=paper`, { waitUntil: "networkidle" });
  await settle(page, "lab");
  const k = 0.8;
  await page.fill('#view-lab input[id^="lab-k"]', String(k));
  await page.waitForTimeout(250);
  days = lab.voyage_days.C5;
  weights = engine.month_days("2026-12-08", days);
  const lots = engine.hedge_lots(weights, lab.commission_pct, k);
  const kt = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#lab-step-paper .price-table tbody tr")];
    return {
      voyage: rows.map((tr) => tr.querySelector('[data-col="size"]')?.textContent || ""),
      paper: rows.map((tr) => tr.querySelector('[data-col="paper"]')?.textContent || ""),
      summary: document.querySelector('#view-lab button[aria-controls="lab-step-paper"]')?.closest(".step")?.querySelector(".step-summary")?.textContent || "",
      locked: [...document.querySelectorAll("#view-lab .locked .figure")].map((el) => el.textContent)[2] || "",
    };
  });
  check(kt.voyage.length === weights.length && weights.every((w, i) => Math.abs(figure(kt.voyage[i]) - w.days) <= 0.0005),
    `lab: at k = ${k} the voyage days column reads ${kt.voyage.join(" | ")}, the engine's ${weights.map((w) => w.days.toFixed(3)).join(" | ")}`);
  check(kt.paper.length === lots.length && lots.every((l, i) => Math.abs(figure(kt.paper[i]) - l.days) <= 0.005),
    `lab: at k = ${k} the FFA days column reads ${kt.paper.join(" | ")}, the engine's ${lots.map((l) => l.days.toFixed(2)).join(" | ")}`);
  const total = lots.reduce((a, l) => a + l.days, 0);
  const summaryDays = figure(kt.summary.replace(/^\D+/, ""));
  check(Math.abs(summaryDays - total) <= 0.005 && Math.abs(kt.paper.reduce((a, x) => a + figure(x), 0) - summaryDays) <= 0.005 * lots.length + 0.005,
    `lab: at k = ${k} the per-month FFA days (${kt.paper.join(" + ")}) do not add up to the summary's ${kt.summary}`);
  check(Math.abs(figure(kt.locked.replace(/^\D+/, "")) - total) <= 0.005, `lab: at k = ${k} the paper figure ${kt.locked} is not the engine's ${total.toFixed(2)} days`);
  await page.fill('#view-lab input[id^="lab-k"]', "1");
  await page.waitForTimeout(150);

  // 5. TD3C on the SEC strip
  await page.goto(`${opts.base}#/lab?voyage=TD3C&role=owner&start=2026-12-08`, { waitUntil: "networkidle" });
  await settle(page, "lab");
  const mark = lab.td3c_strip?.months?.find((m) => m.month === "2026-12");
  if (mark) {
    const t = engine.td3c_outcome("owner", mark.usd_t, mark.usd_t, mark.usd_t, lab.td3c_cargo_t, 1);
    figs = await read();
    check(Math.abs(figure(figs[0]) - mark.usd_t) <= 0.005, `lab: TD3C F0 ${figs[0]} against the mark ${mark.usd_t}`);
    check(Math.abs(figure(figs[2]) - t.lots) <= 0.5, `lab: TD3C lots ${figs[2]} against the engine's ${t.lots}`);
  }

  // 6. a month without a price leaves an empty required field and says so
  await page.goto(`${opts.base}#/lab?voyage=C3&role=owner&start=2027-11-20`, { waitUntil: "networkidle" });
  await settle(page, "lab");
  const missing = await page.evaluate(() => document.querySelector("#view-lab .problem")?.textContent || "");
  check(/No price for/.test(missing), "lab: a month beyond the curve does not ask for a price");
  for (const e of errors) failures.push(e);
  await ctx.close();
  void constants;
}

async function main() {
  const opts = args();
  const server = await ensureServer(opts);
  const browser = await chromium.launch();
  try {
    await checkViews(browser, opts);
    await checkNarrow(browser, opts);
    await checkRouting(browser, opts);
    await checkContrast(browser, opts);
    await checkLab(browser, opts);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  if (failures.length) {
    for (const f of failures) console.error(f);
    console.error(`check-site: ${failures.length} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log(`check-site: ${checks} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
