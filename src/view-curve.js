// view-curve.js: spot against the curve. Cited dated curves against that day's spot, contango and
// backwardation week by week, by year and calendar month (the first-quarter discount), slope against the
// spot level, and TD3C's quarter-end strips from SEC filings.

import { h, takeaway, setTakeaway, table, note, defs, segmented, clear } from "./dom.js";
import { lineChart, calendarChart, barChart, monthMid, monthStart, monthEnd, dayMs, empty } from "./charts.js";
import { pct, shareOf, usdDay, num, signed, signedPct, signedPoints, dateLong, dateShort, tenorLabel, monthName, monthAbbr, monthLong, plural, listJoin, isNum, capitalise, usdT, monthShort } from "./format.js";
import { quarter_months, months_between, add_months } from "./engine.js";
import { wire, sourceLine, basketForWindow, downloadLine, stripSummary, retrievedOf } from "./view-kit.js";
import { basketRule } from "./view-kit.js";

/** The basket the slope bins use: the earlier (smaller) one, for every curve. */
function binBasket(engine) {
  const rule = basketRule(engine);
  return rule ? `${num(rule.before)} t` : "one basket";
}

function binRule(engine) {
  const rule = basketRule(engine);
  if (!rule) return "The bins use one basket for every curve.";
  return `The bins use the spot on the ${num(rule.before)} t basket for every curve (from ${dateLong(rule.from)}, the ${num(rule.after)} t spot less the Baltic's fixed differential); the slope is in percent of the spot on the curve's own basket.`;
}

const RULES = Object.freeze({
  minYearN: 10, // a year (or a spot bin) needs this many curves to be named in a title; fewer are drawn faint
  overshoot: 1.15, // a faint bin beyond this multiple of the populated bins' range is cut at the axis
  smallSlope: 0.1, // a mean slope under this share of spot is labelled to one decimal
  minMonthN: 5, // a calendar month needs this many curves to be named in a title
  thousand: 1000, // literal: unit, spot bins are labelled in USD thousand a day
  mostly: 0.8, // a month's front spread "mostly" in one shape from this share up
  bigGap: 0.1, // a second print this far from the first is called out in the note
});

function describe(measure, state) {
  const word = state === "contango" ? "above" : "below";
  return measure === "front_spread" ? `next month ${word} the front month` : `front month ${word} the spot of its day or the Friday before`;
}

function yearTitle(byYear) {
  const named = Object.entries(byYear).filter(([, v]) => v.n >= RULES.minYearN);
  if (named.length < 2) return "Contango and backwardation by year";
  const lo = named.reduce((a, b) => (b[1].contango < a[1].contango ? b : a));
  const hi = named.reduce((a, b) => (b[1].contango > a[1].contango ? b : a));
  return `By year, contango ran from ${shareOf(lo[1].contango, lo[1].n)} of weeks (${lo[0]}) to ${shareOf(hi[1].contango, hi[1].n)} (${hi[0]}), in years with at least ${RULES.minYearN} curves`;
}

const MEASURES = [
  { value: "front_vs_spot", label: "Front month against spot", short: "front month above the spot of its day or the Friday before", subject: "The front month", rel: "above the spot of its day, or the Friday before," },
  { value: "front_spread", label: "Front month against the next month", short: "next month above the front month", subject: "The next month", rel: "above the front month" },
];

/** Years the weekly curves cover only in part: { 2023: "Sep to Dec" }. */
function yearCoverage(weeks) {
  const by = {};
  for (const w of weeks) {
    const y = w.date.slice(0, 4);
    const m = Number(w.date.slice(5, 7));
    by[y] = by[y] || [m, m];
    by[y] = [Math.min(by[y][0], m), Math.max(by[y][1], m)];
  }
  const out = {};
  for (const [y, [a, b]] of Object.entries(by)) {
    if (a > 1 || b < 12) out[y] = a === b ? monthAbbr(a) : `${monthAbbr(a)} to ${monthAbbr(b)}`;
  }
  return out;
}

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

/** How the curve's basket was established, in the page's terms. */
function basketHow(curve) {
  const how = curve.basket_how || "";
  if (/premium column/.test(how)) return `the page's premium column matches the ${num(curve.basket_t)} t spot`;
  return how;
}

/** The spot's provenance: date, kind and sources. */
function spotSource(curve) {
  const srcs = (curve.spot_sources || []).filter(Boolean);
  const kind = curve.spot_kind === "implied" ? "implied from" : "as printed in";
  return `Baltic 5TC of ${dateLong(curve.spot_on)}${srcs.length ? `, ${kind} ${listJoin(srcs)}` : ""}`;
}

/** Points of a month series with a break (NaN) wherever a calendar month is missing between two prints. */
function monthLine(entries) {
  const sorted = entries.slice().sort((a, b) => (a.period < b.period ? -1 : 1));
  const pts = [];
  const gaps = [];
  sorted.forEach((e, i) => {
    if (i > 0) {
      const prev = sorted[i - 1].period;
      const missing = months_between(prev, e.period) - 1;
      if (missing > 0) {
        for (let k = 1; k <= missing; k += 1) gaps.push(add_months(prev, k));
        pts.push({ x: (monthMid(prev) + monthMid(e.period)) / 2, y: NaN });
      }
    }
    pts.push(e.point);
  });
  return { pts, gaps };
}

/** The first print against the second: every tenor of either, with the gap where both print it. */
function printGap(curve) {
  const reprint = (curve.reprints || [])[0];
  if (!reprint) return null;
  const first = Object.fromEntries(curve.tenors.map((t) => [t.period, t.usd_day]));
  const second = reprint.tenors || {};
  const both = Object.keys(first).filter((p) => isNum(second[p]));
  const onlySecond = Object.keys(second).filter((p) => !isNum(first[p]));
  const onlyFirst = Object.keys(first).filter((p) => !isNum(second[p]));
  const gaps = both.map((p) => ({ period: p, gap: (second[p] - first[p]) / first[p] }));
  return { reprint, gaps, onlySecond, onlyFirst };
}

function curveChart(box, curve, opts) {
  clear(box);
  const spot = curve.spot_usd_day;
  const months = curve.tenors.filter((t) => t.kind === "month");
  const quarters = curve.tenors.filter((t) => t.kind === "quarter");
  const reprint = (curve.reprints || [])[0];
  const series = [];
  const firstLine = monthLine(months.map((t) => ({
    period: t.period,
    point: {
      x: monthMid(t.period),
      y: t.usd_day,
      tip: { title: `${tenorText(t)}, first print`, rows: [{ key: "ffa", value: usdDay(t.usd_day), label: "" }, ...(isNum(spot) ? [{ key: "spot", value: vsSpot(t.usd_day, spot), label: "" }] : [])], note: `${curve.issue}, page ${curve.page}` },
    },
  })));
  series.push({ cls: "ffa", animate: true, dots: true, points: firstLine.pts });
  const printedMonths = new Set(months.map((t) => t.period));
  const spans = quarters.map((t) => {
    const ms = quarter_months(t.period);
    return {
      x0: monthStart(ms[0]),
      x1: monthEnd(ms[2]),
      y: t.usd_day,
      cls: "ffa",
      dot: !ms.some((mm) => printedMonths.has(mm)),
      tip: { title: `${tenorText(t)}, first print`, rows: [{ key: "ffa", value: usdDay(t.usd_day), label: "quarter average" }, ...(isNum(spot) ? [{ key: "spot", value: vsSpot(t.usd_day, spot), label: "" }] : [])], note: `${curve.issue}, page ${curve.page}` },
    };
  });
  let secondGaps = [];
  if (reprint) {
    const first = Object.fromEntries(curve.tenors.map((t) => [t.period, t.usd_day]));
    const monthEntries = [];
    for (const [period, v] of Object.entries(reprint.tenors)) {
      const label = tenorLabel(period);
      const firstV = first[period];
      const tip = { title: `${label}, second print (${reprint.issue})`, rows: [{ key: "ffa", value: usdDay(v), label: "" }, ...(isNum(firstV) ? [{ key: null, value: `${signedPct((v - firstV) / firstV)}`, label: `against the first print (${num(firstV)})` }] : [{ key: null, value: "Not in the first print", label: "" }])] };
      if (period.includes("-Q")) {
        const ms = quarter_months(period);
        const reprintMonths = Object.keys(reprint.tenors).filter((pp) => !pp.includes("-Q"));
        spans.push({ x0: monthStart(ms[0]), x1: monthEnd(ms[2]), y: v, cls: "ffa", hollow: true, tip, dot: !ms.some((mm) => reprintMonths.includes(mm)) });
      } else monthEntries.push({ period, point: { x: monthMid(period), y: v, tip } });
    }
    const secondLine = monthLine(monthEntries);
    secondGaps = secondLine.gaps;
    series.push({ cls: "ffa", thin: true, dots: true, hollow: true, points: secondLine.pts });
  }
  const refs = [];
  const periods = [...curve.tenors.map((t) => t.period), ...(reprint ? Object.keys(reprint.tenors) : [])];
  const xs = periods.flatMap((pd) => (pd.includes("-Q") ? [monthStart(quarter_months(pd)[0]), monthEnd(quarter_months(pd)[2])] : [monthStart(pd), monthEnd(pd)]));
  if (isNum(spot) && curve.spot_on) {
    refs.push({ y: spot, label: `Spot ${num(spot)}, ${dateLong(curve.spot_on)}`, cls: "spot" });
    xs.push(dayMs(curve.spot_on));
    series.push({ cls: "spot", line: false, dots: true, points: [{ x: dayMs(curve.spot_on), y: spot, tip: { title: `Spot, ${dateLong(curve.spot_on)}`, rows: [{ key: "spot", value: usdDay(spot), label: `${num(curve.basket_t)} t basket` }], note: `${spotSource(curve)}; ${basketHow(curve)}` } }] });
  }
  const title = shapeTitle(curve);
  const legend = [
    { label: reprint ? "Months, first print (the study uses it)" : "Month tenors", cls: "ffa", kind: "linedot" },
    { label: "Quarter tenors, a bar across their three months", cls: "ffa", kind: "span" },
  ];
  if (reprint) legend.push({ label: `Second print (${reprint.issue})`, cls: "ffa", kind: "thinring" });
  if (isNum(spot)) legend.push({ label: "Baltic 5TC spot", cls: "spot", kind: "thin" });
  // months first, then quarters, each in calendar order, as in the Data tables
  const ordered = curve.tenors.slice().sort((a, b) => (a.period.includes("-Q") === b.period.includes("-Q") ? (a.period < b.period ? -1 : 1) : a.period.includes("-Q") ? 1 : -1));
  const parts = ordered.map((t) => `${t.label} ${num(t.usd_day)}${isNum(spot) ? ` (${signed(t.usd_day - spot)})` : ""}`);
  const gapText = firstLine.gaps.length ? ` ${listJoin(firstLine.gaps.map((g) => monthLong(g)))} ${firstLine.gaps.length === 1 ? "is" : "are"} not printed as a month on the page; the line breaks there.` : "";
  const summary = `FFA tenors on ${dateLong(curve.date)}, USD a day${isNum(spot) ? `, with their distance from the spot of ${num(spot)} on ${dateLong(curve.spot_on)}` : ""}: ${parts.join(", ")}.${gapText}`;
  const src = h("span", {}, `Source: ${curve.source}, page ${curve.page}. `, h("a", { href: curve.url }, "Report (PDF)"), reprint ? h("span", {}, " and ", h("a", { href: reprint.url }, `${reprint.issue} (PDF)`)) : null, `, ${opts.retrieved}.${isNum(spot) && curve.spot_on ? ` Spot: ${spotSource(curve)}.` : ""} Levels shown only on cited dates, as the data policy allows.`);
  return lineChart(box, {
    title,
    subtitle: `USD a day, ${num(curve.basket_t)} t basket (${basketHow(curve)}). Banchero Costa's weekly assessment, dated ${dateLong(curve.date)} on the page${new Date(`${curve.date}T00:00:00Z`).getUTCDay() === 0 ? " (a Sunday)" : ""}, cited with issue and page.${firstLine.gaps.length || secondGaps.length ? " A line breaks where a month is not printed." : ""}`,
    legend,
    x: { type: "time", min: Math.min(...xs), max: Math.max(...xs), title: "Contract month" },
    y: { title: "USD a day" },
    series,
    spans,
    refs,
    summary,
    source: src,
    footer: opts.footer,
  });
}

/** The cited curve's shape: the range of its months and of its quarters. */
function shapeTitle(curve) {
  const ms = curve.tenors.filter((t) => !t.period.includes("-Q"));
  const qs = curve.tenors.filter((t) => t.period.includes("-Q"));
  const range = (list) => {
    const lo = list.reduce((a, b) => (b.usd_day < a.usd_day ? b : a));
    const hi = list.reduce((a, b) => (b.usd_day > a.usd_day ? b : a));
    return lo === hi ? `${num(lo.usd_day)} (${lo.label})` : `${num(lo.usd_day)} (${lo.label}) to ${num(hi.usd_day)} (${hi.label})`;
  };
  const parts = [];
  if (ms.length) parts.push(`months from ${range(ms)}`);
  if (qs.length) parts.push(`quarters from ${range(qs)}`);
  return parts.length ? `${dateLong(curve.date)}: ${parts.join(", ")}, USD a day` : `${dateLong(curve.date)}: no tenor printed`;
}

/** The takeaway: the chosen cited curve against the spot of its day, in one finding. */
function curveSentence(curve) {
  const spot = curve.spot_usd_day;
  const front = curve.tenors.find((t) => !t.period.includes("-Q"));
  if (isNum(spot) && front) {
    const above = curve.tenors.filter((t) => t.usd_day > spot).length;
    return `On ${dateLong(curve.date)}, ${above} of ${curve.tenors.length} tenors priced above the spot of ${usdDay(spot)}; the front month sat ${usdDay(Math.abs(front.usd_day - spot))} ${front.usd_day >= spot ? "above" : "below"} it.`;
  }
  const hi = curve.tenors.reduce((a, b) => (b.usd_day > a.usd_day ? b : a));
  const lo = curve.tenors.reduce((a, b) => (b.usd_day < a.usd_day ? b : a));
  return `On ${dateLong(curve.date)}, the curve ran from ${usdDay(hi.usd_day)} (${hi.label}) to ${usdDay(lo.usd_day)} (${lo.label}); no spot is cited with it.`;
}

function render(section, ctx) {
  const { curve, engine } = ctx.data;
  const shares = curve.shares || {};
  const q1 = curve.q1_discount;
  const curves = (curve.cited_curves || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));

  // ---------------------------------------------------------- takeaway
  // it states what the key chart below it shows, the cited curve chosen; the shares across weeks lead the panels
  const h1 = takeaway("Curve", "The cited curves are not in this build of the data.");
  section.append(h1);

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
  } else empty(key, { title: "No cited curve in this build", text: "This build carries no cited curves." });

  function drawCurve() {
    setTakeaway(h1, "Curve", curveSentence(selected));
    clear(noteBox);
    const flags = selected.flags || [];
    const notes = [];
    const gap = printGap(selected);
    if (gap) {
      const big = gap.gaps.filter((g) => Math.abs(g.gap) >= RULES.bigGap);
      notes.push(`This date was printed twice: in ${selected.issue} (the first print, which the study uses: the price a hedger had on the date) and again in ${gap.reprint.issue}'s previous-week column, a week later. On the ${plural(gap.gaps.length, "tenor", "tenors")} both print, the second print differs by ${gap.gaps.map((g) => `${signedPct(g.gap)} (${tenorLabel(g.period)})`).join(", ")}${big.length ? `; ${plural(big.length, "tenor", "tenors")} by ${pct(RULES.bigGap, 0)} or more` : ""}.${gap.onlySecond.length ? ` Only the second print has ${listJoin(gap.onlySecond.map((p2) => tenorLabel(p2)))}.` : ""}${gap.onlyFirst.length ? ` Only the first has ${listJoin(gap.onlyFirst.map((p2) => tenorLabel(p2)))}.` : ""} Every tenor of both prints is in the Data section.`);
    }
    for (const f of flags.filter((x) => x.rule === "one_week_move")) {
      notes.push(`Quality flag: ${tenorLabel(f.period)} moved ${signedPoints(f.move_pct)} in a week while the other tenors moved ${signedPoints(f.median_other_pct)} (median).`);
    }
    const footer = notes.length ? h("div", {}, notes.map((t) => h("p", { class: "chart-summary" }, t))) : null;
    curveChart(chartBox, selected, { footer, retrieved: retrievedOf(ctx.data.manifest, "Banchero") });
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
          let title = all ? `${m.subject} sat ${m.rel} in ${shareOf(all.contango, all.n)} of ${plural(all.n, "week", "weeks")}` : "Contango and backwardation by week";
          if (named.length > 1) {
            const lo = named.reduce((a, b) => (b[1].contango < a[1].contango ? b : a));
            const hi = named.reduce((a, b) => (b[1].contango > a[1].contango ? b : a));
            title += `, from ${shareOf(lo[1].contango, lo[1].n)} in ${lo[0]} to ${shareOf(hi[1].contango, hi[1].n)} in ${hi[0]}${named.length < Object.keys(byYear).length ? `, in years with at least ${RULES.minYearN} curves` : ""}`;
          }
          const cells = weeks.map((w) => {
            const st = w[m.value];
            return {
              date: w.date,
              state: st === "contango" || st === "backwardation" ? st : null,
              tip: { title: `Curve of ${dateLong(w.date)}`, rows: [{ key: st === "contango" ? "contango" : st === "backwardation" ? "backwardation" : "none", value: st ? capitalise(st) : "Not measurable", label: st ? `(${describe(m.value, st)})` : "that week" }], note: `${num(w.basket_t)} t basket` },
            };
          });
          const cover = yearCoverage(weeks);
          const yearsList = Object.entries(byYear).map(([y, v]) => `${y}${cover[y] ? ` (${cover[y]})` : ""} ${shareOf(v.contango, v.n)} of ${v.n}`);
          const partial = Object.entries(cover).map(([y, c]) => `${y} ${c}`);
          calendarChart(box, {
            title,
            subtitle: `One cell per week with a curve (ISO weeks), coloured by the ${m.short.startsWith("front") ? "front month against the spot of its day or the Friday before" : "front month against the next month"}. Outlined: a curve without the tenor or spot needed. Empty: no curve that week. No levels are shown.${partial.length ? ` Years covered in part: ${listJoin(partial)}.` : ""}`,
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
          if (q1 && isNum(q1.n) && q1.n > 0) title += `; the next year's first quarter priced below the fourth in ${q1.share_below === 1 ? `all ${q1.n}` : `${shareOf(q1.share_below, q1.n)} of ${q1.n}`} curves that printed both, by ${pct(Math.abs(q1.mean_pct))} on average`;
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
          const yearCov = yearCoverage(curve.weeks || []);
          const yBox = h("div");
          box.append(yBox);
          barChart(yBox, {
            title: yearTitle(byYear),
            subtitle: `Share of weekly curves by year, ${m.label.toLowerCase()}. Percent; n under each year.${yearKeys.some((y) => byYear[y].n < RULES.minYearN) ? ` ${listJoin(yearKeys.filter((y) => byYear[y].n < RULES.minYearN).map((y) => `${y} (n ${byYear[y].n})`))} ${yearKeys.filter((y) => byYear[y].n < RULES.minYearN).length === 1 ? "has" : "have"} too few curves to read and ${yearKeys.filter((y) => byYear[y].n < RULES.minYearN).length === 1 ? "is" : "are"} drawn faint.` : ""}${Object.keys(yearCov).length ? ` Years covered in part: ${listJoin(Object.entries(yearCov).map(([y, c]) => `${y} ${c}`))}.` : ""}`,
            legend: [{ label: "Contango", cls: "contango", kind: "rect" }, { label: "Backwardation", cls: "backwardation", kind: "rect" }],
            cats: yearKeys.map((y) => ({ key: y, label: y, sub: `n ${byYear[y].n}`, muted: byYear[y].n < RULES.minYearN })),
            stacks: [
              { cls: "contango", values: Object.fromEntries(yearKeys.map((y) => [y, byYear[y].contango])) },
              { cls: "backwardation", values: Object.fromEntries(yearKeys.map((y) => [y, byYear[y].backwardation])) },
            ],
            tips: Object.fromEntries(yearKeys.map((y) => [y, { title: `${y}${yearCov[y] ? ` (${yearCov[y]})` : ""}, ${plural(byYear[y].n, "curve", "curves")}`, rows: [{ key: "contango", value: shareOf(byYear[y].contango, byYear[y].n), label: "contango" }, { key: "backwardation", value: shareOf(byYear[y].backwardation, byYear[y].n), label: "backwardation" }], note: byYear[y].n < RULES.minYearN ? "Too few curves to read" : null }])),
            y: { min: 0, max: 1, title: "Share of curves, percent", format: (v) => pct(v, 0) },
            summary: `By year: ${yearKeys.map((y) => `${y}${yearCov[y] ? ` (${yearCov[y]})` : ""} ${shareOf(byYear[y].contango, byYear[y].n)} contango of ${byYear[y].n}`).join("; ")}.`,
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
          empty(body, { title: "Slope against spot", text: "This build carries no slope bins." });
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
        const small = (b) => b.n < RULES.minYearN;
        const populated = bins.filter((b) => !small(b));
        let title = `Below a spot of ${usdDay(first.spot_to)} the curve sloped ${first.mean_slope_pct >= 0 ? "up" : "down"} by ${pct(Math.abs(first.mean_slope_pct), 0)} of spot on average`;
        if (populated.length > 1) {
          const hiB = populated.reduce((a, b) => (b.mean_slope_pct > a.mean_slope_pct ? b : a));
          const loB = populated.reduce((a, b) => (b.mean_slope_pct < a.mean_slope_pct ? b : a));
          title = `Where at least ${RULES.minYearN} curves fall in a bin, the mean slope ran from ${signedPct(hiB.mean_slope_pct, 0)} of spot (USD ${k(hiB.spot_from)} to ${k(hiB.spot_to)} thousand a day) to ${signedPct(loB.mean_slope_pct, 0)} (USD ${k(loB.spot_from)} to ${k(loB.spot_to)} thousand)`;
        }
        if (downFrom) title += `; from ${usdDay(downFrom.spot_from)} up, all ${downN} curves sloped down`;
        // the axis follows the populated bins; a faint bin far beyond them is cut and labelled with its value
        const popVals = populated.map((b) => b.mean_slope_pct);
        const capHi = popVals.length ? Math.max(0, ...popVals) * RULES.overshoot : null;
        const capLo = popVals.length ? Math.min(0, ...popVals) * RULES.overshoot : null;
        const yMax = isNum(capHi) && bins.some((b) => b.mean_slope_pct > capHi) ? capHi : undefined;
        const yMin = isNum(capLo) && bins.some((b) => b.mean_slope_pct < capLo) ? capLo : undefined;
        const box = h("div");
        body.append(box);
        barChart(box, {
          title,
          subtitle: `Mean slope: the first full quarter after the front month minus the front month, in percent of spot, for curves grouped by the spot level in bins of USD ${num(width)} a day. ${binRule(engine)} n under each bin; bins of fewer than ${RULES.minYearN} curves are drawn faint, and a bar beyond the axis is cut and labelled with its value.`,
          legend: [{ label: "Mean slope up (contango)", cls: "contango", kind: "rect" }, { label: "Mean slope down (backwardation)", cls: "backwardation", kind: "rect" }],
          cats: bins.map((b) => ({ key: String(b.spot_from), label: `${k(b.spot_from)} to ${k(b.spot_to)}`, sub: `n ${b.n}`, muted: small(b) })),
          capLabel: (bar) => { const b = bins.find((x) => String(x.spot_from) === bar.key); return `${signedPct(bar.value, 0)} (n ${b?.n ?? ""})`; },
          valueLabels: (bar) => signedPct(bar.value, Math.abs(bar.value) < RULES.smallSlope ? 1 : 0),
          bars: bins.map((b) => ({ key: String(b.spot_from), value: b.mean_slope_pct, cls: b.mean_slope_pct >= 0 ? "contango" : "backwardation" })),
          tips: Object.fromEntries(bins.map((b) => [String(b.spot_from), { title: `Spot ${usdDay(b.spot_from)} to ${num(b.spot_to)}`, rows: [{ key: b.mean_slope_pct >= 0 ? "contango" : "backwardation", value: signedPct(b.mean_slope_pct), label: "mean slope, percent of spot" }, { key: null, value: shareOf(b.contango_share, b.n), label: `of ${plural(b.n, "curve", "curves")} sloped up` }], note: small(b) ? "Too few curves to read" : null }])),
          y: { title: "Mean slope, percent of spot", format: (v) => pct(v, 0), max: yMax, min: yMin },
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
          empty(body, { title: "TD3C quarter-end strips", text: "This build carries no TD3C strips." });
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
          legend: [
            { label: `Latest filing, marked ${dateLong(strips[strips.length - 1].as_of)}`, cls: "ffa", kind: "linedot" },
            { label: "Earlier quarter-end filings", cls: "ffa", kind: "thin" },
          ],
          x: { type: "time", title: "Contract month" },
          y: { title: "USD a tonne", includeZero: true },
          series: strips.map((st, i) => ({
            cls: "ffa",
            dots: true,
            muted: i < strips.length - 1,
            endLabel: i === strips.length - 1 ? dateLong(st.as_of) : null,
            endLabelShort: i === strips.length - 1 ? monthShort(st.as_of.slice(0, 7)) : null,
            points: st.months.map((mm) => ({ x: monthMid(mm.month), y: mm.usd_t, tip: { title: `${monthLong(mm.month)} contract, marked ${dateLong(st.as_of)}`, rows: [{ key: "ffa", value: usdT(mm.usd_t, 3), label: "" }, { key: null, value: num(mm.contracts), label: "contracts held" }] } })),
          })),
          summary: stripSummary(strips),
          source: `Source: Amplify Commodity Trust 10-Q and 10-K filings, SEC EDGAR (links in the Data section), ${retrievedOf(ctx.data.manifest, "SEC")}.`,
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
            { term: "Contango and backwardation", desc: "Contango: a later tenor above an earlier one, and the front month above spot; backwardation the reverse. Measured on adjacent months and adjacent quarters, and on the front month against the spot of its day, or the Friday before when that day has no print." },
            { term: "Front month", desc: "The month of the curve's date when printed, otherwise the first printed month." },
            { term: "Spot", desc: "The Baltic 5TC of the curve's date on the curve's basket, or of the latest earlier publication day within four days (the Friday before a Monday or Sunday date). Banchero Costa's own premium column may use another day's spot, so a distance from spot here can differ from the page's premium." },
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
            const rp = (c.reprints || [])[0];
            const firstBy = Object.fromEntries(c.tenors.map((t) => [t.period, t.usd_day]));
            // months first, then quarters, each in calendar order, as the broker's page lists them
            const periods = [...new Set([...c.tenors.map((t) => t.period), ...Object.keys(rp?.tenors || {})])].sort((a, b) => {
              const qa = a.includes("-Q");
              const qb = b.includes("-Q");
              if (qa !== qb) return qa ? 1 : -1;
              return a < b ? -1 : 1;
            });
            const rows = periods.map((p2) => ({ period: p2, first: firstBy[p2], second: rp?.tenors?.[p2], label: c.tenors.find((t) => t.period === p2)?.label || tenorLabel(p2), kind: p2.includes("-Q") ? "quarter" : "month" }));
            const gap = printGap(c);
            body.append(table({
              caption: `Curve of ${dateLong(c.date)} (${c.issue}, page ${c.page}), ${num(c.basket_t)} t basket`,
              columns: [
                { label: "Tenor", format: (r) => tenorText(r) },
                { label: "First print, USD a day", num: true, format: (r) => (isNum(r.first) ? num(r.first) : "") },
                ...(rp ? [
                  { label: `Second print (${rp.issue}), USD a day`, num: true, format: (r) => (isNum(r.second) ? num(r.second) : "") },
                  { label: "Second against first", num: true, format: (r) => (isNum(r.first) && isNum(r.second) ? signedPct((r.second - r.first) / r.first) : "") },
                ] : []),
                { label: "First print against spot, USD a day", num: true, format: (r) => (isNum(c.spot_usd_day) && isNum(r.first) ? signed(r.first - c.spot_usd_day) : "") },
              ],
              rows,
              note: h("span", {},
                isNum(c.spot_usd_day) ? `Spot ${usdDay(c.spot_usd_day)}: ${spotSource(c)}. ` : "No spot cited with this curve. ",
                gap && gap.gaps.length ? `The second print differs from the first by ${pct(Math.min(...gap.gaps.map((g) => Math.abs(g.gap))))} to ${pct(Math.max(...gap.gaps.map((g) => Math.abs(g.gap))))} on the tenors both print. ` : "",
                h("a", { href: c.url }, "Source report (PDF)"),
                rp ? h("span", {}, "; ", h("a", { href: rp.url }, `${rp.issue} (PDF)`)) : null,
                "."),
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
              { label: `Spot (${binBasket(engine)}), USD a day`, format: (b) => `${num(b.spot_from)} to ${num(b.spot_to)}` },
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
          body.append(downloadLine([{ file: "sec_freight_futures_marks.csv", what: "every BDRY and BWET quarter-end mark with its filing" }]));
        },
      },
    ],
  });
  if (w.panelsEl) section.append(w.panelsEl);
  section.append(w.disclosuresEl);
  return {
    state: () => ({ ...w.state(), date: selected?.date, measure: measureOf(ctx.params).value }),
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
