// view-lab.js: the hedge lab. Size a 5TC or TD3C hedge on the latest cited curve, then stress it:
// settlement scenarios, the historical basis bands and the closest historical setups.
//
// Every calculation goes through src/engine.js (the browser copy of the Python engine, checked to 1e-9).
// Defaults come from data/lab.json with their source and date; anything the visitor types is marked
// "Your figure".

import { configure, month_days, hedge_lots, strip_price, outcome, td3c_outcome, paper_pnl, quarter_of, months_between } from "./engine.js";
import { h, clear, takeaway, setTakeaway, table, defs, segmented, nextId, scrollCue } from "./dom.js";
import { lineChart, waterfallChart, monthMid } from "./charts.js";
import { num, numTrim, pct, signedPct, signed, usdDay, usdT, usdBig, signedUsdBig, compactMoney, dateLong, monthLong, monthShort, monthName, tenorLabel, plural, listJoin, isNum, capitalise, horizonLabel, numberWord, daysBetween, tonnes } from "./format.js";
import { wire, openIds, downloadLine, basketForWindow, retrievedOf, sourceLine } from "./view-kit.js";

const LAB = Object.freeze({
  scenarios: [-0.5, -0.25, 0, 0.25, 0.5],
  gridSteps: 20,
  range: 0.5,
  historyRows: 6,
  maxHorizon: 3,
  stripHeight: 180, // literal: px, height of the small chart of the paper's months
  kStep: 0.05,
  wildFactor: 5, // a typed settlement above five times F0 is most likely in the wrong unit
  thousand: 1000, // literal: unit, sensitivity is quoted per USD 1,000 a day of settlement
});

const VOYAGES = [
  { id: "5TC trip", label: "5TC trip", detail: "a trip earning the day's 5TC" },
  { id: "C3", label: "C3", detail: "Tubarao to Qingdao" },
  { id: "C5", label: "C5", detail: "West Australia to Qingdao" },
  { id: "TD3C", label: "TD3C", detail: "Ras Tanura to Ningbo, VLCC" },
];
const STEP_IDS = ["exposure", "paper", "scenario"];

/** "October to December 2026" for a run of month keys. */
function monthSpan(first, last) {
  if (!first || !last) return "";
  if (first === last) return monthLong(first);
  if (first.slice(0, 4) === last.slice(0, 4)) return `${monthName(Number(first.slice(5, 7)))} to ${monthLong(last)}`;
  return `${monthLong(first)} to ${monthLong(last)}`;
}

/** "USD 12,727 a day below" or "USD 11,610 a day above". */
function aboveBelow(v) {
  if (!isNum(v) || v === 0) return "level with";
  return `${usdDay(Math.abs(v))} ${v < 0 ? "below" : "above"}`;
}

/** The one phrase for the route basis adjustment: "; route basis net of its average (+7,867 USD a day)". */
function routeNet(b) {
  const mean = b && isNum(b.route_mean_removed_usd_day) ? b.route_mean_removed_usd_day : 0;
  return mean ? `route basis net of its average (${signed(mean)} USD a day)` : "";
}

function sameDayNextMonth(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

function render(section, ctx) {
  const { lab, engine, overview, manifest } = ctx.data;
  configure(engine.constants);
  const C = engine.constants;
  const curve = lab.curve;
  const strip = lab.td3c_strip;
  const commission = isNum(lab.commission_pct) ? lab.commission_pct : C.CAPESIZE_COMMISSION_PCT;
  const tenors = Object.fromEntries((curve?.tenors || []).map((t) => [t.period, t.usd_day]));
  const stripPrices = Object.fromEntries((strip?.months || []).map((m) => [m.month, m]));
  const effs = overview?.effectiveness || [];
  if (!curve || !Array.isArray(curve.tenors)) {
    section.append(takeaway("Hedge lab", "The hedge lab needs the latest cited curve, which this build of the study does not carry."));
    return { update() {} };
  }

  const state = {
    role: ctx.params.role === "charterer" ? "charterer" : "owner",
    voyage: VOYAGES.some((v) => v.id === ctx.params.voyage) ? ctx.params.voyage : (overview?.headline?.voyage || "C5"),
    start: /^\d{4}-\d{2}-\d{2}$/.test(ctx.params.start || "") ? ctx.params.start : curve ? sameDayNextMonth(curve.date) : null,
    days: null,
    daysEdited: false,
    tonnes: lab.td3c_cargo_t,
    tonnesEdited: false,
    k: 1,
    kEdited: false,
    horizon: null,
    prices: {},
    userS: null,
    historyMode: "nearest",
    historyIdx: 0,
  };
  const defaultDays = (v) => (lab.voyage_days && isNum(lab.voyage_days[v]) ? lab.voyage_days[v] : null);
  state.days = defaultDays(state.voyage);
  const isTd3c = () => state.voyage === "TD3C";
  /** A new voyage resets what belonged to the old one; a settlement typed in another unit goes too. */
  function setVoyage(v) {
    const unitBefore = isTd3c();
    state.voyage = v;
    if (!state.daysEdited) state.days = defaultDays(v);
    state.prices = {};
    state.horizon = null;
    state.historyIdx = 0;
    if (unitBefore !== isTd3c()) state.userS = null;
  }

  // ------------------------------------------------------------- model
  const priceDate = () => (isTd3c() ? strip?.as_of : curve?.date);
  /** Whole months from the price date to the start, rounded down, as the study counts its horizons. */
  function wholeMonths() {
    const from = priceDate();
    if (!from || !state.start) return null;
    const m = months_between(from.slice(0, 7), state.start.slice(0, 7));
    return Number(state.start.slice(8, 10)) < Number(from.slice(8, 10)) ? m - 1 : m;
  }
  function autoHorizon() {
    const m = wholeMonths();
    return m === null ? 1 : Math.max(1, Math.min(LAB.maxHorizon, m));
  }
  const horizon = () => state.horizon || autoHorizon();
  const startEarly = () => Boolean(state.start && priceDate() && state.start < priceDate());
  /** Prices the visitor typed for months of this voyage. */
  const mine = (m) => m.priced.filter((p) => p.source === "user").length;
  const withYours = (m) => (mine(m) ? ` (with ${plural(mine(m), "price", "prices")} of yours)` : "");
  let autoOpt = null;

  function months() {
    if (!state.start) return [];
    if (isTd3c()) return [{ month: state.start.slice(0, 7), days: 1 }];
    if (!(state.days > 0)) return [];
    return month_days(state.start, state.days);
  }

  function priceOf(month) {
    const edited = state.prices[month];
    if (edited && isNum(edited.value)) return { value: edited.value, source: "user" };
    return defaultPrice(month);
  }

  function defaultPrice(month) {
    if (isTd3c()) {
      const m = stripPrices[month];
      return m ? { value: m.usd_t, source: "sec", contracts: m.contracts, url: m.url } : { value: null, source: "missing" };
    }
    if (isNum(tenors[month])) return { value: tenors[month], source: "month" };
    const q = quarter_of(month);
    if (isNum(tenors[q])) return { value: tenors[q], source: "quarter", quarter: q };
    return { value: null, source: "missing" };
  }

  function model() {
    const weights = months();
    const priced = weights.map((w) => ({ ...w, ...priceOf(w.month) }));
    const missing = priced.filter((p) => !isNum(p.value));
    const out = { weights, priced, missing, ok: false, lots: [] };
    if (weights.length && state.k >= 0) {
      out.lots = isTd3c()
        ? [{ month: weights[0].month, lots: (state.tonnes * state.k) / C.TONNES_PER_LOT_TD3C }]
        : hedge_lots(weights, commission, state.k);
    }
    if (!weights.length || missing.length || !(state.k >= 0)) return out;
    const prices = Object.fromEntries(priced.map((p) => [p.month, p.value]));
    out.ok = true;
    if (isTd3c()) {
      const f0 = prices[weights[0].month];
      out.f0 = f0;
      out.size = state.tonnes;
      out.base = td3c_outcome(state.role, f0, f0, f0, state.tonnes, state.k);
      out.at = (s, r = 0) => td3c_outcome(state.role, s + r, f0, s, state.tonnes, state.k);
    } else {
      const f0 = strip_price(weights, prices);
      out.f0 = f0;
      out.size = state.days;
      out.base = outcome(state.role, f0, f0, f0, state.days, commission, state.k);
      out.at = (s, r = 0) => outcome(state.role, s + r, f0, s, state.days, commission, state.k);
    }
    return out;
  }

  function bandsFor(voyage, hz) {
    return (lab.bands || []).find((b) => b.voyage === voyage && b.horizon_months === hz) || null;
  }

  // ------------------------------------------------------------- layout
  const h1 = takeaway("Hedge lab", "");
  section.append(h1);
  section.append(h("p", { class: "lede" }, "Size a hedge on the latest cited curve and stress it. Change the exposure, the paper or the scenario with the three buttons; the results update as you type. Defaults carry their source and date; a figure you type is marked as yours."));
  // three areas: the steps, the head (what the hedge locks and the scenario chart) and the rest. Phones
  // show the head first; from 1024 px the steps sit beside the outputs while one is open.
  const labEl = h("div", { class: "lab steps-closed" });
  const stepsEl = h("div", { class: "steps" });
  const headEl = h("div", { class: "outputs lab-head", "aria-live": "off" });
  const restEl = h("div", { class: "outputs lab-rest" });
  labEl.append(stepsEl, headEl, restEl);
  section.append(labEl);

  const open = new Set(openIds(ctx.params).filter((id) => STEP_IDS.includes(id)));
  const steps = {};
  for (const id of STEP_IDS) {
    const label = capitalise(id);
    const bodyId = `lab-step-${id}`;
    const btn = h("button", { type: "button", class: "btn", "aria-expanded": "false", "aria-controls": bodyId }, h("span", {}, `${STEP_IDS.indexOf(id) + 1}. ${label}`), h("span", { class: "chev", "aria-hidden": "true" }));
    const summary = h("p", { class: "step-summary" });
    const body = h("div", { class: "step-body", id: bodyId, hidden: true, inert: true });
    const el = h("div", { class: "step" }, h("div", { class: "step-head" }, btn, summary), body);
    stepsEl.append(el);
    steps[id] = { btn, summary, body };
    btn.addEventListener("click", () => {
      if (open.has(id)) open.delete(id);
      else open.add(id);
      syncSteps();
      writeOpen();
    });
  }
  let disclosureIds = openIds(ctx.params).filter((id) => !STEP_IDS.includes(id));
  function writeOpen() {
    ctx.setParams({ open: [...STEP_IDS.filter((id) => open.has(id)), ...disclosureIds].join(",") });
  }
  function syncSteps() {
    labEl.classList.toggle("steps-closed", open.size === 0);
    for (const id of STEP_IDS) {
      const st = steps[id];
      const isOpen = open.has(id);
      st.btn.setAttribute("aria-expanded", String(isOpen));
      st.body.hidden = !isOpen;
      if (isOpen) st.body.removeAttribute("inert");
      else st.body.setAttribute("inert", "");
    }
  }

  // ------------------------------------------------------- step: exposure
  function fieldId(name) {
    return nextId(`lab-${name}`);
  }

  function renderExposure() {
    const body = steps.exposure.body;
    clear(body);
    const roleSeg = segmented({
      legend: "Role",
      name: "lab-role",
      value: state.role,
      options: [{ value: "owner", label: "Owner, sells FFAs" }, { value: "charterer", label: "Charterer, buys FFAs" }],
      onChange: (v) => {
        state.role = v;
        ctx.setParams({ role: v });
        renderScenario();
        update();
      },
    });
    const voyage = segmented({
      legend: "Voyage",
      name: "lab-voyage",
      value: state.voyage,
      options: VOYAGES.map((v) => ({ value: v.id, label: v.id === "5TC trip" ? v.label : `${v.label}, ${v.detail}` })),
      onChange: (v) => {
        setVoyage(v);
        ctx.setParams({ voyage: v });
        renderExposure();
        renderPaper();
        renderScenario();
        update();
      },
    });
    const startId = fieldId("start");
    const start = h("input", { id: startId, class: "input", type: "date", value: state.start || "", required: true });
    start.addEventListener("change", () => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(start.value)) {
        state.start = start.value;
        state.prices = {};
        state.horizon = null;
        state.historyIdx = 0;
        ctx.setParams({ start: start.value });
        renderPaper();
        update();
      }
    });
    const fields = [
      h("div", {}, roleSeg.el),
      h("div", {}, voyage.el),
      h("div", { class: "field" }, h("label", { for: startId }, isTd3c() ? "Loading date" : "Voyage start (fixture date)"), start,
        h("span", { class: "hint" }, isTd3c()
          ? `BWET's TD3C marks of ${dateLong(strip?.as_of)} price ${monthSpan(strip?.months?.[0]?.month, strip?.months?.[strip.months.length - 1]?.month)} loadings; another month needs a price of yours in step 2.`
          : `The latest cited curve is dated ${dateLong(curve.date)}; the default start is a month later.`)),
    ];
    if (isTd3c()) {
      const tid = fieldId("tonnes");
      const t = h("input", { id: tid, class: `input${state.tonnesEdited ? " is-input" : ""}`, type: "number", min: "1", step: "1", inputmode: "numeric", value: String(state.tonnes), required: true });
      const tag = h("span", { class: "tag is-input", hidden: !state.tonnesEdited }, "Your figure");
      t.addEventListener("input", () => {
        const v = Number(t.value);
        if (t.value !== "" && v > 0) {
          state.tonnes = v;
          state.tonnesEdited = v !== lab.td3c_cargo_t;
          t.classList.toggle("is-input", state.tonnesEdited);
          tag.hidden = !state.tonnesEdited;
          update();
        }
      });
      fields.push(h("div", { class: "field" }, h("label", { for: tid }, "Cargo, tonnes"), h("div", { class: "button-row" }, t, tag),
        h("span", { class: "hint" }, `Default ${tonnes(lab.td3c_cargo_t)}: the TD3C route's cargo in the Baltic's definition. The hedge is the same tonnage of TDL futures.`)));
    } else {
      const did = fieldId("days");
      const d = h("input", { id: did, class: `input${state.daysEdited ? " is-input" : ""}`, type: "number", min: "0.5", step: "0.001", inputmode: "decimal", value: isNum(state.days) ? String(state.days) : "", required: true });
      const tag = h("span", { class: "tag is-input", hidden: !state.daysEdited }, "Your figure");
      d.addEventListener("input", () => {
        const v = Number(d.value);
        if (d.value !== "" && v > 0) {
          state.days = v;
          state.daysEdited = v !== defaultDays(state.voyage);
          d.classList.toggle("is-input", state.daysEdited);
          tag.hidden = !state.daysEdited;
          state.prices = Object.fromEntries(Object.entries(state.prices).filter(([, p]) => p.edited));
          renderPaper();
          update();
        }
      });
      const dflt = defaultDays(state.voyage);
      const src = state.voyage === "5TC trip"
        ? `as long as that week's C5 voyage, the study's rule for the trip`
        : `the ${state.voyage} voyage of the Baltic vessel, priced by the voyage-tce-model engine`;
      fields.push(h("div", { class: "field" }, h("label", { for: did }, "Voyage days, ballast leg first"), h("div", { class: "button-row" }, d, tag),
        h("span", { class: "hint" }, isNum(dflt) ? `Default ${num(dflt, 3)} days, computed for ${dateLong(lab.voyage_days_on)}: ${src}.` : "No default in this build: enter the voyage's days.")));
    }
    autoOpt = null;
    if (!isTd3c()) {
      const hzId = fieldId("horizon");
      const hz = h("select", { id: hzId, class: "input" });
      autoOpt = h("option", { value: "" }, `Automatic: ${horizonLabel(autoHorizon())}`);
      hz.append(autoOpt);
      for (let i = 1; i <= LAB.maxHorizon; i += 1) hz.append(h("option", { value: String(i) }, horizonLabel(i)));
      hz.value = state.horizon ? String(state.horizon) : "";
      hz.addEventListener("change", () => {
        state.horizon = hz.value ? Number(hz.value) : null;
        state.historyIdx = 0;
        update();
      });
      fields.push(h("div", { class: "field" }, h("label", { for: hzId }, "Hedge placed ahead of the start"), hz,
        h("span", { class: "hint" }, "Chooses the historical basis bands and setups below. Automatic: the whole months from the curve's date to the start, rounded down, between one and three.")));
    }
    body.append(h("div", { class: "fields" }, fields));
  }

  // ---------------------------------------------------------- step: paper
  const paperChart = h("div");
  function renderPaper() {
    const body = steps.paper.body;
    clear(body);
    const m = model();
    if (!m.weights.length) {
      body.append(h("p", { class: "problem" }, "Set a start date and the voyage's days in step 1 to list the months to hedge."));
      return;
    }
    const lotsBy = Object.fromEntries((m.lots || []).map((l) => [l.month, l]));
    const rows = m.priced;
    const tbl = h("table", { class: "price-table" });
    const unit = isTd3c() ? "USD a tonne" : "USD a day";
    tbl.append(h("caption", {}, isTd3c() ? "TD3C price for the loading month" : `FFA price for each month of the voyage (${num(curve.basket_t)} t basket)`));
    tbl.append(h("thead", {}, h("tr", {},
      h("th", { scope: "col" }, "Month"),
      h("th", { scope: "col", class: "num" }, isTd3c() ? "Cargo, t" : "Voyage days"),
      h("th", { scope: "col", class: "num" }, isTd3c() ? `Lots of ${num(C.TONNES_PER_LOT_TD3C)} t` : "FFA days"),
      h("th", { scope: "col" }, `Price, ${unit}, and its source`))));
    const tb = h("tbody");
    for (const r of rows) {
      const id = fieldId("price");
      const edited = state.prices[r.month]?.edited;
      const input = h("input", { id, class: `input${edited ? " is-input" : ""}${!isNum(r.value) ? " is-missing" : ""}`, type: "number", min: "0", step: isTd3c() ? "0.001" : "1", inputmode: "decimal", required: true, value: isNum(r.value) ? String(r.value) : "", "aria-label": `Price for ${monthLong(r.month)}, ${unit}` });
      const tagCell = h("span", { class: "price-source" });
      const setTag = (src, extra) => {
        clear(tagCell);
        if (src === "user") tagCell.append(h("span", { class: "tag is-input" }, "Your figure"));
        else if (src === "quarter") tagCell.append(h("span", { class: "tag is-proxy" }, `Quarter proxy (${tenorLabel(extra.quarter)})`));
        else if (src === "month") tagCell.append(h("span", { class: "tag" }, `Printed, ${dateLong(curve.date)}`));
        else if (src === "sec") tagCell.append(h("span", { class: "tag" }, `SEC mark, ${dateLong(strip.as_of)}`));
        else tagCell.append(h("span", { class: "tag is-missing" }, "No price: enter one"));
      };
      setTag(r.source, r);
      input.addEventListener("input", () => {
        const v = Number(input.value);
        if (input.value === "" || !(v >= 0)) {
          delete state.prices[r.month];
          const base = priceOf(r.month);
          input.classList.remove("is-input");
          input.classList.toggle("is-missing", !isNum(base.value));
          setTag(base.source, base);
        } else {
          const base = defaultPrice(r.month);
          const isUser = !(isNum(base.value) && v === base.value);
          if (isUser) state.prices[r.month] = { value: v, edited: true };
          else delete state.prices[r.month];
          input.classList.toggle("is-input", isUser);
          input.classList.remove("is-missing");
          setTag(isUser ? "user" : base.source, base);
        }
        update();
      });
      const lot = lotsBy[r.month];
      tb.append(h("tr", {},
        h("th", { scope: "row" }, monthShort(r.month)),
        h("td", { class: "num", dataset: { col: "size" } }, isTd3c() ? num(state.tonnes) : num(r.days, 3)),
        h("td", { class: "num", dataset: { col: "paper" } }, lot ? num(isTd3c() ? lot.lots : lot.days, 2) : ""),
        h("td", {}, h("div", { class: "price-field" }, input, tagCell))));
    }
    tbl.append(tb);
    const tw = h("div", { class: "table-wrap", role: "region", tabindex: "0", "aria-label": "Prices to hedge" }, tbl);
    scrollCue(tw);
    body.append(tw);
    const src = isTd3c()
      ? h("p", { class: "table-note" }, `Defaults: BWET's TD3C futures marks of ${dateLong(strip?.as_of)} (SEC filing, `, strip?.months?.[0]?.url ? h("a", { href: strip.months[0].url }, "10-Q") : "", `). Months the filing does not hold have no default.`)
      : h("p", { class: "table-note" }, `Defaults: ${curve.source}, ${dateLong(curve.date)}, ${num(curve.basket_t)} t basket (`, h("a", { href: curve.url }, "PDF"), "). A month the curve does not print takes its quarter, labelled quarter proxy; a month with neither has no default.");
    body.append(src);
    const kid = fieldId("k");
    const kIn = h("input", { id: kid, class: `input${state.kEdited ? " is-input" : ""}`, type: "number", min: "0", max: "3", step: String(LAB.kStep), inputmode: "decimal", value: String(state.k) });
    const ktag = h("span", { class: "tag is-input", hidden: !state.kEdited }, "Your figure");
    kIn.addEventListener("input", () => {
      const v = Number(kIn.value);
      if (kIn.value !== "" && v >= 0) {
        state.k = v;
        state.kEdited = v !== 1;
        kIn.classList.toggle("is-input", state.kEdited);
        ktag.hidden = !state.kEdited;
        renderPaperLots();
        update();
      }
    });
    const eff = effs.find((e) => e.voyage === state.voyage && e.horizon_months === horizon());
    body.append(h("div", { class: "field" }, h("label", { for: kid }, "Hedge ratio k"), h("div", { class: "button-row" }, kIn, ktag),
      h("span", { class: "hint" }, isTd3c()
        ? "Default 1: one tonne of paper per tonne of cargo."
        : `Default 1: one FFA day per voyage day the owner keeps after commission.${eff && isNum(eff.k_in_sample) ? ` In sample, the ratio that minimised the ${state.voyage} variance at ${horizonLabel(horizon())} was ${num(eff.k_in_sample, 2)}.` : ""}`)));
    body.append(paperChart);
    drawPaperChart(m);
    function renderPaperLots() {
      const mm = model();
      const by = Object.fromEntries((mm.lots || []).map((l) => [l.month, l]));
      [...tb.rows].forEach((tr, i) => {
        const l = by[rows[i].month];
        const cell = tr.querySelector('[data-col="paper"]');
        if (cell) cell.textContent = l ? num(isTd3c() ? l.lots : l.days, 2) : "";
      });
    }
  }

  function drawPaperChart(m) {
    clear(paperChart);
    if (isTd3c() || !m.priced.length) return;
    const pts = m.priced.filter((p) => isNum(p.value));
    if (!pts.length) return;
    const series = [
      { cls: "ffa", line: false, dots: true, points: pts.filter((p) => p.source === "month").map((p) => ({ x: monthMid(p.month), y: p.value, tip: { title: monthLong(p.month), rows: [{ key: "ffa", value: usdDay(p.value), label: `printed on ${dateLong(curve.date)}` }] } })) },
      { cls: "ffa", line: false, dots: true, hollow: true, points: pts.filter((p) => p.source === "quarter").map((p) => ({ x: monthMid(p.month), y: p.value, tip: { title: monthLong(p.month), rows: [{ key: "ffa", value: usdDay(p.value), label: `quarter proxy, ${tenorLabel(p.quarter)}` }] } })) },
      { cls: "ink", line: false, dots: true, shape: "square", points: pts.filter((p) => p.source === "user").map((p) => ({ x: monthMid(p.month), y: p.value, tip: { title: monthLong(p.month), rows: [{ key: "ink", value: usdDay(p.value), label: "your figure" }] } })) },
    ];
    const xs = pts.map((p) => monthMid(p.month));
    const pad = (Math.max(...xs) - Math.min(...xs)) / Math.max(2, pts.length) || 1;
    lineChart(paperChart, {
      title: m.ok ? `F0, the strip price, is ${usdDay(m.f0)} gross${withYours(m)}` : "The months to hedge",
      subtitle: `Price of each month of the voyage, USD a day (${num(curve.basket_t)} t basket); F0 weights them by the voyage's days in each.`,
      legend: [
        { label: "Printed month", cls: "ffa", kind: "dot" },
        { label: "Quarter proxy", cls: "ffa", kind: "hollow" },
        { label: "Your figure (input)", cls: "ink", kind: "square" },
      ],
      height: LAB.stripHeight,
      x: { type: "time", min: Math.min(...xs) - pad, max: Math.max(...xs) + pad },
      y: { title: "USD a day" },
      series,
      refs: m.ok ? [{ y: m.f0, label: `F0 ${num(m.f0)}` }] : [],
      summary: `${m.priced.map((p) => `${monthShort(p.month)} ${isNum(p.value) ? num(p.value) : "no price"} (${p.source === "user" ? "your figure" : p.source === "quarter" ? "quarter proxy" : p.source === "month" ? "printed" : "missing"})`).join(", ")}${m.ok ? `; F0 ${num(m.f0)} USD a day` : ""}.`,
      source: `Source: ${curve.source}, ${dateLong(curve.date)}, ${retrievedOf(manifest, "Banchero")}${withYours(m)}.`,
    });
  }

  // ------------------------------------------------------- step: scenario
  function renderScenario() {
    const body = steps.scenario.body;
    clear(body);
    const sid = fieldId("settle");
    const unit = isTd3c() ? "USD a tonne" : "USD a day";
    const input = h("input", { id: sid, class: `input${isNum(state.userS) ? " is-input" : ""}`, type: "number", min: "0", step: isTd3c() ? "0.01" : "1", inputmode: "decimal", value: isNum(state.userS) ? String(state.userS) : "" });
    const tag = h("span", { class: "tag is-input", hidden: !isNum(state.userS) }, "Your figure");
    input.addEventListener("input", () => {
      const v = Number(input.value);
      state.userS = input.value !== "" && v >= 0 ? v : null;
      input.classList.toggle("is-input", isNum(state.userS));
      tag.hidden = !isNum(state.userS);
      update();
    });
    body.append(h("p", {}, isTd3c()
      ? `The scenarios move the loading month's settlement by a share of F0, from ${pct(-LAB.range, 0)} to ${signedPct(LAB.range, 0)}. The cargo earns the settlement.`
      : `The scenarios move every month's settlement by the same share of F0, from ${pct(-LAB.range, 0)} to ${signedPct(LAB.range, 0)}. The physical side earns the settlement (no basis); the basis bands below add the historical residual.`));
    body.append(h("div", { class: "field" }, h("label", { for: sid }, `Your settlement, ${unit} (average over the hedged ${isTd3c() ? "month" : "months"})`), h("div", { class: "button-row" }, input, tag),
      h("span", { class: "hint" }, "Optional: a settlement to test, drawn as a dashed line and added to the table.")));
  }

  // ----------------------------------------------------------- outputs
  function updateSummaries(m) {
    const v = VOYAGES.find((x) => x.id === state.voyage);
    steps.exposure.summary.textContent = isTd3c()
      ? `${capitalise(state.role)}, TD3C cargo of ${tonnes(state.tonnes)}${state.tonnesEdited ? " (your figure)" : ""}, loading ${state.start ? monthLong(state.start.slice(0, 7)) : "not set"}.`
      : `${capitalise(state.role)}, ${v.label} (${v.detail}) of ${isNum(state.days) ? num(state.days, 3) : "?"} days${state.daysEdited ? " (your figure)" : ""} from ${state.start ? dateLong(state.start) : "a date not set"}; hedge placed ${horizonLabel(horizon())} ahead.`;
    const userPrices = mine(m);
    const proxies = m.priced.filter((p) => p.source === "quarter").length;
    steps.paper.summary.textContent = m.ok
      ? `${state.role === "owner" ? "Sell" : "Buy"} ${isTd3c() ? `${num(m.base.lots, 0)} lots (${tonnes(m.base.size_t)})` : `${num(m.base.size_days, 2)} FFA days`} at F0 ${isTd3c() ? usdT(m.f0) : `${usdDay(m.f0)} gross (${num(curve.basket_t)} t basket)`}, k = ${numTrim(state.k, 2)}${proxies ? `; ${plural(proxies, "quarter proxy", "quarter proxies")}` : ""}${userPrices ? `; ${plural(userPrices, "price", "prices")} of yours` : ""}.`
      : m.missing.length ? `No price for ${listJoin(m.missing.map((p) => monthLong(p.month)))}: open this step to enter one.` : "Set the exposure first.";
    steps.scenario.summary.textContent = `Settlement from ${pct(-LAB.range, 0)} to ${signedPct(LAB.range, 0)} of F0${isNum(state.userS) ? `, and yours at ${isTd3c() ? usdT(state.userS) : usdDay(state.userS)}` : ""}.`;
  }

  function sentence(m) {
    const v = VOYAGES.find((x) => x.id === state.voyage);
    if (!state.start) return "Set a start date to size a hedge.";
    if (!m.ok) {
      if (m.missing.length) return `Enter a price for ${listJoin(m.missing.map((p) => monthLong(p.month)))} to see what this hedge locks.`;
      return "Set the voyage's days to size a hedge.";
    }
    const who = state.role === "owner" ? "An owner" : "A charterer";
    if (isTd3c()) {
      return `${who} hedging a TD3C cargo loading in ${monthLong(state.start.slice(0, 7))} at the ${dateLong(strip.as_of)} marks${withYours(m)} locks ${usdT(m.f0)}, ${usdBig(Math.abs(m.base.locked_usd))} of gross freight for ${tonnes(state.tonnes)}.`;
    }
    return `${who} hedging a ${v.label} voyage from ${dateLong(state.start)} locks ${usdDay(m.f0)} gross on the ${num(curve.basket_t)} t basket${withYours(m)}.`;
  }

  /** What past hedges left: the 5th to 95th percentile of the residual, nine in ten of them. */
  function pastHedges(b) {
    const v = VOYAGES.find((x) => x.id === state.voyage);
    return `${routeNet(b) ? `With the ${routeNet(b)}, 9` : "9"} in 10 past ${v.label} hedges placed ${horizonLabel(b.horizon_months)} ahead left ${state.role === "owner" ? "the voyage's earnings" : "the hire"} between ${aboveBelow(b.p05)} and ${aboveBelow(b.p95)} what they locked.`;
  }

  const lockedEl = h("div");
  const problemEl = h("div");
  const scenarioEl = h("div");
  const tableEl = h("div");
  const bandsEl = h("div");
  const historyEl = h("div");
  headEl.append(problemEl, lockedEl, scenarioEl);
  restEl.append(tableEl, bandsEl, historyEl);

  function update() {
    const m = model();
    setTakeaway(h1, "Hedge lab", sentence(m));
    updateSummaries(m);
    if (autoOpt) autoOpt.textContent = `Automatic: ${horizonLabel(autoHorizon())}`;
    if (open.has("paper")) drawPaperChart(m);
    for (const el of [problemEl, lockedEl, scenarioEl, tableEl, bandsEl, historyEl]) clear(el);
    if (m.ok && isNum(state.userS) && state.userS > LAB.wildFactor * m.f0) {
      const fmtU = (v) => (isTd3c() ? usdT(v) : usdDay(v));
      problemEl.append(h("p", { class: "problem" }, `Your settlement, ${fmtU(state.userS)}, is more than ${numberWord(LAB.wildFactor)} times F0 (${fmtU(m.f0)}): check that it is in ${isTd3c() ? "USD a tonne" : "USD a day"}. It stays in the table and off the chart.`));
    }
    if (startEarly()) {
      problemEl.append(h("p", { class: "problem" }, `The ${isTd3c() ? "loading date" : "start"}, ${dateLong(state.start)}, is before the ${isTd3c() ? "marks" : "curve"} of ${dateLong(priceDate())}: no hedge could have been placed on these prices by then. The figures below apply them anyway${isTd3c() ? "" : `, and the historical bands are those of hedges placed ${horizonLabel(horizon())} ahead`}.`));
    }
    if (!m.ok) {
      problemEl.append(h("p", { class: "problem" }, m.missing.length
        ? `No price for ${listJoin(m.missing.map((p) => monthLong(p.month)))}. The curve of ${dateLong(isTd3c() ? strip?.as_of : curve?.date)} does not print ${m.missing.length === 1 ? "it or its quarter" : "them or their quarters"}: open step 2, Paper, and enter ${m.missing.length === 1 ? "a price" : "prices"} to continue.`
        : "Complete step 1, Exposure, to size the hedge."));
      return;
    }
    renderLocked(m);
    renderScenarioChart(m);
    renderTable(m);
    renderBands(m);
    renderHistory(m);
  }

  function renderLocked(m) {
    const unitDay = isTd3c() ? usdT(m.f0) : usdDay(m.f0);
    const keep = isTd3c() ? null : 1 - commission / C.PERCENT;
    const items = [
      { label: isTd3c() ? `F0, the loading month's price${withYours(m)}` : `F0, the day-weighted strip (gross, ${num(curve.basket_t)} t basket)${withYours(m)}`, value: unitDay },
      { label: isTd3c() ? `Locked for ${tonnes(state.tonnes)}, gross freight` : `${state.role === "owner" ? "Earnings" : "Hire"} locked over ${num(state.days, 3)} days, net of ${numTrim(commission)} percent commission`, value: usdBig(Math.abs(m.base.locked_usd)) },
      { label: isTd3c() ? `Paper (lots of ${num(C.TONNES_PER_LOT_TD3C)} t)` : "Paper (EEX lots of one day)", value: isTd3c() ? `${state.role === "owner" ? "Sell" : "Buy"} ${num(m.base.lots, 0)} lots` : `${state.role === "owner" ? "Sell" : "Buy"} ${num(m.base.size_days, 2)} days` },
    ];
    const box = h("div", { class: "locked" });
    for (const it of items) box.append(h("div", {}, h("p", { class: "figure-label" }, it.label), h("p", { class: "figure" }, it.value)));
    lockedEl.append(box);
    if (!isTd3c()) {
      const perMonth = m.lots.map((l) => `${num(l.days, 2)} in ${monthShort(l.month)}`);
      lockedEl.append(h("p", { class: "table-note" }, `${state.role === "owner" ? "Sell" : "Buy"} ${listJoin(perMonth)}: the voyage's days in each month times ${num(keep, 4)} (the share the owner keeps) times k = ${numTrim(state.k, 2)}. ${state.role === "owner" ? "Locked earnings" : "Locked hire cost"}: F0 times the voyage's days times the same share.`));
    }
  }

  /** The physical leg's name: what the owner earns or the charterer pays. */
  function physicalName() {
    if (isTd3c()) return state.role === "owner" ? "Freight earned" : "Freight paid";
    return state.role === "owner" ? "Voyage earnings" : "Hire paid";
  }

  /** The total at a settlement with the 5th and 95th percentile residuals, phrased for the role. */
  function bandRange(m, b, sv) {
    const lo = m.at(sv, b.p05).total_usd;
    const hi = m.at(sv, b.p95).total_usd;
    if (state.role === "owner") return `the total runs from ${signedUsdBig(lo)} (worst case, the 5th percentile residual) to ${signedUsdBig(hi)} (best case, the 95th)`;
    return `the hire net of the paper runs from ${usdBig(-lo)} (best case, the 5th percentile residual) to ${usdBig(-hi)} (worst case, the 95th)`;
  }

  /** The sample's tail risk for the role: an owner's lowest 5 percent of earnings, a charterer's highest 5 percent of hire. */
  function tailText(e) {
    const owner = state.role === "owner";
    const red = owner ? e.cvar_reduction_k1 : e.cvar_reduction_k1_charterer;
    const un = owner ? e.cvar_unhedged_usd_day : e.cvar_charterer_unhedged_usd_day;
    const he = owner ? e.cvar_hedged_usd_day : e.cvar_charterer_hedged_usd_day;
    if (!isNum(red) || !isNum(un) || !isNum(he)) return null;
    // the artifact gives each tail as a positive shortfall: below F0 for an owner, above it for a charterer
    const side = (v) => `${usdDay(Math.abs(v))} ${(v >= 0) === owner ? "below" : "above"} F0`;
    const net = routeNet({ route_mean_removed_usd_day: e.cvar_route_mean_removed_usd_day });
    return `Tail risk in the sample${net ? `, with the ${net}` : ""}: ${owner ? "an owner's lowest 5 percent of earnings" : "a charterer's highest 5 percent of hire"} averaged ${side(un)} unhedged and ${side(he)} hedged at k = 1, a change in 5% CVaR of ${pct(red)}${red < 0 ? ": the hedged tail was worse" : ""}.`;
  }

  function lockedText(m) {
    return state.role === "owner" ? `${usdBig(m.base.locked_usd)} locked` : `${usdBig(-m.base.locked_usd)} of hire locked`;
  }

  function scenarioGrid(m) {
    const xs = [];
    for (let i = 0; i <= LAB.gridSteps; i += 1) xs.push(m.f0 * (1 - LAB.range + (2 * LAB.range * i) / LAB.gridSteps));
    return xs;
  }

  function renderScenarioChart(m) {
    const xs = scenarioGrid(m);
    const roleCls = state.role === "owner" ? "owner" : "charterer";
    const b = isTd3c() ? null : bandsFor(state.voyage, horizon());
    const fmtS = (v) => (isTd3c() ? usdT(v) : usdDay(v));
    const tipAt = (sv) => {
      const o = m.at(sv);
      return {
        title: `Settlement ${fmtS(sv)} (${signed(((sv - m.f0) / m.f0) * C.PERCENT, 0)}% of F0)`,
        rows: [
          { key: "spot", value: signedUsdBig(o.physical_usd), label: physicalName().toLowerCase() },
          { key: "ffa", value: signedUsdBig(o.paper_usd), label: "paper" },
          { key: roleCls, value: signedUsdBig(o.total_usd), label: "total" },
        ],
        note: b ? `With the historical basis, ${bandRange(m, b, sv)}` : null,
      };
    };
    const series = [
      { cls: "spot", points: xs.map((sv) => ({ x: sv, y: m.at(sv).physical_usd })) },
      { cls: "ffa", points: xs.map((sv) => ({ x: sv, y: m.at(sv).paper_usd })) },
      { cls: roleCls, points: xs.map((sv) => ({ x: sv, y: m.at(sv).total_usd, tip: tipAt(sv) })) },
    ];
    const bands = [];
    if (b) {
      const band = (lo, hi, inner) => ({ cls: roleCls, inner, points: xs.map((sv) => { const a = m.at(sv, lo).total_usd; const c = m.at(sv, hi).total_usd; return { x: sv, y0: Math.min(a, c), y1: Math.max(a, c) }; }) });
      // the outer band's edges, drawn and named: for an owner the 95th percentile residual is the upper edge,
      // for a charterer (whose total is a cost) the 5th
      const outer = band(b.p05, b.p95, false);
      outer.edges = state.role === "owner" ? { upper: "95th percentile", lower: "5th percentile" } : { upper: "5th percentile", lower: "95th percentile" };
      bands.push(outer, band(b.p25, b.p75, true));
    }
    const vlines = [];
    // a settlement far off F0 (most likely in the wrong unit) stays in the table but off the chart's axis
    const userOnChart = isNum(state.userS) && state.userS <= LAB.wildFactor * m.f0;
    if (userOnChart) vlines.push({ x: state.userS, label: "Your settlement", cls: "ink", dash: true });
    const slope = (m.at(m.f0 + LAB.thousand).total_usd - m.base.total_usd);
    const unitStep = isTd3c() ? "USD 1 a tonne" : `USD ${num(LAB.thousand)} a day`;
    const stepSlope = isTd3c() ? (m.at(m.f0 + 1).total_usd - m.base.total_usd) : slope;
    let title;
    if (Math.abs(stepSlope) < 1) title = `At k = ${numTrim(state.k, 2)} the paper offsets the ${isTd3c() ? (state.role === "owner" ? "cargo's freight" : "freight") : state.role === "owner" ? "voyage" : "hire"}: the total stays at the ${usdBig(Math.abs(m.base.locked_usd))} locked whatever the settlement, before basis`;
    else title = `At k = ${numTrim(state.k, 2)} the total moves ${signedUsdBig(stepSlope)} for every ${unitStep} the settlement rises, before basis`;
    const legend = [
      { label: `${physicalName()} at the settlement`, cls: "spot", kind: "line" },
      { label: "Paper profit and loss", cls: "ffa", kind: "line" },
      { label: `Total, ${state.role}`, cls: roleCls, kind: "line" },
    ];
    if (b) legend.push({ label: "Total with the historical basis, 5th to 95th and 25th to 75th percentiles", cls: roleCls, kind: "band" });
    legend.push({ label: state.role === "owner" ? `Locked, ${usdBig(m.base.locked_usd)}` : `Locked hire, ${signedUsdBig(m.base.locked_usd)}`, cls: "muted", kind: "thin" });
    if (userOnChart) legend.push({ label: "Your settlement (input)", cls: "ink", kind: "dash" });
    lineChart(scenarioEl, {
      title,
      subtitle: `USD over the ${isTd3c() ? "cargo, gross freight" : `voyage, net of ${numTrim(commission)} percent commission`}, against the settlement of the hedged ${isTd3c() ? "month" : "months"} (${isTd3c() ? "USD a tonne" : "USD a day, gross"}), from ${pct(-LAB.range, 0)} to ${signedPct(LAB.range, 0)} of F0.${state.role === "charterer" ? " Hire paid and the total are costs, so they are negative." : ""}`,
      legend,
      x: { type: "linear", title: isTd3c() ? "Settlement, USD a tonne" : "Settlement, USD a day" },
      y: { title: "USD", format: (v) => compactMoney(v) },
      series,
      bands,
      refs: [{ y: m.base.locked_usd }],
      vlines,
      mode: "x",
      summary: `F0 ${fmtS(m.f0)}${isTd3c() ? ", gross freight" : " gross"}. ${LAB.scenarios.map((x, i) => { const sv = m.f0 * (1 + x); const o = m.at(sv); return `${i ? "at" : "At"} ${x === 0 ? "F0" : signedPct(x, 0)} (${fmtS(sv)}): paper ${signedUsdBig(o.paper_usd)}, total ${signedUsdBig(o.total_usd)}`; }).join("; ")}.${b ? ` With the historical basis (${state.voyage}, ${horizonLabel(horizon())} ahead), at F0 ${bandRange(m, b, m.f0)}.` : ""}`,
      source: isTd3c()
        ? `Source: BWET's TD3C futures marks of ${dateLong(strip.as_of)}, Amplify Commodity Trust filing (SEC EDGAR), ${retrievedOf(manifest, "SEC")}${withYours(m)}.`
        : `${sourceLine(lab, `${curve.source}, ${dateLong(curve.date)}`)}${withYours(m) ? ` Prices: the curve of ${dateLong(curve.date)}${withYours(m)}.` : ""}`,
    });
  }

  function renderTable(m) {
    const rows = LAB.scenarios.map((x) => ({ label: x === 0 ? "At F0" : `${x > 0 ? "Up" : "Down"} ${pct(Math.abs(x), 0)}`, s: m.f0 * (1 + x), user: false }));
    if (isNum(state.userS)) rows.push({ label: "Your settlement", s: state.userS, user: true });
    const fmtS = (v) => (isTd3c() ? num(v, 2) : num(v));
    tableEl.append(table({
      caption: "Outcomes under settlement scenarios",
      columns: [
        { label: "Scenario", format: (r) => (r.user ? h("span", { class: "tag is-input" }, "Your figure") : r.label) },
        { label: isTd3c() ? "Settlement, USD a tonne" : "Settlement, USD a day (gross)", num: true, format: (r) => fmtS(r.s) },
        { label: "Total, USD", num: true, format: (r) => signed(m.at(r.s).total_usd) },
        { label: "Total against locked, USD", num: true, format: (r) => signed(m.at(r.s).versus_locked_usd) },
        { label: `${physicalName()}, USD`, num: true, format: (r) => signed(m.at(r.s).physical_usd) },
        { label: "Paper, USD", num: true, format: (r) => signed(m.at(r.s).paper_usd) },
        ...(isTd3c() ? [] : [{ label: "Total, USD a day (net of commission)", num: true, format: (r) => signed(m.at(r.s).total_usd_day) }]),
      ],
      rows,
      note: `Paper = ${state.role === "owner" ? "(F0 minus settlement)" : "(settlement minus F0)"} times ${isTd3c() ? `${num(m.base.size_t)} t` : `${num(m.base.size_days, 2)} FFA days`}: at the first scenario ${signedUsdBig(paper_pnl(state.role, m.f0, m.f0 * (1 + LAB.scenarios[0]), isTd3c() ? m.base.size_t : m.base.size_days))}. ${isTd3c() ? "Amounts are gross freight: no commission is taken off." : `USD amounts are net of the ${numTrim(commission)} percent commission; settlements are gross.`}${state.role === "charterer" ? " Hire paid and the totals are costs, so they are negative." : ""}`,
    }));
  }

  function renderBands(m) {
    if (isTd3c()) {
      bandsEl.append(h("h2", { class: "section-title" }, "Basis bands"));
      bandsEl.append(h("p", { class: "lede" }, "The study has no historical basis distribution for TD3C: there is no settled TD3C series in USD a tonne to measure one against (see the flat-rate test in the TD3C view). The scenarios above assume the cargo earns the settlement."));
      return;
    }
    const all = (lab.bands || []).filter((b) => b.voyage === state.voyage).sort((a, b) => a.horizon_months - b.horizon_months);
    const b = bandsFor(state.voyage, horizon());
    bandsEl.append(h("h2", { class: "section-title" }, `Basis bands: what the ${state.voyage} hedge left, historically`));
    if (!b) {
      bandsEl.append(h("p", { class: "lede" }, `The study has no bands for ${state.voyage} hedged ${horizonLabel(horizon())} ahead.`));
      return;
    }
    bandsEl.append(h("p", { class: "lede" }, pastHedges(b)));
    bandsEl.append(h("p", { class: "lede" }, `The residual is what a 1:1 hedge did not remove: the voyage's gross TCE minus the settlement it was hedged on, in USD a day (timing, route and size basis). A positive residual means the voyage paid more than the settlement: more earnings for an owner, more hire for a charterer. Applied to this ${state.role === "owner" ? "voyage" : "charter"}, each percentile moves the total by the residual times the days kept.`));
    const anyMean = all.some((r) => routeNet(r));
    if (routeNet(b)) {
      bandsEl.append(h("p", { class: "small muted" }, `${capitalise(routeNet(b))} for ${state.voyage} hedged ${horizonLabel(b.horizon_months)} ahead: the study's voyage TCEs leave out port charges and the loading time at the port's scale, which have no public figure, so the level of the route basis is overstated while its spread, which these bands show, is not. The closest setups below are on the same footing.`));
    }
    bandsEl.append(table({
      caption: `Residual after the hedge, ${state.voyage}, USD a day (k = 1${anyMean ? "; route basis net of its average, in the last column" : ""})`,
      columns: [
        { label: "Placed ahead", format: (r) => capitalise(horizonLabel(r.horizon_months)) },
        { label: "5th", num: true, format: (r) => signed(r.p05) },
        { label: "25th", num: true, format: (r) => signed(r.p25) },
        { label: "Median", num: true, format: (r) => signed(r.p50) },
        { label: "75th", num: true, format: (r) => signed(r.p75) },
        { label: "95th", num: true, format: (r) => signed(r.p95) },
        { label: "Fixtures", num: true, format: (r) => num(r.n) },
        ...(anyMean ? [{ label: "Route basis average taken out", num: true, format: (r) => signed(r.route_mean_removed_usd_day) }] : []),
      ],
      rows: all,
      rowAttrs: (r) => (r.horizon_months === b.horizon_months ? { class: "is-selected" } : {}),
      note: `Selected: ${horizonLabel(b.horizon_months)}. Applied at F0 to this ${state.role === "owner" ? "voyage" : "charter"}, ${bandRange(m, b, m.f0)}, against ${lockedText(m)}.`,
    }));
    const eff = effs.find((e) => e.voyage === state.voyage && e.horizon_months === b.horizon_months);
    const tail = eff ? tailText(eff) : null;
    if (tail) bandsEl.append(h("p", { class: "table-note" }, tail));
  }

  function renderHistory(m) {
    if (isTd3c()) return;
    const hz = horizon();
    const pool = (lab.history || []).filter((r) => r.voyage === state.voyage && r.horizon_months === hz);
    historyEl.append(h("h2", { class: "section-title" }, "The closest historical setups"));
    if (!pool.length) {
      historyEl.append(h("p", { class: "lede" }, `The study has no ${state.voyage} fixtures hedged ${horizonLabel(hz)} ahead.`));
      return;
    }
    const owner = state.role === "owner";
    const band = bandsFor(state.voyage, hz);
    const mean = band && isNum(band.route_mean_removed_usd_day) ? band.route_mean_removed_usd_day : 0;
    // on the bands' footing: the route basis net of its average, so the voyage, the result and the route move with it
    const fig = (r) => ({
      voyage: r.unhedged_usd_day - mean,
      paper: -r.paper_move_usd_day,
      result: r.residual_usd_day - mean,
      timing: r.timing_usd_day,
      route: r.route_usd_day - mean,
      size: r.size_usd_day,
    });
    const L = owner
      ? { voyage: "Voyage against F0", paper: "Paper", result: "Hedged result" }
      : { voyage: "Hire against F0", paper: "Paper", result: "Net hire against F0" };
    const startMonth = Number(state.start.slice(5, 7));
    const seg = segmented({
      legend: "Match on",
      name: "lab-history",
      value: state.historyMode,
      options: [{ value: "nearest", label: "Nearest fixture dates" }, { value: "month", label: `Same calendar month (${monthLong(state.start.slice(0, 7)).split(" ")[0]})` }],
      onChange: (v) => {
        state.historyMode = v;
        state.historyIdx = 0;
        clear(historyEl);
        renderHistory(m);
      },
    });
    historyEl.append(h("div", { class: "controls" }, seg.el));
    let rows;
    if (state.historyMode === "month") rows = pool.filter((r) => Number(r.fixture.slice(5, 7)) === startMonth);
    else rows = pool.slice();
    rows.sort((a, b) => Math.abs(daysBetween(a.fixture, state.start)) - Math.abs(daysBetween(b.fixture, state.start)));
    rows = rows.slice(0, LAB.historyRows);
    if (!rows.length) {
      historyEl.append(h("p", { class: "lede" }, `No ${state.voyage} fixture in ${monthLong(state.start.slice(0, 7)).split(" ")[0]} was hedged ${horizonLabel(hz)} ahead in the sample.`));
      return;
    }
    if (state.historyIdx >= rows.length) state.historyIdx = 0;
    const chartBox = h("div");
    const tblBox = h("div");
    historyEl.append(h("p", { class: "lede" }, `${state.voyage} fixtures hedged ${horizonLabel(hz)} ahead at k = 1, ${state.historyMode === "month" ? "in the start's calendar month" : "nearest the start date"}, in USD a day against F0. A positive figure means the voyage paid more than F0: more earnings for an owner, more hire for a charterer${mean ? `. Shown with the ${routeNet(band)}, as in the bands` : ""}. Choose a row to see its waterfall.`));
    historyEl.append(tblBox, chartBox);
    function drawTable() {
      clear(tblBox);
      tblBox.append(table({
        caption: `Closest setups, USD a day against F0${mean ? `, ${routeNet(band)}` : ""}`,
        columns: [
          { label: "Fixture", format: (r) => { const i = rows.indexOf(r); const btn = h("button", { type: "button", class: "btn", "aria-pressed": String(i === state.historyIdx) }, dateLong(r.fixture)); btn.addEventListener("click", () => { state.historyIdx = i; drawTable(); drawWaterfall(); }); return btn; } },
          { label: L.result, num: true, format: (r) => signed(fig(r).result) },
          { label: L.voyage, num: true, format: (r) => signed(fig(r).voyage) },
          { label: L.paper, num: true, format: (r) => signed(fig(r).paper) },
          { label: "Timing", num: true, format: (r) => signed(fig(r).timing) },
          { label: "Route", num: true, format: (r) => signed(fig(r).route) },
          { label: "Size", num: true, format: (r) => signed(fig(r).size) },
          { label: "Hedged on", format: (r) => dateLong(r.hedged_on) },
        ],
        rows,
        rowAttrs: (r) => (rows.indexOf(r) === state.historyIdx ? { class: "is-selected" } : {}),
        note: `${owner ? "Voyage against F0: the voyage's gross TCE minus F0. Paper: the short's gain per day hedged. Hedged result: their sum" : "Hire against F0: the hire (the voyage's gross TCE) minus F0, positive when it cost more. Paper: what the long took off the hire per day hedged, negative when it gained. Net hire: their sum"}, split into timing, route and size basis.${mean ? ` ${owner ? "Voyage, result" : "Hire, net hire"} and route are net of the route basis's average (${signed(mean)} USD a day); add it back for the route basis as measured.` : ""} The waterfall below gives each setup's months. Levels are not published, only these differences.`,
      }));
    }
    function drawWaterfall() {
      clear(chartBox);
      const r = rows[state.historyIdx];
      const f = fig(r);
      const basket = isNum(r.curve_basket_t)
        ? `curve on the ${num(r.curve_basket_t)} t basket${isNum(r.ship_basket_t) && r.ship_basket_t !== r.curve_basket_t ? `, the ship on ${num(r.ship_basket_t)} t` : ""}`
        : basketForWindow(engine, r.fixture, r.fixture);
      const steps = [
        { label: L.voyage, value: f.voyage, cls: "spot", kind: "start" },
        { label: L.paper, value: f.paper, cls: "ffa", kind: "delta" },
        { label: `${L.result}${owner ? " against F0" : ""}`, value: f.result, cls: "ink", kind: "total", outline: true },
        { label: "Timing basis", value: f.timing, cls: "timing", kind: "part" },
        { label: mean ? "Route basis, net of its average" : "Route basis", value: f.route, cls: "route", kind: "part" },
        { label: "Size basis", value: f.size, cls: "size", kind: "part" },
      ].map((st) => ({ ...st, valueLabel: signed(st.value), tip: { title: st.label, rows: [{ key: st.cls === "ink" ? "ink" : st.cls, value: `${signed(st.value)} USD a day`, label: "" }], note: `Fixture ${dateLong(r.fixture)}, hedged ${dateLong(r.hedged_on)}` } }));
      waterfallChart(chartBox, {
        level: 3,
        title: owner
          ? `Fixture of ${dateLong(r.fixture)}: the hedge turned ${signed(f.voyage)} into ${signed(f.result)} USD a day against F0`
          : `Fixture of ${dateLong(r.fixture)}: the hedge turned ${signed(f.voyage)} of hire against F0 into ${signed(f.result)} USD a day`,
        subtitle: `${state.voyage}, ${num(r.days, 3)} days over ${r.months.map((mm) => tenorLabel(mm)).join(", ")}, hedged on ${dateLong(r.hedged_on)} at k = 1. USD a day${basket ? `; ${basket}` : ""}${mean ? `; ${routeNet(band)}` : ""}.${owner ? "" : " Positive is extra hire."}`,
        legend: [
          { label: owner ? "Voyage" : "Hire", cls: "spot", kind: "rect" },
          { label: "Paper", cls: "ffa", kind: "rect" },
          { label: owner ? "Hedged result" : "Net hire", cls: "ink", kind: "outline" },
          { label: "Timing basis", cls: "timing", kind: "rect" },
          { label: "Route basis", cls: "route", kind: "rect" },
          { label: "Size basis", cls: "size", kind: "rect" },
        ],
        steps,
        x: { title: "USD a day", format: (v) => signed(v) },
        summary: `${owner ? "The voyage came in" : "The hire came in"} ${signed(f.voyage)} USD a day against F0, the paper added ${signed(f.paper)}, leaving ${signed(f.result)}: timing ${signed(f.timing)}, route ${signed(f.route)}, size ${signed(f.size)}${mean ? `; ${routeNet(band)}` : ""}.`,
        source: sourceLine(lab, "the study's hedge outcomes"),
      });
    }
    drawTable();
    drawWaterfall();
  }

  /** "C3 -1,774, -1,453 and -1,394; C5 +7,867, +8,044 and +7,650 USD a day at one, two and three months". */
  function routeMeans() {
    const by = {};
    for (const b of lab.bands || []) if (isNum(b.route_mean_removed_usd_day) && b.route_mean_removed_usd_day !== 0) (by[b.voyage] ||= []).push(b);
    const parts = Object.entries(by).map(([v, bs]) => `${v} ${listJoin(bs.sort((a, c) => a.horizon_months - c.horizon_months).map((b) => signed(b.route_mean_removed_usd_day)))}`);
    const hz = [...new Set((lab.bands || []).map((b) => b.horizon_months))].sort();
    return parts.length ? `${parts.join("; ")} USD a day at ${listJoin(hz.map((x) => numberWord(x)))} ${hz.length === 1 && hz[0] === 1 ? "month" : "months"} ahead` : "zero for every voyage in this build";
  }

  // ------------------------------------------------------- disclosures
  const w = wire(ctx, "lab", {
    onOpenChange: (ids) => {
      disclosureIds = ids;
      writeOpen();
    },
    sections: [
      {
        id: "method",
        label: "Method",
        render(body) {
          body.append(defs([
            { term: "Engine", desc: "Every figure here comes from src/engine.js, the browser copy of the study's Python engine, checked against it to 1e-9 on generated cases: month_days spreads the voyage over calendar months from its start, strip_price weights the month prices by those days, hedge_lots sizes the paper, outcome and td3c_outcome give the physical, paper and total legs, paper_pnl the paper alone." },
            { term: "Paper size", desc: `FFA days in a month = the voyage's days in it times (1 minus the commission) times k; a TD3C hedge is the cargo's tonnes times k, in lots of ${num(C.TONNES_PER_LOT_TD3C)} t.` },
            { term: "Locked", desc: "F0 times the voyage's days times the share kept (owner); minus that for a charterer, whose hire is a cost." },
            { term: "Scenarios", desc: "Every month settles at the same share of F0; the physical leg earns (or pays) the settlement, so at k = 1 the total equals what was locked." },
            { term: "Basis bands", desc: `The 5th, 25th, 50th, 75th and 95th percentiles of the residual (gross TCE minus settlement at k = 1) of the study's fixtures for the same voyage and horizon, added to the physical leg, with the route basis net of its average (${routeMeans()}), because its level is overstated (port charges and loading time are left out of the voyage TCEs) while its spread is not.` },
            { term: "Closest setups", desc: "The study's fixtures of the same voyage and horizon, ranked by distance from the start date, or restricted to the start's calendar month, on the bands' footing: the voyage, the hedged result and the route basis are net of the route basis's average." },
            { term: "Signs", desc: "Residuals and setups carry one sign for both roles: positive means the voyage paid more than the price hedged, which is more earnings for an owner and more hire for a charterer. Totals in USD are what the role receives, so a charterer's hire and total are negative." },
          ]));
        },
      },
      {
        id: "assumptions",
        label: "Assumptions",
        render(body) {
          body.append(defs([
            { term: "Curve", desc: h("span", {}, `${curve.source}, ${dateLong(curve.date)}, ${num(curve.basket_t)} t basket. `, h("a", { href: curve.url }, "Report (PDF)")) },
            { term: "Voyage days", desc: `${Object.entries(lab.voyage_days || {}).map(([k, v]) => `${k} ${num(v, 3)}`).join(", ")} days, computed for ${dateLong(lab.voyage_days_on)}.` },
            { term: "Commission", desc: `${numTrim(commission)} percent total, from the Baltic's route definitions; taken off Capesize amounts, not off TD3C freight.` },
            { term: "TD3C marks", desc: strip ? `BWET's TD3C futures at ${dateLong(strip.as_of)}: ${strip.months.map((mm) => `${tenorLabel(mm.month)} ${usdT(mm.usd_t, 3)} (${num(mm.contracts)} contracts)`).join(", ")}.` : "No TD3C strip in this build." },
            { term: "TD3C cargo", desc: `${tonnes(lab.td3c_cargo_t)}, the route's cargo.` },
            { term: "Inputs", desc: "Anything you type is your figure and is marked so; the study does not save or send it." },
          ]));
        },
      },
      {
        id: "data",
        label: "Data",
        render(body) {
          body.append(table({
            caption: "Basis bands, every voyage and horizon (USD a day; route basis net of its average, in the last column)",
            columns: [
              { key: "voyage", label: "Voyage" },
              { label: "Placed ahead", format: (r) => capitalise(horizonLabel(r.horizon_months)) },
              { label: "5th", num: true, format: (r) => signed(r.p05) },
              { label: "25th", num: true, format: (r) => signed(r.p25) },
              { label: "Median", num: true, format: (r) => signed(r.p50) },
              { label: "75th", num: true, format: (r) => signed(r.p75) },
              { label: "95th", num: true, format: (r) => signed(r.p95) },
              { label: "Fixtures", num: true, format: (r) => num(r.n) },
              { label: "Route basis average taken out", num: true, format: (r) => signed(r.route_mean_removed_usd_day || 0) },
            ],
            rows: lab.bands || [],
          }));
          body.append(table({
            caption: `Latest cited curve used for the defaults, ${dateLong(curve.date)}, USD a day (${num(curve.basket_t)} t basket)`,
            columns: [
              { label: "Tenor", format: (t) => tenorLabel(t.period) },
              { label: "USD a day", num: true, format: (t) => num(t.usd_day) },
            ],
            rows: curve?.tenors || [],
          }));
          body.append(downloadLine([{ file: "hedge_outcomes.csv", what: "every historical setup" }]));
        },
      },
    ],
  });
  section.append(w.disclosuresEl);

  renderExposure();
  renderPaper();
  renderScenario();
  syncSteps();
  update();

  return {
    state: () => ({ open: [...STEP_IDS.filter((id) => open.has(id)), ...disclosureIds].join(",") }),
    update(params) {
      let changed = false;
      if ((params.role === "owner" || params.role === "charterer") && params.role !== state.role) {
        state.role = params.role;
        changed = true;
      }
      if (params.voyage && params.voyage !== state.voyage && VOYAGES.some((v) => v.id === params.voyage)) {
        setVoyage(params.voyage);
        changed = true;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(params.start || "") && params.start !== state.start) {
        state.start = params.start;
        state.prices = {};
        state.horizon = null;
        state.historyIdx = 0;
        changed = true;
      }
      if (changed) {
        renderExposure();
        renderPaper();
        renderScenario();
        update();
      }
      const ids = openIds(params);
      open.clear();
      for (const id of ids) if (STEP_IDS.includes(id)) open.add(id);
      disclosureIds = ids.filter((id) => !STEP_IDS.includes(id));
      syncSteps();
      w.update(params);
      if (open.has("paper")) drawPaperChart(model());
    },
  };
}

export default {
  id: "lab",
  name: "Hedge lab",
  needs: ["lab", "engine", "overview", "manifest"],
  render,
};
