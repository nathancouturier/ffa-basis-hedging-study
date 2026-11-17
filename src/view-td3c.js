// view-td3c.js: TD3C through the 2026 Strait of Hormuz closure. Weekly TD3C and TD34 prints with the
// weeks the Baltic's panel found hard to assess, the forward marks against later spot prints, and the
// case studies as a step-through with a waterfall each.

import { h, clear, takeaway, table, note, defs, segmented } from "./dom.js";
import { lineChart, waterfallChart, monthMid, dayMs, empty } from "./charts.js";
import { num, signed, usdDay, usdT, ws, usdBig, signedUsdBig, compactMoney, dateLong, dateShort, monthLong, tenorLabel, plural, listJoin, isNum, tonnes, addDays } from "./format.js";
import { wire, retrievedTo, csvLink, stripSummary } from "./view-kit.js";

const SHAPE = Object.freeze({
  weekDays: 6, // a week's shade runs back six days from the report's date
  pointsPerUnit: 1,
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
  const weeklySource = `Source: Baltic Exchange weekly tanker reports (links in the Data section). ${retrieved}`;

  // ---------------------------------------------------------- takeaway
  let sentence = "The TD3C weekly prints are not in this build of the data.";
  if (peak) {
    sentence = before
      ? `TD3C went from ${ws(before.ws_points)} in the last week before the Strait of Hormuz closed to ${ws(peak.ws_points)}, ${usdDay(peak.tce_usd_day)} round trip, in the week to ${dateLong(peak.week)}${thin.length ? `; the Baltic's panel reported difficulty assessing the Gulf in ${plural(thin.length, "week", "weeks")}` : ""}.`
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
  } else empty(key, { title: "Weekly TD3C", text: "td3c.json carries no weekly prints in this build." });

  function drawWeekly() {
    clear(chartBox);
    const unit = ctx.params.unit === "tce" ? "tce" : "ws";
    const range = RANGES.find((r) => r.value === (ctx.params.range === "all" ? "all" : "year"));
    const rows = weekly.filter((w) => w.week >= range.from);
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
      if (w.thin_market) noteText = `Marked thin market. The Baltic: "${w.note}"`;
      else if (w.note) noteText = `The Baltic: "${w.note}"`;
      return { title: `Week to ${dateLong(w.week)} (${w.assessed_day || "report"})`, rows: rowsT, note: noteText };
    };
    const series = [
      { cls: "spot", dots: false, points: rows.map((w) => ({ x: dayMs(w.week), y: v3(w), tip: tip(w) })), endLabel: "TD3C" },
    ];
    series.push({ cls: "spot", line: false, dots: true, hollow: true, points: rows.filter((w) => w.thin_market).map((w) => ({ x: dayMs(w.week), y: v3(w) })) });
    if (td34.length) series.push({ cls: "route", points: rows.map((w) => ({ x: dayMs(w.week), y: isNum(v34(w)) ? v34(w) : NaN })), endLabel: "TD34" });
    const shades = rows.filter((w) => w.thin_market).map((w) => ({ x0: dayMs(addDays(w.week, -SHAPE.weekDays)), x1: dayMs(w.week) }));
    const vlines = events.filter((e) => e.date >= range.from).map((e, i) => ({ x: dayMs(e.date), label: String(events.indexOf(e) + 1), row: i % 2 }));
    const pk = rows.reduce((a, b) => (v3(b) > v3(a) ? b : a));
    const td34pk = td34.length ? td34.reduce((a, b) => (v34(b) > v34(a) ? b : a)) : null;
    const title = `TD3C peaked at ${fmt(v3(pk))} in the week to ${dateLong(pk.week)}${td34pk ? `; TD34, assessed from ${dateLong(td34[0].week)}, peaked at ${fmt(v34(td34pk))} on ${dateShort(td34pk.week)}` : ""}`;
    const legend = [
      { label: "TD3C, Ras Tanura to Ningbo", cls: "spot", kind: "line" },
    ];
    if (td34.length) legend.push({ label: "TD34, Mina Al Fahal to Ningbo (trial route)", cls: "route", kind: "line" });
    if (thin.length) legend.push({ label: "Week the Baltic's panel found hard to assess (thin market)", cls: "spot", kind: "hatch" });
    const yearly = rows.length ? `${dateLong(rows[0].week)} to ${dateLong(rows[rows.length - 1].week)}` : "";
    lineChart(chartBox, {
      title,
      subtitle: `${unit === "tce" ? "Round-trip time charter equivalent, USD a day" : "Worldscale points"}, weekly, as the Baltic Exchange reported them. Numbered lines are the events listed under the chart.`,
      legend,
      x: { type: "time" },
      y: { title: unit === "tce" ? "USD a day" : "Worldscale points", includeZero: true },
      series,
      shades,
      vlines,
      mode: "x",
      targets: ({ x, y }) => rows.map((w) => ({ x: x(dayMs(w.week)), y: y(v3(w)), tip: tip(w) })),
      summary: `Weekly TD3C ${unit === "tce" ? "TCE" : "Worldscale"} from ${yearly}: low ${fmt(Math.min(...rows.map(v3)))}, high ${fmt(v3(pk))} (week to ${dateLong(pk.week)}), last ${fmt(v3(rows[rows.length - 1]))} (week to ${dateLong(rows[rows.length - 1].week)}).${td34pk ? ` TD34 from ${dateLong(td34[0].week)}: high ${fmt(v34(td34pk))}, last ${fmt(v34(td34[td34.length - 1]))}.` : ""}${thin.length ? ` Thin-market weeks: ${listJoin(thin.map((w) => dateShort(w.week)))}.` : ""}`,
      source: weeklySource,
    });
    clear(eventsBox);
    if (events.length) {
      const ol = h("ol", { class: "small" });
      events.forEach((e) => ol.append(h("li", {}, `${dateLong(e.date)}: ${e.text} (`, e.url ? h("a", { href: e.url }, e.source) : e.source, ").")));
      eventsBox.append(h("div", { class: "prose" }, ol));
    }
    if (thin.length) {
      const noted = weekly.filter((w) => w.note && !w.thin_market);
      eventsBox.append(note(h("strong", {}, "How the closure weeks were assessed. "), `The study marks a week as thin market when the Baltic's own weekly report says its panel had difficulty assessing the routes from the region (${listJoin(thin.map((w) => dateShort(w.week)))}).${noted.length ? ` Weeks with a Baltic note but no reported difficulty (${listJoin(noted.map((w) => dateShort(w.week)))}) are not marked.` : ""} Every note is in the tooltips and the Data section.`));
    }
  }
  if (weekly.length) drawWeekly();

  // -------------------------------------------------------------- panels
  const cases = Array.isArray(td3c.cases) ? td3c.cases : null;
  const panels = [
    {
      id: "marks",
      label: "Forward marks",
      render(body) {
        const strips = td3c.strips || [];
        const bw = td3c.breakwave || [];
        if (!strips.length && !bw.length) {
          empty(body, { title: "Forward marks", text: "td3c.json carries no strips or Breakwave prints in this build." });
          return;
        }
        const statement = td3c.breakwave_statement;
        const stats = td3c.statistics?.rows || [];
        let title = "BWET's quarter-end TD3C marks against Breakwave's spot prints, USD a tonne";
        if (stats.length) {
          const below = stats.filter((r) => r.physical > r.f0).length;
          const widest = stats.reduce((x, y) => (Math.abs(y.physical - y.f0) > Math.abs(x.physical - x.f0) ? y : x));
          title = `The marks sat below the spot that followed in ${below === stats.length ? `all ${stats.length}` : `${below} of ${stats.length}`} months with a later print; widest, ${monthLong(widest.contract)}: marked at ${usdT(widest.f0)} on ${dateShort(widest.as_of)}, spot ${usdT(widest.physical)}`;
        }
        const series = strips.map((st) => ({
          cls: "ffa",
          dots: true,
          points: st.months.map((mm) => ({ x: monthMid(mm.month), y: mm.usd_t, tip: { title: `${monthLong(mm.month)} contract, marked ${dateLong(st.as_of)}`, rows: [{ key: "ffa", value: usdT(mm.usd_t, 3), label: "" }, { key: null, value: num(mm.contracts), label: "contracts held by BWET" }] } })),
        }));
        series.push({ cls: "spot", line: false, dots: true, r: 5, points: bw.filter((b) => isNum(b.td3c_usd_t)).map((b) => ({ x: dayMs(b.date), y: b.td3c_usd_t, tip: { title: `Breakwave tanker report, ${dateLong(b.date)}`, rows: [{ key: "spot", value: usdT(b.td3c_usd_t), label: "TD3C spot" }, { key: null, value: num(b.btfi_points), label: "Breakwave Tanker Futures Index, points" }] } })) });
        const vlines = statement ? [{ x: dayMs(statement.date), label: `Breakwave, ${dateShort(statement.date)}` }] : [];
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
          source: "Source: Amplify Commodity Trust 10-Q and 10-K filings (SEC EDGAR); Breakwave Advisors tanker reports (via Hellenic Shipping News).",
        });
        if (statement) {
          body.append(h("blockquote", { class: "note" }, `"${statement.text}" `, h("a", { href: statement.url }, `Breakwave Advisors, ${dateLong(statement.date)}`), "."));
        }
        if (bw.length) {
          body.append(table({
            caption: "Breakwave's tanker reports: TD3C spot and the Tanker Futures Index",
            columns: [
              { label: "Report", format: (b) => dateShort(b.date) },
              { label: "TD3C, USD a tonne", num: true, format: (b) => num(b.td3c_usd_t, 2) },
              { label: "Futures index, points", num: true, format: (b) => num(b.btfi_points) },
              { label: "Link", format: (b) => h("a", { href: b.url }, "Report (PDF)") },
            ],
            rows: bw,
          }));
        }
      },
    },
    {
      id: "cases",
      label: "Case studies",
      render(body) {
        if (!cases || !cases.length) {
          empty(body, { title: "Case studies", text: "No case data in this build: td3c.json carries no cases yet." });
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
      },
    },
  ];

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
    const approx = months.some((m) => isNum(m.prints) && m.prints < 2);
    box.append(h("h3", { class: "section-title" }, `Hedged at the ${dateLong(c.as_of)} marks: ${monthsText}`));
    const lines = months.map((m) => `${monthLong(m.month)}: marked at ${usdUnit ? usdT(m.f0, 3) : num(m.f0, 2)} on ${dateShort(c.as_of)}; the cargo fixed at ${usdUnit ? usdT(m.physical) : num(m.physical, 2)}${m.fixture_on ? ` (${dateShort(m.fixture_on)})` : ""}; settlement estimate ${usdUnit ? usdT(m.settlement) : num(m.settlement, 2)}${isNum(m.prints) ? ` from ${plural(m.prints, "print", "prints")}` : ""}.`);
    box.append(h("div", { class: "prose" },
      h("p", {}, `${role === "owner" ? "An owner" : "A charterer"} with ${tonnes(c.cargo_t)} to carry ${role === "owner" ? "sells" : "buys"} the month's TD3C futures at the mark and fixes the cargo in the loading month. It locks ${amount(tot.locked_usd)}; the cargo came in ${money(tot.physical_vs_locked_usd)} against that and the paper ${money(tot.paper_usd)}, so the total was ${amount(tot.total_usd)}.`),
      ...lines.map((t) => h("p", { class: "small" }, t)),
      approx ? h("p", { class: "small muted" }, "Approximate: the month's settlement is estimated from the TD3C prints in USD a tonne available for it, here a single Breakwave report, because Worldscale prints cannot be turned into USD a tonne without a consistent flat rate.") : null));
    const steps = [
      { label: "Locked at the mark", value: tot.locked_usd, cls: "ink", kind: "start", outline: true },
      { label: "Cargo against the mark", value: tot.physical_vs_locked_usd, cls: "spot", kind: "delta" },
      { label: "Paper", value: tot.paper_usd, cls: "ffa", kind: "delta" },
      { label: "Total", value: tot.total_usd, cls: role === "charterer" ? "charterer" : "owner", kind: "total" },
    ].filter((st) => isNum(st.value)).map((st) => ({ ...st, valueLabel: compactMoney(st.value), tip: { title: st.label, rows: [{ key: st.cls, value: money(st.value), label: "" }], note: `${tonnes(c.cargo_t)}, marks of ${dateShort(c.as_of)}` } }));
    const chartBox = h("div", { class: "case-chart" });
    box.append(chartBox);
    waterfallChart(chartBox, {
      level: 3,
      title: Math.abs((tot.total_usd ?? 0) - (tot.locked_usd ?? 0)) < 1
        ? `The paper offset the cargo's ${money(tot.physical_vs_locked_usd)} move: the ${role} kept the ${amount(tot.locked_usd)} it locked`
        : `The ${role} ended ${money((tot.total_usd ?? 0) - (tot.locked_usd ?? 0))} against the ${amount(tot.locked_usd)} it locked`,
      subtitle: `${usdUnit ? "USD" : unitLabel} over the cargo of ${tonnes(c.cargo_t)}${approx ? "; approximate settlement" : ""}.`,
      legend: [
        { label: "Locked", cls: "ink", kind: "outline" },
        { label: "Cargo", cls: "spot", kind: "rect" },
        { label: "Paper", cls: "ffa", kind: "rect" },
        { label: `Total, ${role}`, cls: role === "charterer" ? "charterer" : "owner", kind: "rect" },
      ],
      steps,
      x: { title: usdUnit ? "USD" : unitLabel, format: (v) => compactMoney(v) },
      summary: `Locked ${amount(tot.locked_usd)}; cargo against the mark ${money(tot.physical_vs_locked_usd)}; paper ${money(tot.paper_usd)}; total ${amount(tot.total_usd)}.`,
      source: h("span", {}, "Source: ", c.mark_url ? h("a", { href: c.mark_url }, `BWET filing of ${dateLong(c.as_of)}`) : "BWET filing", months[0]?.fixture_url ? h("span", {}, "; ", h("a", { href: months[0].fixture_url }, `Breakwave report of ${dateLong(months[0].fixture_on)}`)) : null, "; the study's td3c_outcome."),
    });
    box.append(table({
      caption: "Case by month",
      columns: [
        { label: "Month", format: (m) => tenorLabel(m.month) },
        { label: `Mark, ${unitLabel}`, num: true, format: (m) => num(m.f0, 3) },
        { label: `Cargo fixed, ${unitLabel}`, num: true, format: (m) => num(m.physical, 2) },
        { label: `Settlement estimate, ${unitLabel}`, num: true, format: (m) => num(m.settlement, 2) },
        { label: "Prints", num: true, format: (m) => (isNum(m.prints) ? num(m.prints) : "") },
        { label: "Locked", num: true, format: (m) => num(m.locked_usd) },
        { label: "Cargo against mark", num: true, format: (m) => signed(m.physical_vs_locked_usd) },
        { label: "Paper", num: true, format: (m) => signed(m.paper_usd) },
        { label: "Total", num: true, format: (m) => num(m.total_usd) },
      ],
      rows: months,
      note: usdUnit ? "Amounts in USD." : `Amounts in ${unitLabel} times tonnes.`,
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
            { term: "Thin-market weeks", desc: "A pre-registered rule marks a week when the Baltic's report says its panel had difficulty assessing the routes from the region; the report's sentence is kept with the week." },
            { term: "Worldscale and USD a tonne", desc: `USD a tonne = WS / ${num(engine?.constants?.PERCENT)} times the route's flat rate. Flat rates are licensed and never published; the study tests whether dated public pairs of WS and USD a tonne imply one consistent rate before converting.` },
            { term: "Flat-rate test", desc: Object.keys(flat).length ? Object.entries(flat).map(([k, v]) => `${k}: ${plural(v.n, "dated pair", "dated pairs")}, ${v.consistent ? "consistent" : "not enough to establish a consistent rate"}`).join("; ") + ". Without one, TD3C stays in Worldscale here." : "Not in this build." },
            { term: "Cases", desc: "A hedge at a quarter-end mark of BWET's TD3C futures, sized to the cargo in tonnes and held to settlement; the physical fixture is TD3C in USD a tonne in the loading month from Breakwave's report, the settlement an estimate from the USD a tonne prints of that month." },
          ]));
        },
      },
      {
        id: "assumptions",
        label: "Assumptions",
        render(body) {
          body.append(defs([
            { term: "Role", desc: "The cases take an owner's side (short paper); a charterer's figures are the same with the opposite sign." },
            { term: "Cargo", desc: cases?.[0]?.cargo_t ? `${tonnes(cases[0].cargo_t)}, the route's cargo.` : "The route's cargo." },
            { term: "Settlement", desc: "ICE's TDL settles on the average of every Baltic publication day of the month; with one or two public prints a month, the study's settlement is an estimate and labelled approximate." },
            { term: "Contracts", desc: `ICE TDL futures, ${num(engine?.constants?.TONNES_PER_LOT_TD3C)} t a lot in USD a tonne (contract specification in Method and data).` },
          ]));
        },
      },
      {
        id: "data",
        label: "Data",
        render(body) {
          body.append(table({
            caption: "Weekly TD3C and TD34 prints",
            limit: 16,
            columns: [
              { label: "Week to", format: (r) => dateShort(r.week) },
              { label: "TD3C, WS", num: true, format: (r) => num(r.ws_points, 2) },
              { label: "TD3C TCE, USD a day", num: true, format: (r) => num(r.tce_usd_day) },
              { label: "TD34, WS", num: true, format: (r) => (isNum(r.td34_ws_points) ? num(r.td34_ws_points, 2) : "") },
              { label: "TD34 TCE, USD a day", num: true, format: (r) => (isNum(r.td34_tce_usd_day) ? num(r.td34_tce_usd_day) : "") },
              { label: "Thin market", format: (r) => (r.thin_market ? "Yes" : "") },
              { label: "Report", format: (r) => (r.url ? h("a", { href: r.url }, "Baltic") : "") },
            ],
            rows: weekly.slice().reverse(),
          }));
          const monthly = Object.entries(td3c.monthly || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
          body.append(table({
            caption: "Monthly averages of the weekly prints (approximate settlements)",
            limit: 16,
            columns: [
              { label: "Month", format: (r) => tenorLabel(r[0]) },
              { label: "TD3C, WS", num: true, format: (r) => num(r[1].ws_points, 2) },
              { label: "USD a tonne", num: true, format: (r) => (isNum(r[1].usd_t) ? num(r[1].usd_t, 3) : "not converted") },
              { label: "Weeks", num: true, format: (r) => num(r[1].weeks) },
              { label: "Thin-market weeks", num: true, format: (r) => num(r[1].flagged_weeks) },
            ],
            rows: monthly,
            note: "An average of weekly prints approximates the TDL settlement, which averages every publication day.",
          }));
          const stats = td3c.statistics?.rows || [];
          if (stats.length) {
            body.append(table({
              caption: "Forward errors at the quarter-end marks (approximate)",
              columns: [
                { label: "Contract", format: (r) => tenorLabel(r.contract) },
                { label: "Marked on", format: (r) => dateShort(r.as_of) },
                { label: "Months ahead", num: true, format: (r) => num(r.horizon_months) },
                { label: "Mark, USD a tonne", num: true, format: (r) => num(r.f0, 3) },
                { label: "Settlement estimate", num: true, format: (r) => num(r.settlement, 2) },
                { label: "Settlement minus mark", num: true, format: (r) => signed(r.error, 2) },
              ],
              rows: stats,
              note: (td3c.statistics?.by_horizon || []).length ? null : "Too few contract months with a mark and a settlement estimate for statistics by horizon.",
            }));
          }
          body.append(h("p", {}, "Download: ", csvLink("td3c_weekly_prints.csv"), ", ", csvLink("sec_freight_futures_marks.csv"), "."));
        },
      },
    ],
  });
  if (w.panelsEl) section.append(w.panelsEl);
  section.append(w.disclosuresEl);
  return { update: w.update };
}

export default {
  id: "td3c",
  name: "TD3C 2026",
  needs: ["td3c", "engine", "manifest"],
  render,
};
