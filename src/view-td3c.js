// view-td3c.js: TD3C through the 2026 Strait of Hormuz closure. Weekly TD3C and TD34 prints with the
// weeks the Baltic's panel found hard to assess, the forward marks against later spot prints, and the
// case studies as a step-through with a waterfall each.

import { add_months } from "./engine.js";
import { h, clear, takeaway, table, note, defs, segmented } from "./dom.js";
import { lineChart, waterfallChart, monthMid, dayMs, empty } from "./charts.js";
import { num, pct, shareOf, signed, usdDay, usdT, ws, usdBig, signedUsdBig, compactMoney, dateLong, monthLong, monthShort, tenorLabel, plural, listJoin, isNum, tonnes, addDays, daysBetween, capitalise, horizonLabel, numberWord } from "./format.js";
import { wire, retrievedTo, retrievedOf, downloadLine, stripSummary } from "./view-kit.js";

const SHAPE = Object.freeze({
  weekDays: 6, // a week's shade runs back six days from the report's date
  week: 7,
  missingAfter: 10, // more days than this between two weekly reports means a week has no report
  quarter: 3,
  rows: 16,
});

/** "on 26 March 2026 (week to 27 March)": the weekday the report names, inside the week it closes. */
function firstAssessed(w) {
  const name = w.td34_assessed_day;
  if (name) {
    for (let back = 0; back < SHAPE.week; back += 1) {
      const day = addDays(w.week, -back);
      const dayName = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
      if (dayName === name) return back ? `on ${dateLong(day)} (week to ${dateLong(w.week).replace(/ \d{4}$/, "")})` : `on ${dateLong(day)}`;
    }
  }
  return `in the week to ${dateLong(w.week)}`;
}

/** "2025-H2" -> "the second half of 2025"; a year stays a year. */
function periodLabel(key) {
  const m = /^(\d{4})-H([12])$/.exec(key);
  return m ? `the ${m[2] === "1" ? "first" : "second"} half of ${m[1]}` : key;
}

// Why a week is marked, in the Baltic's terms (td3c.json weekly thin_reason).
const REASONS = Object.freeze({
  assessment: "assessment theoretical or hard",
  transits: "transits limited or blocked",
  "assessment and transits": "assessment theoretical or hard, transits limited or blocked",
});

const UNITS = [
  { value: "ws", label: "Worldscale points" },
  { value: "tce", label: "Round-trip TCE, USD a day" },
];

function render(section, ctx) {
  const { td3c, engine, manifest } = ctx.data;
  const weekly = (td3c.weekly || []).slice().sort((a, b) => (a.week < b.week ? -1 : 1));
  const events = (td3c.events || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const closure = events[0];
  const thin = weekly.filter((w) => w.thin_market);
  const peak = weekly.length ? weekly.reduce((a, b) => (b.ws_points > a.ws_points ? b : a)) : null;
  const before = closure ? weekly.filter((w) => w.week < closure.date).pop() : null;
  const retrieved = retrievedTo(manifest);
  const asOf = td3c.as_of || weekly[weekly.length - 1]?.week;
  const weeklySource = `Source: Baltic Exchange weekly tanker reports to ${dateLong(asOf)} (links in the Data section). ${retrieved}`;

  // ---------------------------------------------------------- takeaway
  let sentence = "The TD3C weekly prints are not in this build of the data.";
  if (peak) {
    sentence = before
      ? `TD3C went from ${ws(before.ws_points)} before the Strait of Hormuz closed to ${ws(peak.ws_points)}, ${usdDay(peak.tce_usd_day)} round trip, in the week to ${dateLong(peak.week)}.`
      : `TD3C peaked at ${ws(peak.ws_points)}, ${usdDay(peak.tce_usd_day)} round trip, in the week to ${dateLong(peak.week)}.`;
  }
  section.append(takeaway("TD3C 2026", sentence));

  // ---------------------------------------------------------- key chart
  const key = h("div");
  section.append(key);
  const firstYear = closure ? closure.date.slice(0, 4) : weekly.length ? weekly[weekly.length - 1].week.slice(0, 4) : null;
  const RANGES = [
    { value: "year", label: `Since January ${firstYear}`, from: `${firstYear}-01-01` },
    { value: "all", label: `All weeks since ${monthLong(weekly[0]?.week?.slice(0, 7) || "")}`, from: weekly[0]?.week },
  ];
  const chartBox = h("div");
  const eventsBox = h("div");
  if (weekly.length) {
    const unitSeg = segmented({ legend: "Unit", name: "td3c-unit", value: ctx.params.unit === "tce" ? "tce" : "ws", options: UNITS, onChange: (v) => { ctx.setParams({ unit: v }); drawWeekly(); } });
    const rangeSeg = segmented({ legend: "Weeks", name: "td3c-range", value: ctx.params.range === "all" ? "all" : "year", options: RANGES.map((r) => ({ value: r.value, label: r.label })), onChange: (v) => { ctx.setParams({ range: v }); drawWeekly(); } });
    key.append(h("div", { class: "controls" }, unitSeg.el, rangeSeg.el), chartBox, eventsBox);
  } else empty(key, { title: "Weekly TD3C", text: "This build carries no weekly TD3C prints." });

  let drawn = null;
  function drawWeekly() {
    clear(chartBox);
    const unit = ctx.params.unit === "tce" ? "tce" : "ws";
    const range = RANGES.find((r) => r.value === (ctx.params.range === "all" ? "all" : "year"));
    drawn = `${unit}/${range.value}`;
    const rows = weekly.filter((w) => w.week >= range.from);
    // a week with no report breaks the lines rather than joining across it
    const gaps = [];
    rows.forEach((w, i) => {
      const nxt = rows[i + 1];
      if (nxt && daysBetween(w.week, nxt.week) > SHAPE.missingAfter) gaps.push({ after: w.week, first: addDays(w.week, SHAPE.week) });
    });
    const gapAfter = new Set(gaps.map((g) => g.after));
    const v3 = (w) => (unit === "tce" ? w.tce_usd_day : w.ws_points);
    const v34 = (w) => (unit === "tce" ? w.td34_tce_usd_day : w.td34_ws_points);
    const fmt = (v) => (unit === "tce" ? usdDay(v) : ws(v));
    const td34 = rows.filter((w) => isNum(v34(w)));
    const tip = (w) => {
      const rowsT = [{ key: "spot", value: fmt(v3(w)), label: "TD3C" }];
      if (isNum(v34(w))) rowsT.push({ key: "route", value: fmt(v34(w)), label: "TD34" });
      const other = unit === "tce" ? ws(w.ws_points) : usdDay(w.tce_usd_day);
      rowsT.push({ key: null, value: other, label: unit === "tce" ? "TD3C in Worldscale" : "TD3C round-trip TCE" });
      let noteText = null;
      if (w.source_typo) noteText = `The report printed ${ws(w.ws_points_printed)} with a TCE of ${usdDay(w.tce_usd_day_printed)}. ${w.source_typo}`;
      else if (w.thin_market) noteText = `Marked (${REASONS[w.thin_reason] || "thin market"}). The Baltic: "${w.note}"`;
      else if (w.note) noteText = `The Baltic: "${w.note}"`;
      const days = [w.assessed_day && `TD3C assessed ${w.assessed_day}`, isNum(v34(w)) && w.td34_assessed_day && `TD34 ${w.td34_assessed_day}`].filter(Boolean);
      return { title: `Week to ${dateLong(w.week)}${days.length ? ` (${days.join("; ")})` : ""}`, rows: rowsT, note: noteText };
    };
    const withBreaks = (val) => rows.flatMap((w) => {
      const pt = { x: dayMs(w.week), y: isNum(val(w)) ? val(w) : NaN, tip: tip(w) };
      return gapAfter.has(w.week) ? [pt, { x: dayMs(addDays(w.week, SHAPE.week)), y: NaN }] : [pt];
    });
    const series = [
      { cls: "spot", dots: false, points: withBreaks(v3), endLabel: "TD3C" },
    ];
    series.push({ cls: "spot", line: false, dots: true, hollow: true, points: rows.filter((w) => w.thin_market).map((w) => ({ x: dayMs(w.week), y: v3(w) })) });
    if (td34.length) series.push({ cls: "route", points: withBreaks(v34), endLabel: "TD34" });
    const shades = rows.filter((w) => w.thin_market).map((w) => ({ x0: dayMs(addDays(w.week, -SHAPE.weekDays)), x1: dayMs(w.week) }));
    const vlines = events.filter((e) => e.date >= range.from).map((e, i) => ({ x: dayMs(e.date), label: String(events.indexOf(e) + 1), row: i % 2 }));
    const pk = rows.reduce((a, b) => (v3(b) > v3(a) ? b : a));
    const td34pk = td34.length ? td34.reduce((a, b) => (v34(b) > v34(a) ? b : a)) : null;
    const td34From = td34.length ? (unit === "tce" ? `TD34 TCE first reported ${dateLong(td34[0].week)}` : `TD34, first assessed ${firstAssessed(td34[0])}`) : "";
    const title = `TD3C peaked at ${fmt(v3(pk))} in the week to ${dateLong(pk.week)}${td34pk ? `; ${td34From}, peaked at ${fmt(v34(td34pk))} in the week to ${dateLong(td34pk.week)}` : ""}`;
    const legend = [
      { label: "TD3C, Ras Tanura to Ningbo", cls: "spot", kind: "line" },
    ];
    if (td34.length) legend.push({ label: "TD34, Mina Al Fahal to Ningbo (trial route)", cls: "route", kind: "line" });
    if (thin.length) legend.push({ label: "Marked week: assessment theoretical or hard, or transits limited or blocked", cls: "spot", kind: "hatch" });
    const yearly = rows.length ? `${dateLong(rows[0].week)} to ${dateLong(rows[rows.length - 1].week)}` : "";
    lineChart(chartBox, {
      title,
      subtitle: `${unit === "tce" ? "Round-trip time charter equivalent, USD a day" : "Worldscale points"}, weekly, as the Baltic Exchange reported them. Numbered lines are the events listed under the chart; the lines break where a week has no report or no TD3C print.${thin.length ? ` Hatched: the ${plural(thin.length, "marked week", "marked weeks")} of the closure, in which the Baltic's own reports called the assessment theoretical or hard, or reported transits through the Strait extremely limited or blocked.` : ""}`,
      legend,
      x: { type: "time" },
      y: { title: unit === "tce" ? "USD a day" : "Worldscale points", includeZero: true },
      series,
      shades,
      vlines,
      mode: "x",
      targets: ({ x, y }) => rows.map((w) => ({ x: x(dayMs(w.week)), y: y(v3(w)), tip: tip(w) })),
      summary: `Weekly TD3C ${unit === "tce" ? "TCE" : "Worldscale"} from ${yearly}: low ${fmt(Math.min(...rows.map(v3).filter(isNum)))}, high ${fmt(v3(pk))} (week to ${dateLong(pk.week)}), last ${fmt(v3(rows[rows.length - 1]))} (week to ${dateLong(rows[rows.length - 1].week)}).${td34pk ? ` ${td34From}: high ${fmt(v34(td34pk))}, last ${fmt(v34(td34[td34.length - 1]))}.` : ""}${thin.length ? ` Marked weeks: ${listJoin(thin.filter((w) => w.week >= range.from).map((w) => dateLong(w.week)))}.` : ""}${gaps.length ? ` The lines break at ${plural(gaps.length, "gap", "gaps")} where a weekly report is missing or gives no TD3C print, the first in this range the week to ${dateLong(gaps[0].first)}.` : ""}`,
      source: weeklySource,
    });
    clear(eventsBox);
    if (events.length) {
      const ol = h("ol", { class: "small" });
      events.forEach((e) => ol.append(h("li", {}, `${dateLong(e.date)}: ${e.text} (`, e.url ? h("a", { href: e.url }, e.source) : e.source, ").")));
      eventsBox.append(h("div", { class: "prose" }, ol));
    }
    if (thin.length) {
      const byReason = (r) => thin.filter((w) => (w.thin_reason || "").includes(r));
      const hard = byReason("assessment");
      const stopped = byReason("transits");
      eventsBox.append(note(h("strong", {}, "Marked weeks. "), `The study marks a week when the Baltic's own weekly report says its Gulf assessment was theoretical or hard (its panellists had "an extraordinarily difficult week", "challenges", "some difficulties in assessing"): the weeks to ${listJoin(hard.map((w) => dateLong(w.week)))}; or that transits through the Strait of Hormuz were extremely limited or blocked: the weeks to ${listJoin(stopped.map((w) => dateLong(w.week)))}. Every week's own sentence is in the tooltips and the Data section.`));
    }
  }
  if (weekly.length) drawWeekly();

  // -------------------------------------------------------------- panels
  const cases = Array.isArray(td3c.cases) ? td3c.cases : null;
  let showCase = null;
  const panels = [
    {
      id: "marks",
      label: "Forward marks",
      render(body) {
        const strips = td3c.strips || [];
        const bw = td3c.breakwave || [];
        if (!strips.length && !bw.length) {
          empty(body, { title: "Forward marks", text: "This build carries no quarter-end marks or Breakwave prints." });
          return;
        }
        const statement = td3c.breakwave_statement;
        const stats = td3c.statistics?.rows || [];
        let title = "BWET's quarter-end TD3C marks against Breakwave's spot prints, USD a tonne";
        if (stats.length) {
          const below = stats.filter((r) => r.physical > r.f0).length;
          const widest = stats.reduce((x, y) => (Math.abs(y.physical - y.f0) > Math.abs(x.physical - x.f0) ? y : x));
          title = `The marks sat below the spot that followed in ${below === stats.length ? `all ${stats.length}` : `${below} of ${stats.length}`} months with a later print; widest, ${monthLong(widest.contract)}: marked at ${usdT(widest.f0)} on ${dateLong(widest.as_of)}, spot ${usdT(widest.physical)}`;
        }
        const series = strips.map((st) => ({
          cls: "ffa",
          dots: true,
          points: st.months.map((mm) => ({ x: monthMid(mm.month), y: mm.usd_t, tip: { title: `${monthLong(mm.month)} contract, marked ${dateLong(st.as_of)}`, rows: [{ key: "ffa", value: usdT(mm.usd_t, 3), label: "" }, { key: null, value: num(mm.contracts), label: "contracts held by BWET" }] } })),
        }));
        series.push({ cls: "spot", line: false, dots: true, r: 5, points: bw.filter((b) => isNum(b.td3c_usd_t)).map((b) => ({ x: dayMs(b.date), y: b.td3c_usd_t, tip: { title: `Breakwave tanker report, ${dateLong(b.date)}`, rows: [{ key: "spot", value: usdT(b.td3c_usd_t), label: "TD3C spot" }, { key: null, value: num(b.btfi_points), label: "Breakwave Tanker Futures Index, points" }] } })) });
        const vlines = statement ? [{ x: dayMs(statement.date), label: `Breakwave, ${dateLong(statement.date)}` }] : [];
        const box = h("div");
        body.append(box);
        lineChart(box, {
          title,
          subtitle: "USD a tonne. Lines: the TD3C futures BWET held at each quarter end (SEC filings). Dots: TD3C spot in Breakwave's bi-weekly tanker reports.",
          legend: [
            { label: "Quarter-end futures marks (one line per filing)", cls: "ffa", kind: "line" },
            { label: "TD3C spot, Breakwave report", cls: "spot", kind: "dot" },
          ],
          x: { type: "time" },
          y: { title: "USD a tonne", includeZero: true },
          series,
          vlines,
          summary: stripSummary(strips, bw),
          footer: h("p", { class: "chart-summary" }, "Every mark and every Breakwave print is in the Data section."),
          source: `Source: Amplify Commodity Trust 10-Q and 10-K filings (SEC EDGAR, ${retrievedOf(manifest, "SEC")}); Breakwave Advisors tanker reports (via Hellenic Shipping News, ${retrievedOf(manifest, "Breakwave")}).`,
        });
        if (statement) {
          body.append(h("blockquote", { class: "note" }, `"${statement.text}" `, h("a", { href: statement.url }, `Breakwave Advisors, ${dateLong(statement.date)}`), "."));
        }
        const check = td3c.statement_check;
        if (statement && check) {
          const settled = check.months.filter((r) => isNum(r.settlement_estimate_usd_t));
          const missing = check.months.filter((r) => !isNum(r.settlement_estimate_usd_t));
          body.append(h("div", { class: "prose" }, h("p", {},
            `Against what the quarter settled at: Breakwave's report of ${dateLong(check.date)} put TD3C at ${usdT(check.index_usd_t)}, so third-quarter futures at the stated discount (${pct(check.discount, 0)}) stood near ${usdT(check.implied_q3_usd_t)}, and BWET's marks of ${dateLong(check.marks_as_of)} priced the quarter's months at ${listJoin(check.months.filter((r) => isNum(r.mark_usd_t)).map((r) => `${usdT(r.mark_usd_t)} (${monthLong(r.month)})`))}. `,
            settled.length
              ? `The months with a later dollar print settled, approximately, at ${listJoin(settled.map((r) => `${usdT(r.settlement_estimate_usd_t)} (${monthLong(r.month)}, ${plural(r.prints, "print", "prints")})`))}${missing.length ? `; ${listJoin(missing.map((r) => monthLong(r.month)))} has no dollar print` : ""}.`
              : "No month of the quarter has a later dollar print yet.",
          )));
          body.append(table({
            caption: `Breakwave's statement of ${dateLong(check.date)} against the third quarter's settlement, USD a tonne`,
            columns: [
              { label: "Month", format: (r) => monthLong(r.month) },
              { label: `BWET mark, ${dateLong(check.marks_as_of)}`, num: true, format: (r) => (isNum(r.mark_usd_t) ? num(r.mark_usd_t, 2) : "") },
              { label: "Implied by the statement", num: true, format: () => num(check.implied_q3_usd_t, 2) },
              { label: "Settlement: Breakwave average", num: true, format: (r) => (isNum(r.settlement_estimate_usd_t) ? num(r.settlement_estimate_usd_t, 2) : "no print") },
              { label: "Prints", num: true, format: (r) => num(r.prints) },
            ],
            rows: check.months,
          }));
        }
      },
    },
    {
      id: "cases",
      label: "Case studies",
      render(body) {
        if (!cases || !cases.length) {
          empty(body, { title: "Case studies", text: "This build carries no case studies." });
          return;
        }
        const stepper = h("div", { class: "stepper" });
        const prev = h("button", { type: "button", class: "btn" }, "Previous");
        const next = h("button", { type: "button", class: "btn" }, "Next");
        const position = h("p", { class: "position", "aria-live": "polite" });
        stepper.append(prev, position, next);
        const caseBox = h("div", { class: "case" });
        body.append(stepper, caseBox);
        let i = Math.min(cases.length - 1, Math.max(0, Number(ctx.params.case || 1) - 1) || 0);
        function show() {
          position.textContent = `Case ${i + 1} of ${cases.length}`;
          prev.disabled = i === 0;
          next.disabled = i === cases.length - 1;
          renderCase(caseBox, cases[i]);
        }
        prev.addEventListener("click", () => { if (i > 0) { i -= 1; ctx.setParams({ case: String(i + 1) }); show(); } });
        next.addEventListener("click", () => { if (i < cases.length - 1) { i += 1; ctx.setParams({ case: String(i + 1) }); show(); } });
        show();
        // the hash can name another case (back, forward or a link): follow it
        showCase = (n) => {
          const j = Math.min(cases.length - 1, Math.max(0, Number(n || 1) - 1) || 0);
          if (j !== i) {
            i = j;
            show();
          }
        };
      },
    },
  ];

  /** Forward errors by horizon, with and without the months that hold a marked week (approximate). */
  function renderHorizonStats(body) {
    const S = td3c.statistics || {};
    const groups = [["all months", S.by_horizon || []], ["without marked weeks", S.without_thin_weeks || []]];
    const rows = groups.flatMap(([g, rs]) => rs.map((r) => ({ ...r, group: g }))).sort((a, b) => a.horizon_months - b.horizon_months || (a.group < b.group ? -1 : 1));
    if (!rows.length) return;
    const eff = (r) => (isNum(r.effectiveness_k1)
      ? pct(r.effectiveness_k1)
      : `not computed: ${num(r.n_effectiveness)} months with ${numberWord(S.min_prints_for_residual ?? 2)} prints, ${num(S.threshold_months)} needed`);
    body.append(table({
      caption: "Forward errors by horizon, USD a tonne (approximate)",
      columns: [
        { label: "Horizon", format: (r) => h("span", {}, capitalise(horizonLabel(r.horizon_months)), h("br"), h("span", { class: "muted" }, r.group)) },
        { label: "Mean, settlement minus mark", num: true, format: (r) => signed(r.mean_error_usd_t, 2) },
        { label: "RMSE", num: true, format: (r) => num(r.rmse_usd_t, 2) },
        { label: "Settled above the mark", num: true, format: (r) => shareOf(r.share_positive, r.n, 0) },
        { label: "Contracts", num: true, format: (r) => num(r.n) },
        { label: "From", format: (r) => monthShort(r.first) },
        { label: "To", format: (r) => monthShort(r.last) },
        { label: "Hedge effectiveness at k = 1", format: eff },
      ],
      rows,
      note: `Approximate: each settlement is the average of the month's Breakwave prints in USD a tonne, one to three a month, not of every publication day. "Without marked weeks" leaves out the contract months that hold a week the study marks. Hedge effectiveness needs ${num(S.threshold_months)} contract months with ${numberWord(S.min_prints_for_residual ?? 2)} prints or more at a horizon; ${(S.counts || []).length ? `there are ${listJoin(S.counts.map((cnt) => `${num(cnt.n_two_prints)} of ${num(cnt.n)} at ${horizonLabel(cnt.horizon_months)}`))}` : "no horizon has that many yet"}.`,
    }));
  }

  function renderCase(box, c) {
    clear(box);
    const months = c.months || [];
    const tot = c.total || {};
    const usdUnit = c.unit === "usd_t";
    const unitLabel = usdUnit ? "USD a tonne" : c.unit === "ws_points" ? "Worldscale points" : c.unit;
    const money = (v) => (usdUnit ? signedUsdBig(v) : `${signed(v)} (${unitLabel} times tonnes)`);
    const amount = (v) => (usdUnit ? usdBig(Math.abs(v)) : `${num(Math.abs(v))} (${unitLabel} times tonnes)`);
    const role = c.role || "owner";
    const monthsText = listJoin(months.map((m) => monthLong(m.month)));
    const n = months.length;
    const cargoes = n === 1 ? `one cargo of ${tonnes(c.cargo_t)}` : `${numberWord(n)} cargoes of ${tonnes(c.cargo_t)}, ${tonnes(c.cargo_t * n)} in all`;
    // the quarter after the marks: a month without a dollar print is left out of the case
    const quarter = Array.from({ length: SHAPE.quarter }, (_, k) => add_months(c.as_of.slice(0, 7), k + 1));
    const missing = quarter.filter((mm) => !months.some((m) => m.month === mm));
    // every case settles on one to three public prints a month, so every settlement is approximate
    const approx = true;
    // months whose prints fall in weeks the study marks: tagged, and the case shown without them too
    const markedDates = (m) => m.prints_in_marked_weeks || [];
    const marked = Array.isArray(c.months_with_marked_prints) ? c.months_with_marked_prints : months.filter((m) => markedDates(m).length).map((m) => m.month);
    const without = marked.length && c.total_without_marked ? c.total_without_marked : null;
    const markedText = listJoin(marked.map((mm) => monthLong(mm)));
    const roleCls = role === "charterer" ? "charterer" : "owner";
    box.append(h("h3", { class: "section-title" }, `Hedged at the ${dateLong(c.as_of)} marks: ${monthsText}`));
    const report = (m) => (m.fixture_url ? h("a", { href: m.fixture_url }, `Breakwave report of ${dateLong(m.fixture_on)}`) : m.fixture_on ? `report of ${dateLong(m.fixture_on)}` : "no report");
    const line = (m) => h("p", { class: "small" },
      `${monthLong(m.month)}: marked at ${usdUnit ? usdT(m.f0, 3) : num(m.f0, 2)} on ${dateLong(c.as_of)}; the cargo fixed at ${usdUnit ? usdT(m.physical) : num(m.physical, 2)} (`, report(m), `); settlement estimate ${usdUnit ? usdT(m.settlement) : num(m.settlement, 2)}${m.single_print ? " from one print: settles at its own fixture" : isNum(m.prints) ? `, the average of ${plural(m.prints, "print", "prints")}` : ""}${markedDates(m).length ? `; priced in marked weeks (the prints of ${listJoin(markedDates(m).map((d) => dateLong(d)))})` : ""}.`);
    box.append(h("div", { class: "prose" },
      h("p", {}, `${role === "owner" ? "An owner" : "A charterer"} with one ${tonnes(c.cargo_t)} cargo to carry in each of ${monthsText} (${tonnes(c.cargo_t * n)} in all) ${role === "owner" ? "sells" : "buys"} each month's TD3C futures at the mark and fixes each cargo in its loading month.${missing.length ? ` ${listJoin(missing.map((mm) => monthLong(mm)))} ${missing.length === 1 ? "has" : "have"} no dollar print, so the case leaves ${missing.length === 1 ? "it" : "them"} out.` : ""} It locks ${amount(tot.locked_usd)} of gross freight; the cargoes came in ${money(tot.physical_vs_locked_usd)} against that and the paper ${money(tot.paper_usd)}, so the total was ${amount(tot.total_usd)}.`),
      ...months.map(line),
      without
        ? h("p", {}, `Without ${markedText}, priced in marked weeks, the case locks ${amount(without.locked_usd)} and ends at ${amount(without.total_usd)}, ${money(without.total_usd - without.locked_usd)} against what it locked.`)
        : null,
      c.mark_source || c.fixture_source || c.settlement_source
        ? h("p", { class: "small muted" }, [c.mark_source && `Marks: ${c.mark_source}.`, c.fixture_source && `Cargo: ${c.fixture_source}.`, c.settlement_source && `Settlement: ${c.settlement_source}.`].filter(Boolean).join(" "))
        : null,
      approx ? h("p", { class: "small muted" }, `Approximate settlement: each month's is the average of its TD3C prints in USD a tonne (${listJoin(months.map((m) => `${plural(m.prints, "print", "prints")} for ${monthLong(m.month)}`))}), not of every publication day.${months.some((m) => m.single_print) ? " A month with one print settles at its own fixture, so its cargo and paper cancel." : ""}`) : null));
    const steps = [
      { label: "Locked at the mark", value: tot.locked_usd, cls: "ink", kind: "start", outline: true },
      { label: "Cargo against the mark", value: tot.physical_vs_locked_usd, cls: "spot", kind: "delta" },
      { label: "Paper", value: tot.paper_usd, cls: "ffa", kind: "delta" },
      { label: "Total", value: tot.total_usd, cls: roleCls, kind: "total" },
      ...(without ? [{ label: `Total without ${markedText}`, value: without.total_usd, cls: roleCls, kind: "total", hatch: true }] : []),
    ].filter((st) => isNum(st.value)).map((st) => ({ ...st, valueLabel: compactMoney(st.value), tip: { title: st.label, rows: [{ key: st.cls, value: money(st.value), label: "" }], note: `${capitalise(cargoes)}, marks of ${dateLong(c.as_of)}` } }));
    const chartBox = h("div", { class: "case-chart" });
    box.append(chartBox);
    waterfallChart(chartBox, {
      level: 3,
      title: Math.abs((tot.total_usd ?? 0) - (tot.locked_usd ?? 0)) < 1
        ? `The paper offset the cargo's ${money(tot.physical_vs_locked_usd)} move: the ${role} kept the ${amount(tot.locked_usd)} it locked`
        : `The ${role} ended ${money((tot.total_usd ?? 0) - (tot.locked_usd ?? 0))} against the ${amount(tot.locked_usd)} it locked`,
      subtitle: `${usdUnit ? "USD of gross freight" : unitLabel} over ${cargoes}, one a month${approx ? "; approximate settlement" : ""}.`,
      legend: [
        { label: "Locked", cls: "ink", kind: "outline" },
        { label: "Cargo", cls: "spot", kind: "rect" },
        { label: "Paper", cls: "ffa", kind: "rect" },
        { label: `Total, ${role}`, cls: roleCls, kind: "rect" },
        ...(without ? [{ label: `Without ${markedText} (priced in marked weeks)`, cls: roleCls, kind: "hatch" }] : []),
      ],
      steps,
      x: { title: usdUnit ? "USD" : unitLabel, format: (v) => compactMoney(v) },
      summary: `Locked ${amount(tot.locked_usd)}; cargo against the mark ${money(tot.physical_vs_locked_usd)}; paper ${money(tot.paper_usd)}; total ${amount(tot.total_usd)}.${without ? ` Without ${markedText}, priced in marked weeks: locked ${amount(without.locked_usd)}, total ${amount(without.total_usd)}.` : ""}`,
      source: h("span", {}, "Source: ", c.mark_url ? h("a", { href: c.mark_url }, `BWET filing of ${dateLong(c.as_of)}`) : "BWET filing", ...months.flatMap((m) => ["; ", report(m)]), `. ${(() => {
        const sec = retrievedOf(manifest, "SEC");
        const bw = retrievedOf(manifest, "Breakwave");
        return sec === bw ? `All documents ${sec}.` : `Filing ${sec}; reports ${bw}.`;
      })()}`),
    });
    box.append(table({
      caption: `Case by month: one cargo of ${tonnes(c.cargo_t)} a month`,
      columns: [
        { label: "Month", format: (m) => (markedDates(m).length ? h("span", {}, tenorLabel(m.month), h("br"), h("span", { class: "muted" }, "priced in marked weeks")) : tenorLabel(m.month)) },
        { label: `Mark, ${unitLabel}`, num: true, format: (m) => num(m.f0, 3) },
        { label: `Settlement: Breakwave average, ${unitLabel}`, num: true, format: (m) => num(m.settlement, 2) },
        { label: "Total, USD", num: true, format: (m) => num(m.total_usd) },
        { label: "Paper, USD", num: true, format: (m) => signed(m.paper_usd) },
        { label: "Cargo against mark, USD", num: true, format: (m) => signed(m.physical_vs_locked_usd) },
        { label: `Cargo fixed, ${unitLabel}`, num: true, format: (m) => num(m.physical, 2) },
        { label: "Locked, USD", num: true, format: (m) => num(m.locked_usd) },
        { label: "Prints", format: (m) => `${isNum(m.prints) ? num(m.prints) : ""}${m.single_print ? " (one print: settles at its own fixture)" : ""}` },
      ],
      rows: months,
      note: `Settlement: the average of the month's TD3C prints in USD a tonne in Breakwave's reports. ${usdUnit ? "Amounts in USD of gross freight." : `Amounts in ${unitLabel} times tonnes.`}${missing.length ? ` ${listJoin(missing.map((mm) => monthLong(mm)))} ${missing.length === 1 ? "has" : "have"} no dollar print.` : ""}`,
    }));
  }

  // --------------------------------------------------------- disclosures
  const flat = td3c.flat_rate_test || {};
  const w = wire(ctx, "td3c", {
    panels,
    sections: [
      {
        id: "method",
        label: "Method",
        render(body) {
          body.append(defs([
            { term: "Weekly prints", desc: "TD3C and TD34 in Worldscale points and as round-trip TCE, read from the Baltic Exchange's own weekly tanker reports, each with its link." },
            { term: "Marked weeks", desc: "A week is marked when the Baltic's report says its Gulf assessment was theoretical, hypothetical or hard for its panellists, or that transits through the Strait of Hormuz were extremely limited or blocked; the reason and the report's sentence are kept with the week." },
            { term: "Worldscale and USD a tonne", desc: `USD a tonne = WS / ${num(engine?.constants?.PERCENT)} times the route's flat rate. Flat rates are licensed and never published; the study tests whether dated public pairs of WS and USD a tonne imply one consistent rate before converting.` },
            { term: "Flat-rate test", desc: flatRateText(flat) },
            { term: "Cases", desc: "A hedge at a quarter-end mark of BWET's TD3C futures for one cargo in each month of the following quarter that has a dollar print, sized to the cargo in tonnes and held to settlement; each cargo is fixed at the month's first TD3C print in USD a tonne in Breakwave's report, and the settlement is the average of that month's prints." },
            { term: "Two monthly averages", desc: "The monthly table in the Data section averages the Baltic's weekly Worldscale prints and stays in Worldscale; the cases and the forward errors settle on the average of Breakwave's prints in USD a tonne. Each column names its method." },
          ]));
        },
      },
      {
        id: "assumptions",
        label: "Assumptions",
        render(body) {
          body.append(defs([
            { term: "Role", desc: "The cases take an owner's side (short paper); a charterer's figures are the same with the opposite sign." },
            { term: "Cargo", desc: cargoText(cases) },
            { term: "Settlement", desc: `ICE's TDL settles on the average of every Baltic publication day of the month; with one to three public prints a month, the study's settlement is an estimate and labelled approximate. A month with one print settles at its own fixture. Statistics need ${td3c.statistics?.min_prints_for_residual ?? "two"} prints a month or more.` },
            { term: "Freight", desc: "TD3C amounts are gross freight: no address commission or brokerage is taken off." },
            { term: "Contracts", desc: `ICE TDL futures, ${num(engine?.constants?.TONNES_PER_LOT_TD3C)} t a lot in USD a tonne (contract specification in Method and data).` },
          ]));
        },
      },
      {
        id: "data",
        label: "Data",
        render(body) {
          renderHorizonStats(body);
          body.append(table({
            caption: "Weekly TD3C and TD34 prints",
            limit: 16,
            columns: [
              { label: "Week to", format: (r) => dateLong(r.week) },
              { label: "TD3C, WS", num: true, format: (r) => (r.source_typo ? `${num(r.ws_points_printed, 2)} (typo)` : num(r.ws_points, 2)) },
              { label: "TD3C TCE, USD a day", num: true, format: (r) => (r.source_typo ? `${num(r.tce_usd_day_printed)} (typo)` : num(r.tce_usd_day)) },
              { label: "TD34, WS", num: true, format: (r) => (isNum(r.td34_ws_points) ? num(r.td34_ws_points, 2) : "") },
              { label: "TD34 TCE, USD a day", num: true, format: (r) => (isNum(r.td34_tce_usd_day) ? num(r.td34_tce_usd_day) : "") },
              { label: "Marked week", format: (r) => (r.thin_market ? capitalise(REASONS[r.thin_reason] || "yes") : r.source_typo ? "Source typo: left out" : "") },
              { label: "Report", format: (r) => (r.url ? h("a", { href: r.url }, "Baltic") : "") },
            ],
            rows: weekly.slice().reverse(),
          }));
          const monthly = Object.entries(td3c.monthly || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
          body.append(table({
            caption: "Monthly averages of the weekly prints",
            limit: SHAPE.rows,
            columns: [
              { label: "Month", format: (r) => `${tenorLabel(r[0])}${r[1].month_to_date ? " (month to date)" : ""}` },
              { label: "TD3C, WS: weekly average", num: true, format: (r) => num(r[1].ws_points, 2) },
              { label: "Weeks", num: true, format: (r) => num(r[1].weeks) },
              { label: "Marked weeks", num: true, format: (r) => num(r[1].flagged_weeks) },
            ],
            rows: monthly,
            note: "WS: the average of the month's weekly Baltic prints, which approximates the TDL settlement (an average of every publication day). The table stays in Worldscale: a dollar figure beside it would state the route's flat rate, which is licensed.",
          }));
          const dollars = Object.entries(td3c.dollar_months || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
          if (dollars.length) {
            body.append(table({
              caption: "TD3C in USD a tonne by month, from Breakwave's reports",
              limit: SHAPE.rows,
              columns: [
                { label: "Month", format: (r) => `${tenorLabel(r[0])}${r[1].ended ? "" : " (month to date)"}` },
                { label: "First print, USD a tonne", num: true, format: (r) => num(r[1].fixture_usd_t, 2) },
                { label: "Settlement: Breakwave average, USD a tonne", num: true, format: (r) => (isNum(r[1].settlement_estimate_usd_t) ? num(r[1].settlement_estimate_usd_t, 2) : "month not over") },
                { label: "Prints", num: true, format: (r) => num(r[1].prints) },
                { label: "First report", format: (r) => (r[1].fixture_url ? h("a", { href: r[1].fixture_url }, dateLong(r[1].fixture_on)) : dateLong(r[1].fixture_on)) },
              ],
              rows: dollars,
              note: "The first print of a month is the cargo's freight in the case studies; the average of the month's prints is their settlement estimate.",
            }));
          }
          const stats = td3c.statistics?.rows || [];
          if (stats.length) {
            body.append(table({
              caption: "Forward errors at the quarter-end marks, USD a tonne (approximate)",
              limit: SHAPE.rows,
              columns: [
                { label: "Contract", format: (r) => tenorLabel(r.contract) },
                { label: "Settlement minus mark", num: true, format: (r) => signed(r.error, 2) },
                { label: "Mark", num: true, format: (r) => num(r.f0, 3) },
                { label: "Settlement: Breakwave average", num: true, format: (r) => num(r.settlement, 2) },
                { label: "Prints", num: true, format: (r) => (isNum(r.prints) ? num(r.prints) : "") },
                { label: "Marked on", format: (r) => dateLong(r.as_of) },
                { label: "Months ahead", num: true, format: (r) => num(r.horizon_months) },
              ],
              rows: stats,
            }));
          }
          const marks = (td3c.strips || []).flatMap((st) => st.months.map((mm) => ({ ...mm, as_of: st.as_of }))).sort((a, b) => (a.as_of === b.as_of ? (a.month < b.month ? -1 : 1) : a.as_of < b.as_of ? 1 : -1));
          if (marks.length) {
            body.append(table({
              caption: `BWET's TD3C futures at each quarter end, USD a tonne (all ${marks.length} marks)`,
              limit: SHAPE.rows,
              columns: [
                { label: "Marked on", format: (r) => dateLong(r.as_of) },
                { label: "Contract", format: (r) => tenorLabel(r.month) },
                { label: "Mark", num: true, format: (r) => num(r.usd_t, 3) },
                { label: "Contracts held", num: true, format: (r) => num(r.contracts) },
                { label: "Filing", format: (r) => (r.url ? h("a", { href: r.url }, "SEC filing") : "") },
              ],
              rows: marks,
              note: "Mark = the filing's notional value over (contracts times the lot size), for each TD3C month BWET held.",
            }));
          }
          const bw = td3c.breakwave || [];
          if (bw.length) {
            body.append(table({
              caption: "Breakwave's tanker reports: TD3C spot and the Tanker Futures Index",
              limit: SHAPE.rows,
              columns: [
                { label: "Report", format: (b) => dateLong(b.date) },
                { label: "TD3C, USD a tonne", num: true, format: (b) => num(b.td3c_usd_t, 2) },
                { label: "Futures index, points", num: true, format: (b) => num(b.btfi_points) },
                { label: "Link", format: (b) => h("a", { href: b.url }, "Report (PDF)") },
              ],
              rows: bw.slice().reverse(),
            }));
          }
          body.append(downloadLine([{ file: "td3c_weekly_prints.csv" }, { file: "sec_freight_futures_marks.csv" }]));
        },
      },
    ],
  });
  if (w.panelsEl) section.append(w.panelsEl);
  section.append(w.disclosuresEl);
  return {
    update(params) {
      w.update(params);
      const want = `${params.unit === "tce" ? "tce" : "ws"}/${params.range === "all" ? "all" : "year"}`;
      if (weekly.length && drawn && want !== drawn) drawWeekly();
      if (showCase) showCase(params.case);
    },
    state: w.state,
  };
}

/** The flat-rate test in date order: pairs, dispersion against the tolerance. */
function flatRateText(flat) {
  const entries = Object.entries(flat || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (!entries.length) return "Not in this build.";
  const parts = entries.map(([k, v], i) => {
    const few = isNum(v.min_pairs) && v.n < v.min_pairs;
    const disp = isNum(v.dispersion) ? `, dispersion ${pct(v.dispersion)}` : "";
    const verdict = few ? `fewer than the ${num(v.min_pairs)} pairs needed` : isNum(v.dispersion) && isNum(v.tolerance) ? `${v.dispersion <= v.tolerance ? "within" : "above"} the ${pct(v.tolerance, 0)} tolerance` : v.consistent ? "consistent" : "not consistent";
    // lower case after a semicolon: only the first period starts the sentence
    return `${i ? periodLabel(k) : capitalise(periodLabel(k))}: ${plural(v.n, "pair", "pairs")}${disp}, ${verdict}`;
  });
  const ok = entries.filter(([, v]) => v.consistent).map(([k]) => periodLabel(k));
  return `Dated pairs of WS and USD a tonne imply a flat rate each; the test asks whether a period's rates agree within the tolerance. ${parts.join("; ")}. ${ok.length ? `Only ${listJoin(ok)} ${ok.length === 1 ? "passes" : "pass"}.` : "No period passes."} The site keeps the Baltic's weekly prints in Worldscale either way: a dollar figure beside a Worldscale average would state the flat rate, which is licensed. Dollar figures come only from prints published in USD a tonne (Breakwave's reports).`;
}

/** "One cargo of 270,000 t a month: 810,000 t over three months, 540,000 t in the case of 30 June 2026." */
function cargoText(cases) {
  if (!cases || !cases.length || !isNum(cases[0].cargo_t)) return "The route's cargo, one a month.";
  const t = cases[0].cargo_t;
  const full = cases.filter((c) => (c.months || []).length === SHAPE.quarter);
  const short = cases.filter((c) => (c.months || []).length !== SHAPE.quarter);
  const bits = [];
  if (full.length) bits.push(`${tonnes(t * SHAPE.quarter)} over three months`);
  for (const c of short) bits.push(`${tonnes(t * (c.months || []).length)} in the case of ${dateLong(c.as_of)}, whose quarter has ${plural((c.months || []).length, "month", "months")} with a dollar print`);
  return `One cargo of ${tonnes(t)} a month, the route's cargo: ${listJoin(bits)}.`;
}

export default {
  id: "td3c",
  name: "TD3C 2026",
  needs: ["td3c", "engine", "manifest"],
  render,
};
