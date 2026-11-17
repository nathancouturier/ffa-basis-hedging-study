// view-curve.js: spot against the curve. Cited dated curves against the same day's spot, contango and
// backwardation week by week, by year and calendar month (the first-quarter discount), slope against the
// spot level, and TD3C's quarter-end strips from SEC filings.

import { h, takeaway, table, note, defs, segmented, clear } from "./dom.js";
import { lineChart, calendarChart, barChart, monthMid, monthStart, monthEnd, dayMs, empty } from "./charts.js";
import { pct, shareOf, usdDay, num, signed, signedPct, signedPoints, dateLong, dateShort, tenorLabel, monthName, monthAbbr, monthLong, plural, listJoin, isNum, capitalise, usdT, monthShort } from "./format.js";
import { quarter_months } from "./engine.js";
import { wire, sourceLine, basketForWindow, csvLink, stripSummary } from "./view-kit.js";

const RULES = Object.freeze({
  minYearN: 10, // a year needs this many curves to be named in a title
  minMonthN: 5, // a calendar month needs this many curves to be named in a title
  thousand: 1000, // literal: unit, spot bins are labelled in USD thousand a day
  mostly: 0.8, // a month's front spread "mostly" in one shape from this share up
});

function describe(measure, state) {
  const word = state === "contango" ? "above" : "below";
  return measure === "front_spread" ? `next month ${word} the front month` : `front month ${word} the same day's spot`;
}

function yearTitle(byYear) {
  const named = Object.entries(byYear).filter(([, v]) => v.n >= RULES.minYearN);
  if (named.length < 2) return "Contango and backwardation by year";
  const lo = named.reduce((a, b) => (b[1].contango < a[1].contango ? b : a));
  const hi = named.reduce((a, b) => (b[1].contango > a[1].contango ? b : a));
  return `By year, contango ran from ${shareOf(lo[1].contango, lo[1].n)} of weeks (${lo[0]}) to ${shareOf(hi[1].contango, hi[1].n)} (${hi[0]}), in years with at least ${RULES.minYearN} curves`;
}

const MEASURES = [
  { value: "front_vs_spot", label: "Front month against spot", short: "front month above the same day's spot" },
  { value: "front_spread", label: "Front month against the next month", short: "next month above the front month" },
];

function measureOf(params) {
  return MEASURES.find((m) => m.value === params.measure) || MEASURES[0];
}

function defaultCurve(curves) {
  const withSpot = curves.filter((c) => isNum(c.spot_usd_day));
  return (withSpot.length ? withSpot : curves).slice().sort((a, b) => (a.date < b.date ? -1 : 1)).pop();
}

function tenorText(t) {
  if (t.kind === "quarter") {
    const ms = quarter_months(t.period);
    return `${t.label} (${monthAbbr(Number(ms[0].slice(5)))} to ${monthAbbr(Number(ms[2].slice(5)))} ${ms[0].slice(0, 4)})`;
  }
  return t.label || tenorLabel(t.period);
}

function vsSpot(v, spot) {
  if (!isNum(spot)) return null;
  const d = v - spot;
  return `${usdDay(Math.abs(d))} ${d >= 0 ? "above" : "below"} spot (${signedPct(d / spot)})`;
}

function curveChart(box, curve, opts) {
  clear(box);
  const spot = curve.spot_usd_day;
  const months = curve.tenors.filter((t) => t.kind === "month");
  const quarters = curve.tenors.filter((t) => t.kind === "quarter");
  const reprint = (curve.reprints || [])[0];
  const series = [];
  series.push({
    cls: "ffa",
    animate: true,
    dots: true,
    points: months.map((t) => ({
      x: monthMid(t.period),
      y: t.usd_day,
      tip: { title: `${tenorText(t)}, first print`, rows: [{ key: "ffa", value: usdDay(t.usd_day), label: "" }, ...(isNum(spot) ? [{ key: "spot", value: vsSpot(t.usd_day, spot), label: "" }] : [])], note: `${curve.issue}, page ${curve.page}` },
    })),
  });
  const spans = quarters.map((t) => {
    const ms = quarter_months(t.period);
    return {
      x0: monthStart(ms[0]),
      x1: monthEnd(ms[2]),
      y: t.usd_day,
      cls: "ffa",
      tip: { title: `${tenorText(t)}, first print`, rows: [{ key: "ffa", value: usdDay(t.usd_day), label: "quarter average" }, ...(isNum(spot) ? [{ key: "spot", value: vsSpot(t.usd_day, spot), label: "" }] : [])], note: `${curve.issue}, page ${curve.page}` },
    };
  });
  if (reprint) {
    const first = Object.fromEntries(curve.tenors.map((t) => [t.period, t.usd_day]));
    const pts = [];
    for (const [period, v] of Object.entries(reprint.tenors)) {
      const label = tenorLabel(period);
      const firstV = first[period];
      const tip = { title: `${label}, second print (${reprint.issue})`, rows: [{ key: "ffa", value: usdDay(v), label: "" }, ...(isNum(firstV) ? [{ key: null, value: `${signedPct((v - firstV) / firstV)}`, label: `against the first print (${num(firstV)})` }] : [])] };
      if (period.includes("-Q")) {
        const ms = quarter_months(period);
        spans.push({ x0: monthStart(ms[0]), x1: monthEnd(ms[2]), y: v, cls: "ffa", hollow: true, tip });
      } else pts.push({ x: monthMid(period), y: v, tip });
    }
    series.push({ cls: "ffa", thin: true, dots: true, hollow: true, points: pts });
  }
  const refs = [];
  const xs = [...curve.tenors.map((t) => (t.kind === "quarter" ? monthEnd(quarter_months(t.period)[2]) : monthEnd(t.period))), ...curve.tenors.map((t) => (t.kind === "quarter" ? monthStart(quarter_months(t.period)[0]) : monthStart(t.period)))];
  if (isNum(spot) && curve.spot_on) {
    refs.push({ y: spot, label: `Spot ${num(spot)}, ${dateShort(curve.spot_on)}`, cls: "spot" });
    xs.push(dayMs(curve.spot_on));
    series.push({ cls: "spot", line: false, dots: true, points: [{ x: dayMs(curve.spot_on), y: spot, tip: { title: `Baltic 5TC spot, ${dateLong(curve.spot_on)}`, rows: [{ key: "spot", value: usdDay(spot), label: "" }], note: `${num(curve.basket_t)} t basket; ${curve.basket_how}` } }] });
  }
  const all = curve.tenors.map((t) => t.usd_day);
  const above = isNum(spot) ? all.filter((v) => v > spot).length : null;
  const front = months[0];
  let title;
  if (isNum(spot) && front) {
    title = `${dateLong(curve.date)}: ${above} of ${all.length} tenors sat above the spot of ${usdDay(spot)}; the front month (${front.label}) ${front.usd_day >= spot ? "above" : "below"} it by ${usdDay(Math.abs(front.usd_day - spot))}`;
  } else {
    const hi = curve.tenors.reduce((a, b) => (b.usd_day > a.usd_day ? b : a));
    const lo = curve.tenors.reduce((a, b) => (b.usd_day < a.usd_day ? b : a));
    title = `${dateLong(curve.date)}: the curve ran from ${usdDay(hi.usd_day)} (${hi.label}) down to ${usdDay(lo.usd_day)} (${lo.label}); no same-day spot is cited with it`;
  }
  const legend = [
    { label: reprint ? "Months, first print (the study uses it)" : "Month tenors", cls: "ffa", kind: "linedot" },
    { label: "Quarter tenors, drawn across their three months", cls: "ffa", kind: "span" },
  ];
  if (reprint) legend.push({ label: `Second print, ${reprint.issue}'s previous-week column`, cls: "ffa", kind: "hollow" });
  if (isNum(spot)) legend.push({ label: "Baltic 5TC spot on the cited day", cls: "spot", kind: "thin" });
  const parts = curve.tenors.map((t) => `${t.label} ${num(t.usd_day)}${isNum(spot) ? ` (${signed(t.usd_day - spot)})` : ""}`);
  const summary = `FFA tenors on ${dateLong(curve.date)}, USD a day${isNum(spot) ? `, with their distance from the spot of ${num(spot)} on ${dateLong(curve.spot_on)}` : ""}: ${parts.join(", ")}.`;
  const src = h("span", {}, `Source: ${curve.source}, page ${curve.page}. `, h("a", { href: curve.url }, "Report (PDF)"), reprint ? h("span", {}, " and ", h("a", { href: reprint.url }, `${reprint.issue} (PDF)`)) : null, `. Levels shown only on cited dates, as the data policy allows.`);
  return lineChart(box, {
    title,
    subtitle: `USD a day, ${num(curve.basket_t)} t basket (${curve.basket_how}). Banchero Costa's Monday assessment, cited with issue and page.`,
    legend,
    x: { type: "time", min: Math.min(...xs), max: Math.max(...xs) },
    y: { title: "USD a day" },
    series,
    spans,
    refs,
    summary,
    source: src,
    footer: opts.footer,
  });
}

function render(section, ctx) {
  const { curve, engine } = ctx.data;
  const shares = curve.shares || {};
  const fvs = shares.front_vs_spot?.all;
  const q1 = curve.q1_discount;
  const curves = (curve.cited_curves || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));

  // ---------------------------------------------------------- takeaway
  let sentence = "The curve's shape is not in this build of the data.";
  if (fvs) {
    sentence = `The front month sat above the same day's spot in ${shareOf(fvs.contango, fvs.n)} of ${plural(fvs.n, "weekly curve", "weekly curves")}`;
    if (q1 && isNum(q1.n) && q1.n > 0) {
      const all = q1.share_below === 1;
      sentence += `, and the next year's first quarter priced below the fourth quarter before it in ${all ? `all ${q1.n}` : `${shareOf(q1.share_below, q1.n)} of ${q1.n}`} curves that printed both, ${pct(Math.abs(q1.mean_pct))} ${q1.mean_pct < 0 ? "lower" : "higher"} on average.`;
    } else sentence += ".";
  }
  section.append(takeaway("Curve", sentence));

  // ---------------------------------------------------------- key chart
  const key = h("div");
  section.append(key);
  const chartBox = h("div");
  const noteBox = h("div");
  let selected = curves.find((c) => c.date === ctx.params.date) || defaultCurve(curves);
  const latest = curves[curves.length - 1];
  if (curves.length) {
    const seg = segmented({
      legend: "Cited curve",
      name: "curve-date",
      value: selected.date,
      options: curves.map((c) => ({ value: c.date, label: `${dateShort(c.date)}${(c.reprints || []).length ? ", two prints" : ""}${c === latest ? ", latest" : ""}` })),
      onChange: (v) => {
        selected = curves.find((c) => c.date === v);
        ctx.setParams({ date: v });
        drawCurve();
      },
    });
    key.append(h("div", { class: "controls" }, seg.el), chartBox, noteBox);
  } else empty(key, { title: "No cited curve in this build", text: "curve.json carries no cited_curves." });

  function drawCurve() {
    clear(noteBox);
    const flags = selected.flags || [];
    const notes = [];
    const reprints = flags.filter((f) => f.rule === "reprint");
    if ((selected.reprints || []).length) {
      notes.push(`This curve was printed twice: ${listJoin(reprints.map((f) => `${tenorLabel(f.period)} ${num(f.first)} in ${selected.issue} against ${num(f.reprint)} in ${f.issue} (${pct(f.gap)} apart)`))}. The study uses the first print, its pre-registered rule; the second print is a robustness case.`);
    } else if (reprints.length) {
      notes.push(`The next issue re-assessed ${listJoin(reprints.map((f) => `${tenorLabel(f.period)} from ${num(f.first)} to ${num(f.reprint)} (${f.issue}, ${pct(f.gap)} apart)`))}; the study uses the first print.`);
    }
    for (const f of flags.filter((x) => x.rule === "one_week_move")) {
      notes.push(`Quality flag: ${tenorLabel(f.period)} moved ${signedPoints(f.move_pct)} in a week while the other tenors moved ${signedPoints(f.median_other_pct)} (median).`);
    }
    const footer = notes.length ? h("div", {}, notes.map((t) => h("p", { class: "chart-summary" }, t))) : null;
    curveChart(chartBox, selected, { footer });
  }
  if (curves.length) drawCurve();

  // -------------------------------------------------------------- panels
  const measureParam = () => measureOf(ctx.params).value;
  const panels = [
    {
      id: "weekly",
      label: "Contango by week",
      render(body) {
        const box = h("div");
        const seg = segmented({ legend: "Measure", name: "measure-weekly", value: measureParam(), options: MEASURES.map((m) => ({ value: m.value, label: m.label })), onChange: (v) => { ctx.setParams({ measure: v }); drawWeekly(); } });
        body.append(h("div", { class: "controls" }, seg.el), box);
        function drawWeekly() {
          clear(box);
          const m = measureOf(ctx.params);
          seg.set(m.value);
          const weeks = curve.weeks || [];
          const all = shares[m.value]?.all;
          const byYear = shares[`${m.value}_by_year`] || {};
          const named = Object.entries(byYear).filter(([, v]) => v.n >= RULES.minYearN);
          let title = all ? `The ${m.short} in ${shareOf(all.contango, all.n)} of ${plural(all.n, "week", "weeks")}` : "Contango and backwardation by week";
          if (named.length > 1) {
            const lo = named.reduce((a, b) => (b[1].contango < a[1].contango ? b : a));
            const hi = named.reduce((a, b) => (b[1].contango > a[1].contango ? b : a));
            title += `, from ${shareOf(lo[1].contango, lo[1].n)} in ${lo[0]} to ${shareOf(hi[1].contango, hi[1].n)} in ${hi[0]}`;
          }
          const cells = weeks.map((w) => {
            const st = w[m.value];
            return {
              date: w.date,
              state: st === "contango" || st === "backwardation" ? st : null,
              tip: { title: `Curve of ${dateLong(w.date)}`, rows: [{ key: st === "contango" ? "contango" : st === "backwardation" ? "backwardation" : "none", value: st ? capitalise(st) : "Not measurable", label: st ? `(${describe(m.value, st)})` : "that week" }], note: `${num(w.basket_t)} t basket` },
            };
          });
          const yearsList = Object.entries(byYear).map(([y, v]) => `${y} ${shareOf(v.contango, v.n)} of ${v.n}`);
          calendarChart(box, {
            title,
            subtitle: `One cell per week with a curve (ISO weeks), coloured by the ${m.short.startsWith("front") ? "front month against the same day's spot" : "front month against the next month"}. Outlined: a curve without the tenor or spot needed. Empty: no curve that week. No levels are shown.`,
            legend: [
              { label: "Contango", cls: "contango", kind: "rect" },
              { label: "Backwardation", cls: "backwardation", kind: "rect" },
              { label: "Curve, measure not available", cls: "none", kind: "cellnone" },
              { label: "No curve that week", cls: "none", kind: "empty" },
            ],
            cells,
            summary: all ? `Contango in ${shareOf(all.contango, all.n)} and backwardation in ${shareOf(all.backwardation, all.n)} of ${all.n} weekly curves on this measure. By year: ${yearsList.join("; ")}. Weeks run from ${dateLong(weeks[0]?.date)} to ${dateLong(weeks[weeks.length - 1]?.date)}.` : "",
            source: sourceLine(curve, "Banchero Costa weekly FFA assessments; Baltic 5TC prints."),
          });
        }
        drawWeekly();
      },
    },
    {
      id: "seasons",
      label: "By year and month",
      render(body) {
        const box = h("div", { class: "chart-stack" });
        const seg = segmented({ legend: "Measure", name: "measure-seasons", value: measureParam(), options: MEASURES.map((m) => ({ value: m.value, label: m.label })), onChange: (v) => { ctx.setParams({ measure: v }); drawSeasons(); } });
        body.append(h("div", { class: "controls" }, seg.el), box);
        function drawSeasons() {
          clear(box);
          const m = measureOf(ctx.params);
          seg.set(m.value);
          const byMonth = shares[`${m.value}_by_month`] || {};
          const byYear = shares[`${m.value}_by_year`] || {};
          const monthKeys = Object.keys(byMonth).map(Number).sort((a, b) => a - b);
          const named = monthKeys.filter((k) => byMonth[k].n >= RULES.minMonthN);
          let title = "Contango and backwardation by calendar month";
          if (named.length > 1) {
            const hiV = Math.max(...named.map((k) => byMonth[k].contango));
            const loV = Math.min(...named.map((k) => byMonth[k].contango));
            const hiM = named.filter((k) => byMonth[k].contango === hiV);
            const loM = named.filter((k) => byMonth[k].contango === loV);
            title = `By calendar month, contango was most frequent in ${listJoin(hiM.map(monthName))} (${shareOf(hiV, byMonth[hiM[0]].n)}) and least in ${listJoin(loM.map(monthName))} (${shareOf(loV, byMonth[loM[0]].n)})`;
          }
          const stacks = [
            { cls: "contango", label: "Contango", values: Object.fromEntries(monthKeys.map((k) => [k, byMonth[k].contango])) },
            { cls: "backwardation", label: "Backwardation", values: Object.fromEntries(monthKeys.map((k) => [k, byMonth[k].backwardation])) },
          ];
          const tips = Object.fromEntries(monthKeys.map((k) => [k, { title: `${monthName(k)}, ${plural(byMonth[k].n, "curve", "curves")}`, rows: [{ key: "contango", value: shareOf(byMonth[k].contango, byMonth[k].n), label: "contango" }, { key: "backwardation", value: shareOf(byMonth[k].backwardation, byMonth[k].n), label: "backwardation" }] }]));
          barChart(box, {
            title,
            subtitle: `Share of weekly curves by the month they were printed in, ${m.label.toLowerCase()}. Percent; n under each month.`,
            legend: [{ label: "Contango", cls: "contango", kind: "rect" }, { label: "Backwardation", cls: "backwardation", kind: "rect" }],
            cats: monthKeys.map((k) => ({ key: k, label: monthAbbr(k), sub: `n ${byMonth[k].n}` })),
            stacks,
            tips,
            y: { min: 0, max: 1, title: "Share of curves, percent", format: (v) => pct(v, 0) },
            summary: `By calendar month: ${monthKeys.map((k) => `${monthAbbr(k)} ${shareOf(byMonth[k].contango, byMonth[k].n)} contango (n ${byMonth[k].n})`).join("; ")}.`,
            source: sourceLine(curve, "Banchero Costa weekly FFA assessments; Baltic 5TC prints."),
          });
          const yearKeys = Object.keys(byYear).sort();
          const yBox = h("div");
          box.append(yBox);
          barChart(yBox, {
            title: yearTitle(byYear),
            subtitle: `Share of weekly curves by year, ${m.label.toLowerCase()}. Percent; n under each year. ${listJoin(yearKeys.filter((y) => byYear[y].n < RULES.minYearN).map((y) => `${y} (n ${byYear[y].n})`))} ${yearKeys.filter((y) => byYear[y].n < RULES.minYearN).length === 1 ? "has" : "have"} too few curves to read.`,
            legend: [{ label: "Contango", cls: "contango", kind: "rect" }, { label: "Backwardation", cls: "backwardation", kind: "rect" }],
            cats: yearKeys.map((y) => ({ key: y, label: y, sub: `n ${byYear[y].n}` })),
            stacks: [
              { cls: "contango", values: Object.fromEntries(yearKeys.map((y) => [y, byYear[y].contango])) },
              { cls: "backwardation", values: Object.fromEntries(yearKeys.map((y) => [y, byYear[y].backwardation])) },
            ],
            tips: Object.fromEntries(yearKeys.map((y) => [y, { title: `${y}, ${plural(byYear[y].n, "curve", "curves")}`, rows: [{ key: "contango", value: shareOf(byYear[y].contango, byYear[y].n), label: "contango" }, { key: "backwardation", value: shareOf(byYear[y].backwardation, byYear[y].n), label: "backwardation" }] }])),
            y: { min: 0, max: 1, title: "Share of curves, percent", format: (v) => pct(v, 0) },
            summary: `By year: ${yearKeys.map((y) => `${y} ${shareOf(byYear[y].contango, byYear[y].n)} contango of ${byYear[y].n}`).join("; ")}.`,
            source: sourceLine(curve, "Banchero Costa weekly FFA assessments; Baltic 5TC prints."),
          });
          if (q1 && isNum(q1.n)) {
            const spreadMonths = shares.front_spread_by_month || {};
            const strong = Object.keys(spreadMonths).map(Number).sort((a, b) => a - b).filter((mm) => spreadMonths[mm].n >= RULES.minMonthN && spreadMonths[mm].backwardation >= RULES.mostly);
            const season = strong.length
              ? ` On the front spread, the next month priced below the front month in ${listJoin(strong.map((mm) => `${shareOf(spreadMonths[mm].backwardation, spreadMonths[mm].n)} of ${monthName(mm)} curves (${spreadMonths[mm].n})`))}.`
              : "";
            box.append(note(h("strong", {}, "The first-quarter discount. "), `In ${q1.share_below === 1 ? `all ${q1.n}` : `${shareOf(q1.share_below, q1.n)} of ${q1.n}`} curves that printed both, the next year's first quarter priced below the fourth quarter before it, by ${pct(Math.abs(q1.mean_pct))} of the fourth quarter's price on average.${season}`));
          }
        }
        drawSeasons();
      },
    },
    {
      id: "slope",
      label: "Slope against spot",
      render(body) {
        const bins = curve.slope_by_spot || [];
        if (!bins.length) {
          empty(body, { title: "Slope against spot", text: "curve.json carries no slope_by_spot bins in this build." });
          return;
        }
        const width = bins[0].spot_to - bins[0].spot_from;
        const k = (v) => num(v / RULES.thousand);
        const first = bins[0];
        let downFrom = null;
        for (let i = bins.length - 1; i >= 0; i -= 1) {
          if (bins[i].contango_share === 0) downFrom = bins[i];
          else break;
        }
        const downN = downFrom ? bins.filter((b) => b.spot_from >= downFrom.spot_from).reduce((a, b) => a + b.n, 0) : 0;
        let title = `Below a spot of ${usdDay(first.spot_to)} the curve sloped ${first.mean_slope_pct >= 0 ? "up" : "down"} by ${pct(Math.abs(first.mean_slope_pct), 0)} of spot on average`;
        if (downFrom) title += `; from ${usdDay(downFrom.spot_from)} up, all ${downN} curves sloped down`;
        const box = h("div");
        body.append(box);
        barChart(box, {
          title,
          subtitle: `Mean slope: the first full quarter after the front month minus the front month, in percent of spot, for curves grouped by the spot level in bins of USD ${num(width)} a day (spot on each curve's basket). n under each bin.`,
          legend: [{ label: "Mean slope up (contango)", cls: "contango", kind: "rect" }, { label: "Mean slope down (backwardation)", cls: "backwardation", kind: "rect" }],
          cats: bins.map((b) => ({ key: String(b.spot_from), label: `${k(b.spot_from)} to ${k(b.spot_to)}`, sub: `n ${b.n}` })),
          bars: bins.map((b) => ({ key: String(b.spot_from), value: b.mean_slope_pct, cls: b.mean_slope_pct >= 0 ? "contango" : "backwardation" })),
          tips: Object.fromEntries(bins.map((b) => [String(b.spot_from), { title: `Spot ${usdDay(b.spot_from)} to ${num(b.spot_to)}`, rows: [{ key: b.mean_slope_pct >= 0 ? "contango" : "backwardation", value: signedPct(b.mean_slope_pct), label: "mean slope, percent of spot" }, { key: null, value: shareOf(b.contango_share, b.n), label: `of ${plural(b.n, "curve", "curves")} sloped up` }] }])),
          y: { title: "Mean slope, percent of spot", format: (v) => pct(v, 0) },
          x: { title: "Spot level, USD thousand a day" },
          summary: `Mean slope by spot level: ${bins.map((b) => `${k(b.spot_from)} to ${k(b.spot_to)} thousand ${signedPct(b.mean_slope_pct, 1)} (n ${b.n}, ${shareOf(b.contango_share, b.n, 0)} up)`).join("; ")}.`,
          source: sourceLine(curve, "Banchero Costa weekly FFA assessments; Baltic 5TC prints."),
        });
      },
    },
    {
      id: "td3c",
      label: "TD3C strips",
      render(body) {
        const strips = curve.td3c_strips || [];
        if (!strips.length) {
          empty(body, { title: "TD3C quarter-end strips", text: "curve.json carries no td3c_strips in this build." });
          return;
        }
        const lot = engine?.constants?.TONNES_PER_LOT_TD3C;
        const prices = strips.flatMap((st) => st.months.map((mm) => ({ ...mm, as_of: st.as_of })));
        const lo = prices.reduce((a, b) => (b.usd_t < a.usd_t ? b : a));
        const hi = prices.reduce((a, b) => (b.usd_t > a.usd_t ? b : a));
        const slopes = strips.filter((st) => st.months.length > 1).map((st) => ({ st, d: (st.months[st.months.length - 1].usd_t - st.months[0].usd_t) / st.months[0].usd_t }));
        const steep = slopes.reduce((a, b) => (b.d < a.d ? b : a), slopes[0]);
        let title = `BWET's quarter-end TD3C marks ran from ${usdT(lo.usd_t)} (${monthShort(lo.month)}, marked ${dateShort(lo.as_of)}) to ${usdT(hi.usd_t)} (${monthShort(hi.month)}, marked ${dateShort(hi.as_of)})`;
        if (steep && steep.d < 0) title += `; the ${dateShort(steep.st.as_of)} strip fell ${pct(-steep.d)} from its first month to its last`;
        const box = h("div");
        body.append(box);
        lineChart(box, {
          title,
          subtitle: `USD a tonne, each line one quarter-end filing of the Amplify Commodity Trust (BWET): price = notional / contracts / ${isNum(lot) ? num(lot) : "lot size in"} t. Public records.`,
          legend: [{ label: "TD3C futures marks of one filing", cls: "ffa", kind: "line" }],
          x: { type: "time" },
          y: { title: "USD a tonne", includeZero: true },
          series: strips.map((st) => ({
            cls: "ffa",
            dots: true,
            points: st.months.map((mm) => ({ x: monthMid(mm.month), y: mm.usd_t, tip: { title: `${monthLong(mm.month)} contract, marked ${dateLong(st.as_of)}`, rows: [{ key: "ffa", value: usdT(mm.usd_t, 3), label: "" }, { key: null, value: num(mm.contracts), label: "contracts held" }] } })),
          })),
          summary: stripSummary(strips),
          source: "Source: Amplify Commodity Trust 10-Q and 10-K filings, SEC EDGAR (links in the Data section).",
        });
      },
    },
  ];

  // --------------------------------------------------------- disclosures
  const w = wire(ctx, "curve", {
    panels,
    panelLabel: "Other charts in this view",
    sections: [
      {
        id: "method",
        label: "Method",
        render(body) {
          body.append(defs([
            { term: "Contango and backwardation", desc: "Contango: a later tenor above an earlier one, and the front month above spot; backwardation the reverse. Measured on adjacent months and adjacent quarters, and on the front month against the same day's spot." },
            { term: "Front month", desc: "The month of the curve's date when printed, otherwise the first printed month." },
            { term: "Spot", desc: "The Baltic 5TC of the curve's date on the curve's basket, or of the Friday before for a Monday assessment." },
            { term: "First-quarter discount", desc: "The next year's first quarter against the fourth quarter of the curve's year, on every curve that prints both." },
            { term: "Slope", desc: "The first full quarter after the front month minus the front month, divided by spot; averaged by bins of the spot level." },
            { term: "Quarter tenors", desc: "A quarter is the average of its three months, so the chart draws it across them rather than as a point." },
            { term: "TD3C strips", desc: `Each quarter-end 10-Q or 10-K lists the fund's TD3C futures with their notional; notional / contracts / ${isNum(engine?.constants?.TONNES_PER_LOT_TD3C) ? num(engine.constants.TONNES_PER_LOT_TD3C) : "the lot size in"} tonnes is the mark in USD a tonne (ICE TDL lot).` },
          ]));
        },
      },
      {
        id: "assumptions",
        label: "Assumptions",
        render(body) {
          body.append(defs([
            { term: "First print", desc: "Where the next issue's previous-week column re-prints a curve differently, the study keeps the first print (pre-registered) and reports the other as a robustness case." },
            { term: "Basket", desc: `${capitalise(basketForWindow(engine, curves[0]?.date, curves[curves.length - 1]?.date) || "as printed")}; each cited curve says how its basket was established (a label on the page, or the premium column against both baskets' settlements).` },
            { term: "Data policy", desc: "Banchero Costa's weekly FFA panel stays in the study's cache; the site shows levels only on the cited validation weeks and the latest week, each with issue and page, and derived statistics for every other week." },
          ]));
        },
      },
      {
        id: "data",
        label: "Data",
        render(body) {
          for (const c of curves) {
            body.append(table({
              caption: `Curve of ${dateLong(c.date)} (${c.issue}, page ${c.page}), ${num(c.basket_t)} t basket`,
              columns: [
                { label: "Tenor", format: (t) => tenorText(t) },
                { label: "USD a day", num: true, format: (t) => num(t.usd_day) },
                { label: "Against spot, USD a day", num: true, format: (t) => (isNum(c.spot_usd_day) ? signed(t.usd_day - c.spot_usd_day) : "") },
                { label: "Second print", num: true, format: (t) => { const r = (c.reprints || [])[0]?.tenors?.[t.period]; return isNum(r) ? num(r) : ""; } },
              ],
              rows: c.tenors,
              note: h("span", {}, isNum(c.spot_usd_day) ? `Spot ${usdDay(c.spot_usd_day)} on ${dateLong(c.spot_on)}. ` : "No spot cited with this curve. ", h("a", { href: c.url }, "Source report (PDF)")),
            }));
          }
          body.append(table({
            caption: "Shape by week (no levels)",
            limit: 16,
            columns: [
              { label: "Week of", format: (w2) => dateShort(w2.date) },
              { label: "Basket, t", num: true, format: (w2) => num(w2.basket_t) },
              { label: "Front month against spot", format: (w2) => (w2.front_vs_spot ? capitalise(w2.front_vs_spot) : "Not measurable") },
              { label: "Front month against next month", format: (w2) => (w2.front_spread ? capitalise(w2.front_spread) : "Not measurable") },
            ],
            rows: curve.weeks || [],
          }));
          body.append(table({
            caption: "Shares across all weeks",
            columns: [
              { label: "Measure", format: (r) => r.label },
              { label: "Contango", num: true, format: (r) => shareOf(r.v.contango, r.v.n) },
              { label: "Backwardation", num: true, format: (r) => shareOf(r.v.backwardation, r.v.n) },
              { label: "n", num: true, format: (r) => num(r.v.n) },
            ],
            rows: [
              ["front_vs_spot", "Front month against spot (weeks)"],
              ["front_spread", "Front month against next month (weeks)"],
              ["month_spreads", "Adjacent months (pairs)"],
              ["quarter_spreads", "Adjacent quarters (pairs)"],
            ].filter(([k2]) => shares[k2]?.all).map(([k2, label]) => ({ label, v: shares[k2].all })),
          }));
          body.append(table({
            caption: "Slope against spot, by spot level",
            columns: [
              { label: "Spot, USD a day", format: (b) => `${num(b.spot_from)} to ${num(b.spot_to)}` },
              { label: "Curves", num: true, format: (b) => num(b.n) },
              { label: "Mean slope, % of spot", num: true, format: (b) => signedPct(b.mean_slope_pct) },
              { label: "Sloping up", num: true, format: (b) => shareOf(b.contango_share, b.n) },
            ],
            rows: curve.slope_by_spot || [],
          }));
          body.append(table({
            caption: "TD3C quarter-end marks (public record)",
            limit: 16,
            columns: [
              { label: "Marked on", format: (r) => dateShort(r.as_of) },
              { label: "Contract", format: (r) => tenorLabel(r.month) },
              { label: "USD a tonne", num: true, format: (r) => num(r.usd_t, 3) },
              { label: "Contracts", num: true, format: (r) => num(r.contracts) },
              { label: "Filing", format: (r) => h("a", { href: r.url }, "SEC EDGAR") },
            ],
            rows: (curve.td3c_strips || []).flatMap((st) => st.months.map((mm) => ({ ...mm, as_of: st.as_of }))),
          }));
          body.append(h("p", {}, "Download: ", csvLink("sec_freight_futures_marks.csv"), " (every BDRY and BWET quarter-end mark with its filing)."));
        },
      },
    ],
  });
  if (w.panelsEl) section.append(w.panelsEl);
  section.append(w.disclosuresEl);
  return {
    update(params) {
      w.update(params);
      if (params.date && params.date !== selected?.date) {
        const c = curves.find((x) => x.date === params.date);
        if (c) {
          selected = c;
          drawCurve();
        }
      }
    },
  };
}

export default {
  id: "curve",
  name: "Curve",
  needs: ["curve", "engine", "manifest"],
  render,
};
