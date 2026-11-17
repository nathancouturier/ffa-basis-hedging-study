// view-lab.js: the hedge lab. Size a 5TC or TD3C hedge on the latest cited curve, then stress it:
// settlement scenarios, the historical basis bands and the closest historical setups.
//
// Every calculation goes through src/engine.js (the browser copy of the Python engine, checked to 1e-9).
// Defaults come from data/lab.json with their source and date; anything the visitor types is marked
// "Your figure".

import { configure, month_days, hedge_lots, strip_price, outcome, td3c_outcome, paper_pnl, quarter_of, months_between } from "./engine.js";
import { h, clear, takeaway, setTakeaway, table, note, defs, segmented, nextId } from "./dom.js";
import { lineChart, waterfallChart, monthMid, empty } from "./charts.js";
import { num, numTrim, pct, signedPct, signed, usdDay, usdT, usdBig, signedUsdBig, compactMoney, dateLong, dateShort, monthLong, monthShort, tenorLabel, plural, listJoin, isNum, capitalise, horizonLabel, daysBetween, tonnes } from "./format.js";
import { wire, openIds, downloadLine, basketForWindow, retrievedOf } from "./view-kit.js";

const LAB = Object.freeze({
  scenarios: [-0.5, -0.25, 0, 0.25, 0.5],
  gridSteps: 20,
  range: 0.5,
  historyRows: 6,
  maxHorizon: 3,
  stripHeight: 180, // literal: px, height of the small chart of the paper's months
  kStep: 0.05,
  thousand: 1000, // literal: unit, sensitivity is quoted per USD 1,000 a day of settlement
});

const VOYAGES = [
  { id: "5TC trip", label: "5TC trip", detail: "a trip earning the day's 5TC" },
  { id: "C3", label: "C3", detail: "Tubarao to Qingdao" },
  { id: "C5", label: "C5", detail: "West Australia to Qingdao" },
  { id: "TD3C", label: "TD3C", detail: "Ras Tanura to Ningbo, VLCC" },
];
const STEP_IDS = ["exposure", "paper", "scenario"];

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
    section.append(takeaway("Hedge lab", "The hedge lab needs the latest cited curve, which lab.json does not carry in this build."));
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

  // ------------------------------------------------------------- model
  function autoHorizon() {
    const from = isTd3c() ? strip?.as_of : curve?.date;
    if (!from || !state.start) return 1;
    const m = months_between(from.slice(0, 7), state.start.slice(0, 7));
    return Math.max(1, Math.min(LAB.maxHorizon, m));
  }
  const horizon = () => state.horizon || autoHorizon();

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
  const labEl = h("div", { class: "lab" });
  const stepsEl = h("div", { class: "steps" });
  const outEl = h("div", { class: "outputs", "aria-live": "off" });
  labEl.append(stepsEl, outEl);
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
        update();
      },
    });
    const voyage = segmented({
      legend: "Voyage",
      name: "lab-voyage",
      value: state.voyage,
      options: VOYAGES.map((v) => ({ value: v.id, label: v.id === "5TC trip" ? v.label : `${v.label}, ${v.detail}` })),
      onChange: (v) => {
        state.voyage = v;
        if (!state.daysEdited) state.days = defaultDays(v);
        state.prices = {};
        state.horizon = null;
        state.historyIdx = 0;
        ctx.setParams({ voyage: v });
        renderExposure();
        renderPaper();
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
        h("span", { class: "hint" }, `The latest cited curve is dated ${dateLong(isTd3c() ? strip?.as_of : curve?.date)}; the default start is a month later.`)),
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
    const hzId = fieldId("horizon");
    const hz = h("select", { id: hzId, class: "input" });
    hz.append(h("option", { value: "" }, `Automatic: ${horizonLabel(autoHorizon())}`));
    for (let i = 1; i <= LAB.maxHorizon; i += 1) hz.append(h("option", { value: String(i) }, horizonLabel(i)));
    hz.value = state.horizon ? String(state.horizon) : "";
    hz.addEventListener("change", () => {
      state.horizon = hz.value ? Number(hz.value) : null;
      state.historyIdx = 0;
      update();
    });
    fields.push(h("div", { class: "field" }, h("label", { for: hzId }, "Hedge placed ahead of the start"), hz,
      h("span", { class: "hint" }, "Chooses the historical basis bands and setups below. Automatic: the whole months from the curve's date to the start, between one and three.")));
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
    tbl.append(h("caption", {}, isTd3c() ? "TD3C price for the loading month" : "FFA price for each month of the voyage"));
    tbl.append(h("thead", {}, h("tr", {},
      h("th", { scope: "col" }, "Month"),
      h("th", { scope: "col", class: "num" }, isTd3c() ? "Cargo, t" : "Voyage days"),
      h("th", { scope: "col", class: "num" }, isTd3c() ? `Lots of ${num(C.TONNES_PER_LOT_TD3C)} t` : "FFA days"),
      h("th", { scope: "col" }, `Price, ${unit}`),
      h("th", { scope: "col" }, "Source"))));
    const tb = h("tbody");
    for (const r of rows) {
      const id = fieldId("price");
      const edited = state.prices[r.month]?.edited;
      const input = h("input", { id, class: `input${edited ? " is-input" : ""}${!isNum(r.value) ? " is-missing" : ""}`, type: "number", min: "0", step: isTd3c() ? "0.001" : "1", inputmode: "decimal", required: true, value: isNum(r.value) ? String(r.value) : "", "aria-label": `Price for ${monthLong(r.month)}, ${unit}` });
      const tagCell = h("td");
      const setTag = (src, extra) => {
        clear(tagCell);
        if (src === "user") tagCell.append(h("span", { class: "tag is-input" }, "Your figure"));
        else if (src === "quarter") tagCell.append(h("span", { class: "tag is-proxy" }, `Quarter proxy (${tenorLabel(extra.quarter)})`));
        else if (src === "month") tagCell.append(h("span", { class: "tag" }, `Printed, ${dateShort(curve.date)}`));
        else if (src === "sec") tagCell.append(h("span", { class: "tag" }, `SEC mark, ${dateShort(strip.as_of)}`));
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
        h("td", { class: "num" }, isTd3c() ? num(state.tonnes) : num(r.days, 3)),
        h("td", { class: "num" }, lot ? num(isTd3c() ? lot.lots : lot.days, 2) : ""),
        h("td", {}, input),
        tagCell));
    }
    tbl.append(tb);
    body.append(h("div", { class: "table-wrap", role: "region", tabindex: "0", "aria-label": "Prices to hedge" }, tbl));
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
        tr.cells[1].textContent = l ? num(isTd3c() ? l.lots : l.days, 2) : "";
      });
    }
  }

  function drawPaperChart(m) {
    clear(paperChart);
    if (isTd3c() || !m.priced.length) return;
    const pts = m.priced.filter((p) => isNum(p.value));
    if (!pts.length) return;
    const series = [
      { cls: "ffa", line: false, dots: true, points: pts.filter((p) => p.source === "month").map((p) => ({ x: monthMid(p.month), y: p.value, tip: { title: monthLong(p.month), rows: [{ key: "ffa", value: usdDay(p.value), label: `printed on ${dateShort(curve.date)}` }] } })) },
      { cls: "ffa", line: false, dots: true, hollow: true, points: pts.filter((p) => p.source === "quarter").map((p) => ({ x: monthMid(p.month), y: p.value, tip: { title: monthLong(p.month), rows: [{ key: "ffa", value: usdDay(p.value), label: `quarter proxy, ${tenorLabel(p.quarter)}` }] } })) },
      { cls: "ink", line: false, dots: true, shape: "square", points: pts.filter((p) => p.source === "user").map((p) => ({ x: monthMid(p.month), y: p.value, tip: { title: monthLong(p.month), rows: [{ key: "ink", value: usdDay(p.value), label: "your figure" }] } })) },
    ];
    const xs = pts.map((p) => monthMid(p.month));
    const pad = (Math.max(...xs) - Math.min(...xs)) / Math.max(2, pts.length) || 1;
    lineChart(paperChart, {
      title: m.ok ? `F0, the strip price, is ${usdDay(m.f0)}` : "The months to hedge",
      subtitle: "Price of each month of the voyage, USD a day; F0 weights them by the voyage's days in each.",
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
      source: `Source: ${curve.source}, ${dateLong(curve.date)}, ${retrievedOf(manifest, "Banchero")}.`,
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
    body.append(h("p", {}, `The scenarios move every month's settlement by the same share of F0, from ${pct(-LAB.range, 0)} to ${signedPct(LAB.range, 0)}. The physical side earns the settlement (no basis); the basis bands below add the historical residual.`));
    body.append(h("div", { class: "field" }, h("label", { for: sid }, `Your settlement, ${unit} (average over the hedged ${isTd3c() ? "month" : "months"})`), h("div", { class: "button-row" }, input, tag),
      h("span", { class: "hint" }, "Optional: a settlement to test, drawn as a dashed line and added to the table.")));
  }

  // ----------------------------------------------------------- outputs
  function updateSummaries(m) {
    const v = VOYAGES.find((x) => x.id === state.voyage);
    steps.exposure.summary.textContent = isTd3c()
      ? `${capitalise(state.role)}, TD3C cargo of ${tonnes(state.tonnes)}${state.tonnesEdited ? " (your figure)" : ""}, loading ${state.start ? monthLong(state.start.slice(0, 7)) : "not set"}; basis history for ${horizonLabel(horizon())} ahead.`
      : `${capitalise(state.role)}, ${v.label} (${v.detail}) of ${isNum(state.days) ? num(state.days, 3) : "?"} days${state.daysEdited ? " (your figure)" : ""} from ${state.start ? dateLong(state.start) : "a date not set"}; basis history for ${horizonLabel(horizon())} ahead.`;
    const userPrices = Object.values(state.prices).filter((p) => p.edited).length;
    const proxies = m.priced.filter((p) => p.source === "quarter").length;
    steps.paper.summary.textContent = m.ok
      ? `${state.role === "owner" ? "Sell" : "Buy"} ${isTd3c() ? `${num(m.base.lots, 0)} lots (${tonnes(m.base.size_t)})` : `${num(m.base.size_days, 2)} FFA days`} at F0 ${isTd3c() ? usdT(m.f0) : usdDay(m.f0)}, k = ${numTrim(state.k, 2)}${proxies ? `; ${plural(proxies, "quarter proxy", "quarter proxies")}` : ""}${userPrices ? `; ${plural(userPrices, "price", "prices")} of yours` : ""}.`
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
      return `${who} hedging a TD3C cargo loading in ${monthLong(state.start.slice(0, 7))} at the ${dateLong(strip.as_of)} marks locks ${usdT(m.f0)}, ${usdBig(Math.abs(m.base.locked_usd))} for ${tonnes(state.tonnes)}.`;
    }
    const b = bandsFor(state.voyage, horizon());
    let s = `${who} hedging a ${v.label} voyage from ${dateLong(state.start)} locks ${usdDay(m.f0)} (${num(curve.basket_t)} t basket)`;
    if (b) s += `; past ${v.label} hedges placed ${horizonLabel(horizon())} ahead left a residual of ${signed(b.p05)} to ${signed(b.p95)} USD a day around what they locked (5th to 95th percentile${isNum(b.route_mean_removed_usd_day) && b.route_mean_removed_usd_day !== 0 ? ", route basis taken at its mean" : ""}).`;
    else s += ".";
    return s;
  }

  const lockedEl = h("div");
  const problemEl = h("div");
  const scenarioEl = h("div");
  const tableEl = h("div");
  const bandsEl = h("div");
  const historyEl = h("div");
  outEl.append(problemEl, lockedEl, scenarioEl, tableEl, bandsEl, historyEl);

  function update() {
    const m = model();
    setTakeaway(h1, "Hedge lab", sentence(m));
    updateSummaries(m);
    if (open.has("paper")) drawPaperChart(m);
    for (const el of [problemEl, lockedEl, scenarioEl, tableEl, bandsEl, historyEl]) clear(el);
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
      { label: isTd3c() ? "F0, the loading month's price" : `F0, the day-weighted strip (gross, ${num(curve.basket_t)} t basket)`, value: unitDay },
      { label: isTd3c() ? `Locked for ${tonnes(state.tonnes)}` : `Locked over ${num(state.days, 3)} days, net of ${numTrim(commission)} percent commission`, value: usdBig(Math.abs(m.base.locked_usd)) },
      { label: isTd3c() ? "Paper" : "Paper, one day a lot", value: isTd3c() ? `${state.role === "owner" ? "Sell" : "Buy"} ${num(m.base.lots, 0)} lots` : `${state.role === "owner" ? "Sell" : "Buy"} ${num(m.base.size_days, 2)} days` },
    ];
    const box = h("div", { class: "locked" });
    for (const it of items) box.append(h("div", {}, h("p", { class: "figure-label" }, it.label), h("p", { class: "figure" }, it.value)));
    lockedEl.append(box);
    if (!isTd3c()) {
      const perMonth = m.lots.map((l) => `${num(l.days, 2)} in ${monthShort(l.month)}`);
      lockedEl.append(h("p", { class: "table-note" }, `${state.role === "owner" ? "Sell" : "Buy"} ${listJoin(perMonth)}: the voyage's days in each month times ${num(keep, 4)} (the share the owner keeps) times k = ${numTrim(state.k, 2)}. ${state.role === "owner" ? "Locked earnings" : "Locked hire cost"}: F0 times the voyage's days times the same share.`));
    }
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
          { key: "spot", value: signedUsdBig(o.physical_usd), label: state.role === "owner" ? "voyage earnings" : "hire paid" },
          { key: "ffa", value: signedUsdBig(o.paper_usd), label: "paper" },
          { key: roleCls, value: signedUsdBig(o.total_usd), label: "total" },
        ],
        note: b ? `Basis band: ${signedUsdBig(m.at(sv, b.p05).total_usd)} to ${signedUsdBig(m.at(sv, b.p95).total_usd)}` : null,
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
      bands.push(band(b.p05, b.p95, false), band(b.p25, b.p75, true));
    }
    const vlines = [];
    if (isNum(state.userS)) vlines.push({ x: state.userS, label: "Your settlement", cls: "ink", dash: true });
    const slope = (m.at(m.f0 + LAB.thousand).total_usd - m.base.total_usd);
    const unitStep = isTd3c() ? "USD 1 a tonne" : `USD ${num(LAB.thousand)} a day`;
    const stepSlope = isTd3c() ? (m.at(m.f0 + 1).total_usd - m.base.total_usd) : slope;
    let title;
    if (Math.abs(stepSlope) < 1) title = `At k = ${numTrim(state.k, 2)} the paper offsets the ${isTd3c() ? "cargo" : "voyage"}: the total stays at the ${usdBig(Math.abs(m.base.locked_usd))} locked whatever the settlement, before basis`;
    else title = `At k = ${numTrim(state.k, 2)} the total moves ${signedUsdBig(stepSlope)} for every ${unitStep} the settlement rises, before basis`;
    const legend = [
      { label: state.role === "owner" ? "Voyage earnings at the settlement" : "Hire paid at the settlement", cls: "spot", kind: "line" },
      { label: "Paper profit and loss", cls: "ffa", kind: "line" },
      { label: `Total, ${state.role}`, cls: roleCls, kind: "line" },
    ];
    if (b) legend.push({ label: "Total with the historical basis, 5th to 95th and 25th to 75th percentiles", cls: roleCls, kind: "band" });
    legend.push({ label: `Locked, ${signedUsdBig(m.base.locked_usd)}`, cls: "muted", kind: "thin" });
    if (isNum(state.userS)) legend.push({ label: "Your settlement (input)", cls: "ink", kind: "dash" });
    lineChart(scenarioEl, {
      title,
      subtitle: `USD over the ${isTd3c() ? "cargo" : "voyage"} against the settlement of the hedged ${isTd3c() ? "month" : "months"} (${isTd3c() ? "USD a tonne" : "USD a day"}), from ${pct(-LAB.range, 0)} to ${signedPct(LAB.range, 0)} of F0.${state.role === "charterer" ? " Hire paid and the total are costs, so they are negative." : ""}`,
      legend,
      x: { type: "linear", title: isTd3c() ? "Settlement, USD a tonne" : "Settlement, USD a day" },
      y: { title: "USD", format: (v) => compactMoney(v) },
      series,
      bands,
      refs: [{ y: m.base.locked_usd }],
      vlines,
      mode: "x",
      summary: `F0 ${fmtS(m.f0)}. ${LAB.scenarios.map((x) => { const sv = m.f0 * (1 + x); const o = m.at(sv); return `At ${x === 0 ? "F0" : signedPct(x, 0)} (${fmtS(sv)}): paper ${signedUsdBig(o.paper_usd)}, total ${signedUsdBig(o.total_usd)}`; }).join("; ")}.${b ? ` With the historical basis (${state.voyage}, ${horizonLabel(horizon())}), the total at F0 runs from ${signedUsdBig(m.at(m.f0, b.p05).total_usd)} to ${signedUsdBig(m.at(m.f0, b.p95).total_usd)} (5th to 95th percentile).` : ""}`,
      source: isTd3c() ? `Source: engine.js td3c_outcome on BWET's marks of ${dateLong(strip.as_of)} (SEC EDGAR, ${retrievedOf(manifest, "SEC")}).` : `Source: engine.js outcome on ${curve.source}, ${dateLong(curve.date)} (${retrievedOf(manifest, "Banchero")})${b ? "; basis bands from lab.json (the study's hedge outcomes)" : ""}.`,
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
        { label: isTd3c() ? "Settlement, USD a tonne" : "Settlement, USD a day", num: true, format: (r) => fmtS(r.s) },
        { label: state.role === "owner" ? "Voyage, USD" : "Hire, USD", num: true, format: (r) => signed(m.at(r.s).physical_usd) },
        { label: "Paper, USD", num: true, format: (r) => signed(m.at(r.s).paper_usd) },
        { label: "Total, USD", num: true, format: (r) => signed(m.at(r.s).total_usd) },
        { label: "Total against locked, USD", num: true, format: (r) => signed(m.at(r.s).versus_locked_usd) },
        ...(isTd3c() ? [] : [{ label: "Total, USD a day", num: true, format: (r) => signed(m.at(r.s).total_usd_day) }]),
      ],
      rows,
      note: `Paper = ${state.role === "owner" ? "(F0 minus settlement)" : "(settlement minus F0)"} times ${isTd3c() ? `${num(m.base.size_t)} t` : `${num(m.base.size_days, 2)} FFA days`}, through engine.js paper_pnl: at the first scenario ${signedUsdBig(paper_pnl(state.role, m.f0, m.f0 * (1 + LAB.scenarios[0]), isTd3c() ? m.base.size_t : m.base.size_days))}.`,
    }));
  }

  function renderBands(m) {
    if (isTd3c()) {
      bandsEl.append(h("h2", { class: "section-title" }, "Basis bands"));
      bandsEl.append(h("p", { class: "lede" }, "lab.json has no historical basis distribution for TD3C: the study has no settled TD3C series in USD a tonne to measure one against (the flat-rate test in the TD3C view). The scenarios above assume the cargo earns the settlement."));
      return;
    }
    const all = (lab.bands || []).filter((b) => b.voyage === state.voyage).sort((a, b) => a.horizon_months - b.horizon_months);
    const b = bandsFor(state.voyage, horizon());
    bandsEl.append(h("h2", { class: "section-title" }, `Basis bands: what the ${state.voyage} hedge left, historically`));
    if (!b) {
      bandsEl.append(h("p", { class: "lede" }, `lab.json has no bands for ${state.voyage} at ${horizonLabel(horizon())}.`));
      return;
    }
    const sign = state.role === "owner" ? 1 : -1;
    bandsEl.append(h("p", { class: "lede" }, `The residual is what a 1:1 hedge did not remove: the voyage's gross TCE minus the settlement it was hedged on, in USD a day (timing, route and size basis). Applied to this ${state.role === "owner" ? "voyage" : "charter"}, each percentile moves the total by the residual times the days kept. ${state.role === "charterer" ? "For a charterer a positive residual is extra hire, so the signs reverse." : ""}`));
    if (isNum(b.route_mean_removed_usd_day) && b.route_mean_removed_usd_day !== 0) {
      bandsEl.append(h("p", { class: "small muted" }, `Route basis enters with its mean (${signed(b.route_mean_removed_usd_day)} USD a day for ${state.voyage} at ${horizonLabel(b.horizon_months)}) removed: the study's voyage TCEs leave out port charges and the loading time at the port's scale, which have no public figure, so the level of the route basis is overstated while its spread, which these bands show, is not.`));
    }
    bandsEl.append(table({
      caption: `Residual after the hedge, ${state.voyage}, USD a day (k = 1${all.some((r) => isNum(r.route_mean_removed_usd_day) && r.route_mean_removed_usd_day !== 0) ? "; route basis at its mean" : ""})`,
      columns: [
        { label: "Placed ahead", format: (r) => horizonLabel(r.horizon_months) },
        { label: "Fixtures", num: true, format: (r) => num(r.n) },
        { label: "5th", num: true, format: (r) => signed(r.p05) },
        { label: "25th", num: true, format: (r) => signed(r.p25) },
        { label: "Median", num: true, format: (r) => signed(r.p50) },
        { label: "75th", num: true, format: (r) => signed(r.p75) },
        { label: "95th", num: true, format: (r) => signed(r.p95) },
      ],
      rows: all,
      rowAttrs: (r) => (r.horizon_months === b.horizon_months ? { class: "is-selected" } : {}),
      note: `Selected: ${horizonLabel(b.horizon_months)}. Applied at F0 to this ${state.role === "owner" ? "voyage" : "charter"}, the total ranges from ${signedUsdBig(m.at(m.f0, sign > 0 ? b.p05 : b.p95).total_usd)} (5th) to ${signedUsdBig(m.at(m.f0, sign > 0 ? b.p95 : b.p05).total_usd)} (95th), against ${signedUsdBig(m.base.locked_usd)} locked.`,
    }));
  }

  function renderHistory(m) {
    if (isTd3c()) return;
    const hz = horizon();
    const pool = (lab.history || []).filter((r) => r.voyage === state.voyage && r.horizon_months === hz);
    historyEl.append(h("h2", { class: "section-title" }, "The closest historical setups"));
    if (!pool.length) {
      historyEl.append(h("p", { class: "lede" }, `lab.json has no ${state.voyage} fixtures hedged ${horizonLabel(hz)} ahead.`));
      return;
    }
    const sign = state.role === "owner" ? 1 : -1;
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
    historyEl.append(h("p", { class: "lede" }, `${state.voyage} fixtures hedged ${horizonLabel(hz)} ahead at k = 1, ${state.historyMode === "month" ? "in the start's calendar month" : "nearest the start date"}, in USD a day ${state.role === "owner" ? "from the owner's side" : "from the charterer's side (the stored owner figures with their signs reversed)"}. Choose a row to see its waterfall.`));
    historyEl.append(tblBox, chartBox);
    function drawTable() {
      clear(tblBox);
      tblBox.append(table({
        caption: "Closest setups",
        columns: [
          { label: "Show", format: (r) => { const i = rows.indexOf(r); const btn = h("button", { type: "button", class: "btn", "aria-pressed": String(i === state.historyIdx) }, dateShort(r.fixture)); btn.addEventListener("click", () => { state.historyIdx = i; drawTable(); drawWaterfall(); }); return btn; } },
          { label: "Hedged on", format: (r) => dateShort(r.hedged_on) },
          { label: "Months", format: (r) => h("span", { class: "wrap-ok" }, r.months.map((mm, i) => h("span", { class: "nowrap" }, `${tenorLabel(mm)}${i < r.months.length - 1 ? "," : ""}`)).flatMap((n, i) => (i ? [" ", n] : [n]))) },
          { label: "Unhedged surprise", num: true, format: (r) => signed(sign * r.unhedged_usd_day) },
          { label: "Paper", num: true, format: (r) => signed(-sign * r.paper_move_usd_day) },
          { label: "Residual", num: true, format: (r) => signed(sign * r.residual_usd_day) },
          { label: "Timing", num: true, format: (r) => signed(sign * r.timing_usd_day) },
          { label: "Route", num: true, format: (r) => signed(sign * r.route_usd_day) },
          { label: "Size", num: true, format: (r) => signed(sign * r.size_usd_day) },
        ],
        rows,
        rowAttrs: (r) => (rows.indexOf(r) === state.historyIdx ? { class: "is-selected" } : {}),
        note: "Unhedged surprise: the voyage's gross TCE minus F0. Paper: the hedge's gain per day hedged. Residual: their sum, split into timing, route and size basis. Levels are not published, only these differences.",
      }));
    }
    function drawWaterfall() {
      clear(chartBox);
      const r = rows[state.historyIdx];
      const basket = basketForWindow(engine, r.fixture, r.fixture);
      const steps = [
        { label: "Voyage against F0", value: sign * r.unhedged_usd_day, cls: "spot", kind: "start" },
        { label: "Paper", value: -sign * r.paper_move_usd_day, cls: "ffa", kind: "delta" },
        { label: "Hedged result against F0", value: sign * r.residual_usd_day, cls: "ink", kind: "total", outline: true },
        { label: "Timing basis", value: sign * r.timing_usd_day, cls: "timing", kind: "part" },
        { label: "Route basis", value: sign * r.route_usd_day, cls: "route", kind: "part" },
        { label: "Size basis", value: sign * r.size_usd_day, cls: "size", kind: "part" },
      ].map((st) => ({ ...st, valueLabel: signed(st.value), tip: { title: st.label, rows: [{ key: st.cls === "ink" ? "ink" : st.cls, value: `${signed(st.value)} USD a day`, label: "" }], note: `Fixture ${dateShort(r.fixture)}, hedged ${dateShort(r.hedged_on)}` } }));
      waterfallChart(chartBox, {
        level: 3,
        title: `Fixture of ${dateLong(r.fixture)}: the hedge turned ${signed(sign * r.unhedged_usd_day)} into ${signed(sign * r.residual_usd_day)} USD a day against F0`,
        subtitle: `${state.voyage}, ${num(r.days, 3)} days over ${r.months.map((mm) => tenorLabel(mm)).join(", ")}, hedged on ${dateLong(r.hedged_on)} at k = 1. USD a day${basket ? `; ${basket}` : ""}.`,
        legend: [
          { label: "Voyage", cls: "spot", kind: "rect" },
          { label: "Paper", cls: "ffa", kind: "rect" },
          { label: "Hedged result", cls: "ink", kind: "outline" },
          { label: "Timing basis", cls: "timing", kind: "rect" },
          { label: "Route basis", cls: "route", kind: "rect" },
          { label: "Size basis", cls: "size", kind: "rect" },
        ],
        steps,
        x: { title: "USD a day", format: (v) => signed(v) },
        summary: `The voyage came in ${signed(sign * r.unhedged_usd_day)} USD a day against F0, the paper added ${signed(-sign * r.paper_move_usd_day)}, leaving ${signed(sign * r.residual_usd_day)}: timing ${signed(sign * r.timing_usd_day)}, route ${signed(sign * r.route_usd_day)}, size ${signed(sign * r.size_usd_day)}.`,
        source: `Source: lab.json history (the study's hedge outcomes; surprises and basis parts, no levels), from data ${retrievedOf(manifest, "Banchero")}.`,
      });
    }
    drawTable();
    drawWaterfall();
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
            { term: "Basis bands", desc: "The 5th, 25th, 50th, 75th and 95th percentiles of the residual (gross TCE minus settlement at k = 1) of the study's fixtures for the same voyage and horizon, added to the physical leg; the route basis enters with its mean removed, because its level is overstated (port charges and loading time are left out of the voyage TCEs) while its spread is not." },
            { term: "Closest setups", desc: "The study's fixtures of the same voyage and horizon, ranked by distance from the start date, or restricted to the start's calendar month." },
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
            { term: "Commission", desc: `${numTrim(commission)} percent total (lab.json, from the Baltic's route definitions).` },
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
            caption: "Basis bands, every voyage and horizon (USD a day)",
            columns: [
              { key: "voyage", label: "Voyage" },
              { label: "Placed ahead", format: (r) => horizonLabel(r.horizon_months) },
              { label: "Fixtures", num: true, format: (r) => num(r.n) },
              { label: "5th", num: true, format: (r) => signed(r.p05) },
              { label: "25th", num: true, format: (r) => signed(r.p25) },
              { label: "Median", num: true, format: (r) => signed(r.p50) },
              { label: "75th", num: true, format: (r) => signed(r.p75) },
              { label: "95th", num: true, format: (r) => signed(r.p95) },
            ],
            rows: lab.bands || [],
          }));
          body.append(table({
            caption: "Latest cited curve used for the defaults",
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
    update(params) {
      let changed = false;
      if ((params.role === "owner" || params.role === "charterer") && params.role !== state.role) {
        state.role = params.role;
        changed = true;
      }
      if (params.voyage && params.voyage !== state.voyage && VOYAGES.some((v) => v.id === params.voyage)) {
        state.voyage = params.voyage;
        if (!state.daysEdited) state.days = defaultDays(params.voyage);
        state.prices = {};
        state.horizon = null;
        state.historyIdx = 0;
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
