// format.js: numbers, dates and units as the site prints them.
//
// Figures arrive from data/*.json; this module only decides how they look. Negative figures use the
// minus sign U+2212 (not a dash), shares are fractions in the artifacts and percentages on the page.

import { basket_of } from "./engine.js";

const UNITS = Object.freeze({
  percent: 100, // literal: unit, a fraction times 100 is a percentage
  thousand: 1000, // literal: unit, one thousand
  million: 1e6, // literal: unit, one million
  msPerDay: 86400000, // literal: unit, milliseconds in a day
});

const MINUS = "−";
const LOCALE = "en-GB";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatters = new Map();
function nf(dp) {
  if (!formatters.has(dp)) {
    formatters.set(dp, new Intl.NumberFormat(LOCALE, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  }
  return formatters.get(dp);
}

export function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/** 12,345 or 12,345.67, minus sign for negatives. */
export function num(v, dp = 0) {
  if (!isNum(v)) return "n/a";
  const s = nf(dp).format(Math.abs(v));
  const zero = Number(s.replace(/,/g, "")) === 0;
  return v < 0 && !zero ? MINUS + s : s;
}

/** Up to `maxDp` decimals, trailing zeros dropped: 5 -> "5", 2.50 -> "2.5". */
export function numTrim(v, maxDp = 2) {
  if (!isNum(v)) return "n/a";
  for (let dp = 0; dp <= maxDp; dp += 1) {
    if (Math.abs(Number(v.toFixed(dp)) - v) < 1e-9) return num(v, dp);
  }
  return num(v, maxDp);
}

/** Signed: +1,234 or minus 1,234. */
export function signed(v, dp = 0) {
  if (!isNum(v)) return "n/a";
  const s = num(v, dp);
  return v > 0 && Number(nf(dp).format(v).replace(/,/g, "")) !== 0 ? `+${s}` : s;
}

/** A fraction as a percentage: 0.456 -> 45.6%. */
export function pct(v, dp = 1) {
  if (!isNum(v)) return "n/a";
  return `${num(v * UNITS.percent, dp)}%`;
}

/**
 * A share of n observations printed as count / n: the artifacts round shares to four decimals, and
 * rounding that again can move the last digit (47 of 91 is 51.6%, its rounded 0.5165 prints 51.7%).
 */
export function shareOf(share, n, dp = 1) {
  if (!isNum(share)) return "n/a";
  if (!isNum(n) || n <= 0) return pct(share, dp);
  return pct(Math.round(share * n) / n, dp);
}

/** A figure already in percent (the QC flags carry percent moves): -25.7 -> minus 25.7%. */
export function signedPoints(v, dp = 1) {
  if (!isNum(v)) return "n/a";
  return `${signed(v, dp)}%`;
}

export function signedPct(v, dp = 1) {
  if (!isNum(v)) return "n/a";
  return `${signed(v * UNITS.percent, dp)}%`;
}

export function usd(v, dp = 0) {
  return isNum(v) ? `USD ${num(v, dp)}` : "n/a";
}

export function signedUsd(v, dp = 0) {
  if (!isNum(v)) return "n/a";
  if (v < 0) return `${MINUS}USD ${num(-v, dp)}`;
  return `+USD ${num(v, dp)}`;
}

export function usdDay(v, dp = 0) {
  return isNum(v) ? `USD ${num(v, dp)} a day` : "n/a";
}

export function usdT(v, dp = 2) {
  return isNum(v) ? `USD ${num(v, dp)} a tonne` : "n/a";
}

export function ws(v, dp = 2) {
  return isNum(v) ? `WS ${num(v, dp)}` : "n/a";
}

/** Money in millions when large: USD 1.15 million. */
export function usdBig(v) {
  if (!isNum(v)) return "n/a";
  if (Math.abs(v) >= UNITS.million) return `USD ${num(v / UNITS.million, 2)} million`;
  return `USD ${num(v)}`;
}

export function signedUsdBig(v) {
  if (!isNum(v)) return "n/a";
  const body = Math.abs(v) >= UNITS.million ? `USD ${num(Math.abs(v) / UNITS.million, 2)} million` : `USD ${num(Math.abs(v))}`;
  if (v < 0) return `${MINUS}${body}`;
  return v > 0 ? `+${body}` : body;
}

/** Compact signed money for axes: +1.2M, +350k, minus 40. */
export function compactMoney(v) {
  if (!isNum(v)) return "";
  if (Math.abs(v) >= UNITS.million) return `${signed(v / UNITS.million, 1)}M`;
  if (Math.abs(v) >= UNITS.thousand) return `${signed(v / UNITS.thousand, 0)}k`;
  return signed(v, 0);
}

/** Compact tick label: 40,000 / 1.2M. */
export function tick(v, maxAbs) {
  if (!isNum(v)) return "";
  if (maxAbs >= UNITS.million) return `${num(v / UNITS.million, Math.abs(v) % UNITS.million === 0 ? 0 : 1)}M`;
  return num(v, Number.isInteger(v) ? 0 : decimals(v));
}

function decimals(v) {
  const s = String(v);
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(2, s.length - i - 1);
}

export function basketLabel(t) {
  return isNum(t) ? `${num(t)} t basket` : "basket not stated";
}

/** Basket of a 5TC figure dated `day`, by the engine's rule (engine.json BASKET_182_FROM). */
export function basketOn(day) {
  return basket_of(day);
}

export function tonnes(v) {
  return isNum(v) ? `${num(v)} t` : "n/a";
}

// ------------------------------------------------------------------ dates

export function parseISO(iso) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d || 1);
}

export function isoOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return isoOf(parseISO(iso) + n * UNITS.msPerDay);
}

export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / UNITS.msPerDay);
}

/** 8 November 2026 */
export function dateLong(iso) {
  if (!iso) return "n/a";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** 8 Nov 2026 */
export function dateShort(iso) {
  if (!iso) return "n/a";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
}

/** 2026-12 -> December 2026; 2027-Q1 -> first quarter 2027 (Q1 27 short). */
export function monthLong(key) {
  if (!key) return "n/a";
  if (key.includes("-Q")) return `Q${key.slice(-1)} ${key.slice(0, 4)}`;
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function monthShort(key) {
  if (!key) return "n/a";
  if (key.includes("-Q")) return `Q${key.slice(-1)} ${key.slice(2, 4)}`;
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

/** Broker style: Dec-26, Q1 27. */
export function tenorLabel(key) {
  if (key.includes("-Q")) return `Q${key.slice(-1)} ${key.slice(2, 4)}`;
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]}-${String(y).slice(2)}`;
}

export function monthName(m) {
  return MONTHS[m - 1];
}

export function monthAbbr(m) {
  return MONTHS_SHORT[m - 1];
}

export function plural(n, one, many) {
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** "a, b and c" */
export function listJoin(items) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

export function horizonLabel(h) {
  if (typeof h === "string") return h;
  return h === 1 ? "one month" : `${numberWord(h)} months`;
}

export function numberWord(n) {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  return Number.isInteger(n) && n >= 0 && n < words.length ? words[n] : num(n);
}

export function capitalise(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
