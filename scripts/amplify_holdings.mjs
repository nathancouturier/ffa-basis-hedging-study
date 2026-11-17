// amplify_holdings.mjs: capture BDRY's and BWET's current freight futures holdings, with their as-of date.
//
// amplifyetfs.com draws its holdings table in the browser from its data feed,
// so the page is rendered in headless Chromium, as any visitor sees it. Each
// run appends one snapshot per fund to data/public/amplify_holdings.json (the
// funds' public disclosure), unless the same as-of date is already there, and
// keeps the rendered page under data/raw/amplify/ (ignored by git). From the
// build environment of this study the page's scripts are refused by the network
// proxy, so the panel starts with the first scheduled refresh in CI.
//
// Usage: node scripts/amplify_holdings.mjs

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "data", "public", "amplify_holdings.json");
const RAW = path.join(root, "data", "raw", "amplify");
const AGENT = "ffa-basis-hedging-study/1.0 (public research project; +https://nathancouturier.github.io/ffa-basis-hedging-study/)";
const FUNDS = ["BDRY", "BWET"];

function number(text) {
  const clean = String(text || "").replace(/[$,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(clean) ? Number(clean) : null;
}

const store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { about: "", snapshots: [] };
store.about = "BDRY and BWET holdings as amplifyetfs.com shows them, one snapshot per fund and as-of date, captured by "
  + "scripts/amplify_holdings.mjs in the scheduled refresh. Freight futures rows carry the fund's quantity and market "
  + "value; price = market value / quantity (/ 1,000 t for TD3C, whose lot is 1,000 t).";
mkdirSync(RAW, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: AGENT });
let added = 0;
for (const fund of FUNDS) {
  const url = `https://amplifyetfs.com/${fund}-holdings/`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForFunction(() => /Baltic|Capesize|TD3C|Freight/i.test(document.body.innerText), null, { timeout: 60000 });
    const snapshot = await page.evaluate(() => {
      const text = document.body.innerText;
      const asOf = (text.match(/As of\s+(\d{2})\/(\d{2})\/(\d{4})/) || []).slice(1);
      const rows = [];
      for (const tr of document.querySelectorAll("table tr")) {
        const cells = [...tr.querySelectorAll("th,td")].map((c) => c.innerText.trim());
        if (cells.length > 1) rows.push(cells);
      }
      return { asOf, rows };
    });
    if (snapshot.asOf.length !== 3) throw new Error("no as-of date on the page");
    const asOf = `${snapshot.asOf[2]}-${snapshot.asOf[0]}-${snapshot.asOf[1]}`;
    writeFileSync(path.join(RAW, `${fund}-${asOf}.html`), await page.content());
    if (store.snapshots.some((s) => s.fund === fund && s.as_of === asOf)) continue;
    const header = snapshot.rows[0].map((h) => h.toLowerCase());
    const col = (re) => header.findIndex((h) => re.test(h));
    const iName = col(/name|description|security/);
    const iQty = col(/shares|quantity|contracts|par/);
    const iValue = col(/market value|notional|value/);
    const rows = snapshot.rows.slice(1).filter((r) => /Capesize|TD3C|Middle East|Baltic|FFA/i.test(r.join(" ")))
      .map((r) => {
        const quantity = iQty >= 0 ? number(r[iQty]) : null;
        const value = iValue >= 0 ? number(r[iValue]) : null;
        const name = iName >= 0 ? r[iName] : r[0];
        const td3c = /TD3C|Middle East/i.test(name);
        const price = quantity && value ? value / quantity / (td3c ? 1000 : 1) : null;
        return { name, cells: r, quantity, market_value: value, price, unit: td3c ? "usd_t" : "usd_day" };
      });
    store.snapshots.push({ fund, as_of: asOf, captured_at: new Date().toISOString(), url, header: snapshot.rows[0], rows });
    added += 1;
  } catch (error) {
    console.error(`${fund}: ${error.message}`);
  }
}
await browser.close();
store.snapshots.sort((a, b) => (a.as_of + a.fund).localeCompare(b.as_of + b.fund));
writeFileSync(OUT, JSON.stringify(store, null, 1) + "\n");
console.log(`amplify holdings: ${added} new snapshot(s), ${store.snapshots.length} in all`);
