// view-method.js: conventions, formulas, sources with as-of dates, the data policy, the validation
// table, coverage, robustness, quality flags, limitations, downloads, the research note and related work.

import { h, takeaway, table, defs, clear } from "./dom.js";
import { barChart } from "./charts.js";
import { num, numTrim, pct, signed, signedPct, dateLong, tenorLabel, plural, listJoin, isNum, capitalise, horizonLabel } from "./format.js";
import { exists } from "./data.js";
import { wire, csvLink, basketRule, sourceLine } from "./view-kit.js";

const FLAG_RULES = Object.freeze({
  reprint: "Re-printed differently next week",
  one_week_move: "One-week move out of line",
  repeated_page: "Page repeats the previous issue",
  second_first_print: "Date printed twice",
  stale_month_labels: "Stale month labels",
  previous_column_copied: "Previous-week column copied",
});

/** "1,039 days in the daily series: 781 printed, 258 implied by the next day's printed change". */
function dailyText(cov) {
  if (!isNum(cov.daily_days)) return "The daily series is not in this build";
  const split = isNum(cov.daily_printed_days) && isNum(cov.daily_implied_days)
    ? `: ${num(cov.daily_printed_days)} printed, ${num(cov.daily_implied_days)} implied by the next day's printed change`
    : "";
  return `${num(cov.daily_days)} days in the daily series${split}`;
}

/** "Q1 25" or "3 months" from a field that may be a list of periods or a count. */
function periodsText(v, one, many) {
  if (Array.isArray(v)) return listJoin(v.map((x) => tenorLabel(String(x))));
  return isNum(v) ? plural(v, one, many) : "";
}

const NOTE_PDF = "FFA-Basis-Hedging-Study-Research-Note.pdf";
const CITE_EDERINGTON = "Ederington, 1979, Journal of Finance";
const RELATED = [
  { href: "https://nathancouturier.github.io/voyage-tce-model/", text: "Voyage TCE model", what: "The voyage engine this study vendors: C3 and C5 voyages costed into a time charter equivalent, and set against the 5TC curve on single dates." },
  { href: "https://nathancouturier.github.io/baltic-freight-routes/", text: "Baltic freight routes", what: "A map of the Baltic Exchange's freight routes." },
];
const DOWNLOADS = [
  { file: "hedge_effectiveness.csv", what: "Hedge effectiveness by voyage and horizon: intervals, the out-of-sample ratio, standard deviations, tail risk and the residual split." },
  { file: "hedge_outcomes.csv", what: "Every historical fixture: unhedged surprise, paper move, residual and its timing, route and size parts, USD a day (no levels)." },
  { file: "forecast_errors.csv", what: "Every contract month's settlement minus its price 1, 2 and 3 months ahead, in USD a day and percent, with basket and settlement status." },
  { file: "roll_cost_by_year.csv", what: "Roll cost of a rolling one-month and front-quarter long by year: USD a day, percent of settlement and per ship-year." },
  { file: "monthly_settlements_5tc.csv", what: "Monthly 5TC settlements with their status (complete, published, estimated), both baskets in 2026, coverage and links." },
  { file: "sec_freight_futures_marks.csv", what: "Every BDRY and BWET quarter-end futures mark from SEC filings: contracts, notional, price and filing link." },
  { file: "td3c_weekly_prints.csv", what: "Weekly TD3C and TD34 prints in Worldscale and TCE, with the marked weeks and each report's link." },
];

function statusRows(coverage) {
  const by = coverage?.settlements_by_year || {};
  return Object.keys(by).sort().map((y) => ({ year: y, complete: by[y].complete || 0, published: by[y].published || 0, estimated: by[y].estimated || 0 }));
}

function render(section, ctx) {
  const { method, manifest, engine } = ctx.data;
  const validation = method.validation || [];
  const ok = validation.filter((v) => v.ok).length;
  const cov = method.coverage || {};
  const rows = statusRows(cov);
  const totals = rows.reduce((a, r) => ({ complete: a.complete + r.complete, published: a.published + r.published, estimated: a.estimated + r.estimated }), { complete: 0, published: 0, estimated: 0 });

  // ---------------------------------------------------------- takeaway
  const parts = [];
  if (validation.length) parts.push(ok === validation.length ? `All ${num(ok)} validation anchors reproduce` : `${num(ok)} of ${num(validation.length)} validation anchors reproduce`);
  // one finding: the settlements; what was read is in the chart and Coverage
  if (rows.length) parts.push(`${num(totals.complete + totals.published)} monthly 5TC settlements are exact and ${num(totals.estimated)} estimated`);
  const sentence = parts.length ? `${capitalise(parts.join("; "))}.` : "The method artifact is not in this build of the data.";
  section.append(takeaway("Method and data", sentence));

  // ---------------------------------------------------------- key chart
  const key = h("div");
  section.append(key);
  if (rows.length) {
    const ffaWeeks = cov.ffa_weeks_by_year || {};
    const full = rows.filter((r) => r.complete > 0);
    const pub = rows.filter((r) => r.published > 0);
    const est = rows.filter((r) => r.estimated > 0);
    const span = (list) => {
      if (!list.length) return "";
      const ys = list.map((r) => Number(r.year));
      const contiguous = ys.every((y, i) => i === 0 || y === ys[i - 1] + 1);
      if (ys.length === 1) return String(ys[0]);
      return contiguous ? `${ys[0]} to ${ys[ys.length - 1]}` : listJoin(ys.map(String));
    };
    barChart(key, {
      title: `Settlements: ${num(totals.complete)} complete months from the study's own daily series (${span(full)}), ${num(totals.published)} published (${span(pub)}), ${num(totals.estimated)} estimated (${span(est)})`,
      subtitle: "Monthly 5TC settlements by year and how each was established. The details of each year also give the weekly FFA curves read that year.",
      legend: [
        { label: "Complete: every publication day in the study's daily series", cls: "status-complete", kind: "rect" },
        { label: "Published: Himalaya Shipping's monthly average (SEC 6-K)", cls: "status-published", kind: "rect" },
        { label: "Estimated: average of the days observed (robustness only)", cls: "status-estimated", kind: "rect" },
      ],
      cats: rows.map((r) => ({ key: r.year, label: r.year })),
      stacks: [
        { cls: "status-complete", values: Object.fromEntries(rows.map((r) => [r.year, r.complete])) },
        { cls: "status-published", values: Object.fromEntries(rows.map((r) => [r.year, r.published])) },
        { cls: "status-estimated", values: Object.fromEntries(rows.map((r) => [r.year, r.estimated])) },
      ],
      tips: Object.fromEntries(rows.map((r) => [r.year, { title: `${r.year}`, rows: [{ key: "status-complete", value: num(r.complete), label: "complete months" }, { key: "status-published", value: num(r.published), label: "published" }, { key: "status-estimated", value: num(r.estimated), label: "estimated" }, { key: null, value: num(ffaWeeks[r.year] || 0), label: "weekly FFA curves" }] }])),
      y: { min: 0, title: "Months" },
      summary: `By year: ${rows.map((r) => `${r.year} ${r.complete} complete, ${r.published} published, ${r.estimated} estimated, ${plural(ffaWeeks[r.year] || 0, "weekly curve", "weekly curves")} read`).join("; ")}. First FFA week ${dateLong(cov.first_ffa_week)}, last ${dateLong(cov.last_ffa_week)}.`,
      source: `${sourceLine(method, "every source in the manifest")} Built ${dateLong(manifest.built_on)} from ${num(manifest.documents)} cached documents.`,
    });
  }

  // ------------------------------------------------- note and related work
  const further = h("ul", { class: "link-list" });
  const noteItem = h("li");
  further.append(noteItem);
  exists(NOTE_PDF).then((found) => {
    clear(noteItem);
    if (found) noteItem.append(h("a", { href: NOTE_PDF }, "Research note (PDF)"), h("span", { class: "what" }, "The study as a short research note."));
    else noteItem.append(h("span", {}, "Research note (PDF)"), h("span", { class: "what" }, "Not in this build of the site; the pipeline writes it to the repository's root."));
  });
  for (const r of RELATED) further.append(h("li", {}, h("a", { href: r.href }, r.text), h("span", { class: "what" }, r.what)));
  section.append(h("div", {}, h("h2", { class: "section-title" }, "Read further"), further));

  // --------------------------------------------------------- disclosures
  const rule = engine?.constants;
  const sections = [
    {
      id: "conventions",
      label: "Conventions",
      render(body) {
        body.append(table({
          caption: "Contract and index conventions, with their primary sources",
          wrap: true,
          columns: [
            { label: "Convention", format: (c) => c.name },
            { label: "Rule", format: (c) => c.rule },
            { label: "Source", format: (c) => (c.url ? h("a", { href: c.url }, c.source) : c.source) },
            { label: "Where", format: (c) => c.where },
          ],
          rows: method.conventions || [],
        }));
        if (rule) {
          body.append(table({
            caption: "Constants the browser engine reads (data/engine.json)",
            columns: [{ label: "Constant", format: (r) => r[0] }, { label: "Value", num: true, format: (r) => (typeof r[1] === "number" ? num(r[1], Number.isInteger(r[1]) ? 0 : 2) : /^\d{4}-\d{2}-\d{2}$/.test(String(r[1])) ? dateLong(String(r[1])) : String(r[1])) }],
            rows: Object.entries(rule),
          }));
        }
      },
    },
    {
      id: "formulas",
      label: "Formulas",
      render(body) {
        body.append(defs((method.formulas || []).map((f) => ({ term: f.name, desc: f.text }))));
        if (method.ederington) {
          const e = method.ederington;
          const dropped = e.pairs_dropped || {};
          const why = [
            [dropped.not_7_days_apart, "are not 7 days apart"],
            [dropped.no_next_month_tenor, "lack the next month's tenor on one of the two curves"],
            [dropped.no_same_day_spot, "lack a spot level on a curve's own date"],
            [dropped.basket_changed, "straddle the change of basket"],
          ].filter(([n]) => isNum(n) && n > 0).map(([n, t]) => `${num(n)} ${t}`);
          body.append(h("h3", { class: "section-title" }, "Ederington's measure"));
          const implied = [e.pairs_implied_spot, e.pairs_with_implied_spot, e.pairs_implied].find(isNum);
          body.append(h("p", { class: "prose" }, `For comparison with the literature (${CITE_EDERINGTON}), not with a published figure: regressing weekly spot changes on the changes of the next month's FFA, from one curve's date to the next a week later, on the same basket, from ${dateLong(e.first)} to ${dateLong(e.last)} (${plural(e.n, "pair of weeks", "pairs of weeks")}) gives a hedge ratio of ${num(e.hedge_ratio, 2)} and an R-squared of ${num(e.r_squared, 2)}, the share of weekly spot variance such a hedge would remove. A pair needs the tenor on both curves and a spot level on both curve dates, mostly Mondays (printed, or implied by the next day's printed change).${e.pairs_considered ? ` Of ${num(e.pairs_considered)} pairs of consecutive curves, ${listJoin(why)}, which leaves ${num(e.n)}${isNum(implied) ? `, ${num(implied)} of them with an implied level` : ""}; ${num(e.pairs_in_2026 ?? 0)} fall on or after ${dateLong(engine?.constants?.BASKET_182_FROM)}, when the daily series is complete.` : ""}`));
        }
      },
    },
    {
      id: "sources",
      label: "Sources",
      render(body) {
        body.append(table({
          caption: "Sources, documents cached and retrieval dates",
          wrap: true,
          columns: [
            { label: "Source", format: (s) => s.source },
            { label: "Documents", num: true, format: (s) => num(s.documents) },
            { label: "Links", format: (s) => sourceLinks(s.links) },
            { label: "First retrieved", format: (s) => dateLong(s.first_retrieved?.slice(0, 10)) },
            { label: "Last retrieved", format: (s) => dateLong(s.last_retrieved?.slice(0, 10)) },
            { label: "Terms", format: (s) => (s.licence || []).join("; ") },
          ],
          rows: manifest.sources || [],
        }));
        const asOf = manifest.as_of || {};
        const names = { ffa_curve: "Latest FFA curve", daily_5tc: "Latest daily 5TC print", published_5tc: "Latest published monthly 5TC", sec_marks: "Latest SEC quarter-end marks", td3c_weekly: "Latest weekly TD3C print", breakwave: "Latest Breakwave report" };
        body.append(table({
          caption: "Data as of",
          columns: [{ label: "Series", format: (r) => names[r[0]] || r[0] }, { label: "As of", format: (r) => (r[1].length === 7 ? tenorLabel(r[1]) : dateLong(r[1])) }],
          rows: Object.entries(asOf),
          note: `Site built ${dateLong(manifest.built_on)}.`,
        }));
      },
    },
    {
      id: "policy",
      label: "Data policy",
      render(body) {
        body.append(table({
          caption: "What the repository publishes, by source",
          wrap: true,
          columns: [{ label: "Source", format: (p) => p.source }, { label: "Decision", format: (p) => p.decision }],
          rows: method.policy || [],
          note: "Baltic indices and broker FFA curves are licensed: the site shows levels only where the artifacts carry them (cited dated curves, monthly averages, weekly tanker prints with their links) and derived statistics everywhere else.",
        }));
      },
    },
    {
      id: "validation",
      label: "Validation",
      render(body) {
        const unitOf = (u) => ({ usd_day: "USD a day", usd_t: "USD a tonne", ws_points: "WS", points: "points" }[u] || u);
        const fmtV = (v) => (isNum(v) ? numTrim(v, 3) : "");
        body.append(table({
          caption: `Validation anchors: ${ok} of ${validation.length} reproduce`,
          wrap: true,
          limit: 20,
          columns: [
            { label: "Item", format: (v) => v.item },
            { label: "Result", format: (v) => h("span", { class: `${v.ok ? "ok-yes" : "ok-no"} nowrap` }, v.ok ? "Reproduced" : "Not reproduced") },
            { label: "Expected", num: true, format: (v) => fmtV(v.expected) },
            { label: "Reproduced", num: true, format: (v) => fmtV(v.reproduced) },
            { label: "Unit", format: (v) => unitOf(v.unit) },
            { label: "Error", num: true, format: (v) => (isNum(v.error) ? (v.error === 0 ? "0" : Math.abs(v.error) < 1e-3 ? v.error.toExponential(1).replace(/-/g, "\u2212") : signed(v.error, 2)) : "") },
            { label: "Group", format: (v) => v.group },
            // a column of empty notes says nothing: it shows only when a note exists
            ...(validation.some((v) => v.note) ? [{ label: "Note", format: (v) => v.note || "" }] : []),
            { label: "Source", format: (v) => (v.url ? h("a", { href: v.url }, "Link") : "") },
          ],
          rows: validation,
        }));
      },
    },
    {
      id: "coverage",
      label: "Coverage",
      render(body) {
        body.append(defs([
          { term: "FFA curves", desc: `${num(cov.issues_read)} Banchero Costa issues read (${num(cov.ocr_issues)} by OCR), weekly curves from ${dateLong(cov.first_ffa_week)} to ${dateLong(cov.last_ffa_week)}: ${Object.entries(cov.ffa_weeks_by_year || {}).map(([y, n]) => `${y} ${n}`).join(", ")}.` },
          { term: "Daily 5TC", desc: `${dailyText(cov)}; exact monthly settlements (complete or published): ${num(cov.exact_months_180)}, of which ${num(cov.exact_months_182)} on both baskets; complete from the study's own daily series: ${num(cov.complete_months_180)} (${cov.complete_months}).` },
          { term: "SEC marks", desc: `${num(cov.sec_quarter_ends_bdry)} BDRY and ${num(cov.sec_quarter_ends_bwet)} BWET quarter ends.` },
          { term: "TD3C", desc: `${num(cov.td3c_weekly)} weekly prints from ${dateLong(cov.td3c_weekly_first)} to ${dateLong(cov.td3c_weekly_last)}; ${num(cov.breakwave_reports)} Breakwave reports.` },
        ]));
        body.append(table({
          caption: "Hedge observations (fixtures) by voyage and horizon",
          columns: [{ label: "Voyage", format: (r) => r.voyage }, { label: "Placed ahead", format: (r) => capitalise(horizonLabel(r.horizon_months)) }, { label: "Fixtures", num: true, format: (r) => num(r.n) }],
          rows: cov.hedge_observations || [],
        }));
      },
    },
    {
      id: "robustness",
      label: "Robustness",
      render(body) {
        const rob = method.robustness || [];
        const cells = [];
        for (const r of rob) for (const c of r.hedge || []) cells.push({ ...c, key: r.key });
        const combos = [];
        for (const c of cells) if (!combos.some((x) => x.voyage === c.voyage && x.horizon_months === c.horizon_months)) combos.push({ voyage: c.voyage, horizon_months: c.horizon_months });
        combos.sort((a, b) => (a.voyage < b.voyage ? -1 : a.voyage > b.voyage ? 1 : a.horizon_months - b.horizon_months));
        body.append(table({
          caption: "Effectiveness at k = 1 under each robustness case (fixtures in brackets)",
          wrap: true,
          columns: [
            { label: "Case", format: (r) => r.label },
            ...combos.map((cb) => ({ label: `${cb.voyage}, ${cb.horizon_months}\u00a0m`, num: true, format: (r) => { const c = (r.hedge || []).find((x) => x.voyage === cb.voyage && x.horizon_months === cb.horizon_months); return c ? `${pct(c.effectiveness_k1)} (${c.n})` : "no fixture"; } })),
          ],
          rows: rob,
        }));
        const notes = rob.filter((r) => r.note);
        if (notes.length) {
          const ul = h("ul", { class: "table-note notes" });
          for (const r of notes) ul.append(h("li", {}, `${r.label}: ${r.note}.`));
          body.append(ul);
        }
        const biasCols = ["1", "2", "3"];
        body.append(table({
          caption: "Mean forecast error under each robustness case, USD a day (contracts in brackets)",
          wrap: true,
          columns: [
            { label: "Case", format: (r) => r.label },
            ...biasCols.map((k) => ({ label: `${k} month${k === "1" ? "" : "s"}`, num: true, format: (r) => { const b = r.bias?.[k]; return b ? `${signed(b.mean_usd_day)} (${b.n})` : "no contract"; } })),
          ],
          rows: rob,
        }));
        const byYear = method.hedge_by_year || {};
        const yrs = [...new Set(Object.values(byYear).flatMap((list) => list.map((r) => r.year)))].sort();
        if (yrs.length) {
          const obs = cov.hedge_observations || [];
          const horizons = Object.entries(byYear).map(([v, list]) => {
            const total = list.reduce((a, r) => a + r.n, 0);
            return obs.find((o) => o.voyage === v && o.n === total)?.horizon_months;
          });
          const sameH = horizons.every((x) => x && x === horizons[0]) ? horizons[0] : null;
          const ranges = Object.entries(byYear).map(([v, list]) => {
            const vals = list.map((r) => r.effectiveness_k1).filter(isNum);
            return `${v} ${pct(Math.min(...vals))} to ${pct(Math.max(...vals))}`;
          });
          body.append(table({
            caption: `Effectiveness at k = 1 by calendar year${sameH ? `, hedges placed ${horizonLabel(sameH)} ahead` : ""} (fixtures in brackets)`,
            columns: [
              { label: "Voyage", format: (r) => r[0] },
              ...yrs.map((y) => ({ label: String(y), num: true, format: (r) => { const c = r[1].find((x) => x.year === y); return c ? `${pct(c.effectiveness_k1)} (${c.n})` : ""; } })),
            ],
            rows: Object.entries(byYear),
            note: `Each calendar year alone, ${yrs[yrs.length - 1]} included. Range across years: ${ranges.join("; ")}.`,
          }));
        }
      },
    },
    {
      id: "qc",
      label: "Quality flags",
      render(body) {
        const flags = method.qc?.flags || [];
        body.append(table({
          caption: `Curve quality flags (${flags.length})`,
          wrap: true,
          limit: 16,
          columns: [
            { label: "Curve", format: (f) => dateLong(f.curve) },
            { label: "Tenor", format: (f) => (f.period ? tenorLabel(f.period) : "Every tenor") },
            { label: "Rule", format: (f) => FLAG_RULES[f.rule] || f.rule },
            {
              label: "Detail",
              format: (f) =>
                f.rule === "reprint"
                  ? `${f.issue}'s re-print differs from the first print by ${signedPct(f.gap)}`
                  : f.rule === "one_week_move"
                    ? `${signed(f.move_pct, 1)}% against ${signed(f.median_other_pct, 1)}% for the other tenors`
                    : f.rule === "repeated_page"
                      ? `${f.issue} prints the figures of ${dateLong(f.same_as)} again; the curve is not used`
                      : f.rule === "second_first_print"
                        ? `${f.issue} prints the same date again; the first issue's print is kept`
                        : f.rule === "previous_column_copied"
                          ? `${f.issue}'s previous-week column copied this page into rows relabelled for its new date: not a re-print, and no one-week move is measured against it`
                        : f.rule === "stale_month_labels"
                          ? `${f.issue}'s page printed its months a month before its own date; read one month on (${periodsText(f.months_read_one_month_on, "month", "months")})${f.quarters_checked ? `, its quarters (${periodsText(f.quarters_checked, "quarter", "quarters")}) equal the average of their months` : ""}${f.months_left_out ? `; left out: ${periodsText(f.months_left_out, "month", "months")}` : ""}`
                          : "",
            },
          ],
          rows: flags,
          note: "Rule: the study keeps the first print; re-prints beyond the study's tolerance and one-week moves out of line with the other tenors are flagged and reported, never silently replaced. A page that repeats the previous issue's figures under new dates is not an assessment of those dates and is not used. A page whose month labels run a month behind its own date is read one month on when its quarters equal the average of their months; otherwise those months are left out.",
        }));
        const sec = method.qc?.sec_check || [];
        if (sec.length) {
          const summary = method.qc?.sec_summary;
          body.append(table({
            caption: "Curve against the SEC quarter-end marks within a few days",
            limit: 16,
            columns: [
              { label: "Contract", format: (r) => tenorLabel(r.contract_month) },
              { label: "Curve", format: (r) => dateLong(r.curve) },
              { label: "SEC mark", format: (r) => (r.sec_url ? h("a", { href: r.sec_url }, dateLong(r.sec_as_of)) : dateLong(r.sec_as_of)) },
              { label: "Days apart", num: true, format: (r) => num(r.days_apart) },
              { label: "SEC, USD a day", num: true, format: (r) => num(r.sec_usd_day_180) },
              { label: "Curve against the mark", format: (r) => (r.direction === "equal" ? "Equal" : `${capitalise(r.band)}, ${r.direction}`) },
              { label: "Flag", format: (r) => (r.flag ? "Flagged" : "") },
            ],
            rows: sec,
            note: `Both on the ${num(basketRule(engine)?.before ?? sec[0].curve_basket_t)} t basket that BDRY's futures settle on (a later curve converted through the fixed differential).${summary ? ` ${num(summary.n)} comparisons, ${num(summary.flagged)} beyond 10 percent; median gap ${pct(summary.median_abs_gap)}.` : ""} The gap is shown as a band: with the public SEC mark beside it, an exact gap would publish the broker's level. A gap can be the market moving between the two dates as well as an error.`,
          }));
        }
      },
    },
  ];
  if (Array.isArray(method.limitations) && method.limitations.length) {
    sections.push({
      id: "limitations",
      label: "Limitations",
      render(body) {
        const ul = h("ul", { class: "prose" });
        for (const l of method.limitations) {
          if (typeof l === "string") ul.append(h("li", {}, l));
          else ul.append(h("li", {}, l.title ? h("strong", {}, `${l.title}. `) : null, l.text || ""));
        }
        body.append(ul);
      },
    });
  }
  sections.push({
    id: "downloads",
    label: "Downloads",
    render(body) {
      const list = Array.isArray(manifest.downloads) && manifest.downloads.length ? manifest.downloads.map((d) => ({ file: d.file, what: d.description || "" })) : DOWNLOADS;
      const ul = h("ul", { class: "link-list" });
      body.append(ul, h("p", { class: "table-note" }, "Derived results only: no daily index series and no weekly FFA panel, as the data policy sets out. A file this build has not written is not listed."));
      Promise.all(list.map((d) => exists(`data/downloads/${d.file}`))).then((found) => {
        list.forEach((d, i) => {
          if (found[i]) ul.append(h("li", {}, csvLink(d.file), h("span", { class: "what" }, d.what)));
        });
      });
    },
  });
  const w = wire(ctx, "method", { sections, label: "Sections of this view" });
  section.append(w.disclosuresEl);
  return { update: w.update, state: w.state };
}

/** A source's public pages, from the manifest: "Guide to Market Benchmarks, ..." as links. */
function sourceLinks(links) {
  const list = (links || []).filter((l) => l && l.url);
  if (!list.length) return "";
  const span = h("span", { class: "wrap-ok" });
  list.forEach((l, i) => {
    if (i) span.append(", ");
    span.append(h("a", { href: l.url }, l.label || "Link"));
  });
  return span;
}

export default {
  id: "method",
  name: "Method and data",
  needs: ["method", "manifest", "engine"],
  render,
};
