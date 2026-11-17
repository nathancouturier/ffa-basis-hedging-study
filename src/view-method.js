// view-method.js: conventions, formulas, sources with as-of dates, the data policy, the validation
// table, coverage, robustness, quality flags, limitations, downloads, the research note and related work.

import { h, takeaway, table, defs, clear } from "./dom.js";
import { barChart } from "./charts.js";
import { num, numTrim, pct, signed, signedPct, dateLong, dateShort, monthShort, tenorLabel, plural, listJoin, isNum, capitalise, horizonLabel, usdDay } from "./format.js";
import { exists } from "./data.js";
import { wire, csvLink } from "./view-kit.js";

const FLAG_RULES = Object.freeze({
  reprint: "Re-printed differently next week",
  one_week_move: "One-week move out of line",
  repeated_page: "Page repeats the previous issue",
  second_first_print: "Date printed twice",
});

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
  { file: "td3c_weekly_prints.csv", what: "Weekly TD3C and TD34 prints in Worldscale and TCE, with the thin-market marks and each report's link." },
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
  if (isNum(cov.issues_read)) {
    let read = `the study read ${num(cov.issues_read)} Banchero Costa issues${isNum(cov.daily_days) ? ` and ${num(cov.daily_days)} days of 5TC prints` : ""}`;
    if (rows.length) read += `, and settles ${num(totals.complete + totals.published)} months exactly and ${num(totals.estimated)} by estimate`;
    parts.push(read);
  }
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
      subtitle: "Monthly 5TC settlements by year and how each was established. The second figure under each year is the number of weekly FFA curves read that year.",
      legend: [
        { label: "Complete: every publication day in the study's daily series", cls: "status-complete", kind: "rect" },
        { label: "Published: Himalaya Shipping's monthly average (SEC 6-K)", cls: "status-published", kind: "rect" },
        { label: "Estimated: average of the days observed (robustness only)", cls: "status-estimated", kind: "rect" },
      ],
      cats: rows.map((r) => ({ key: r.year, label: r.year, sub: num(ffaWeeks[r.year] || 0) })),
      stacks: [
        { cls: "status-complete", values: Object.fromEntries(rows.map((r) => [r.year, r.complete])) },
        { cls: "status-published", values: Object.fromEntries(rows.map((r) => [r.year, r.published])) },
        { cls: "status-estimated", values: Object.fromEntries(rows.map((r) => [r.year, r.estimated])) },
      ],
      tips: Object.fromEntries(rows.map((r) => [r.year, { title: `${r.year}`, rows: [{ key: "status-complete", value: num(r.complete), label: "complete months" }, { key: "status-published", value: num(r.published), label: "published" }, { key: "status-estimated", value: num(r.estimated), label: "estimated" }, { key: null, value: num(ffaWeeks[r.year] || 0), label: "weekly FFA curves" }] }])),
      y: { min: 0, title: "Months" },
      summary: `By year: ${rows.map((r) => `${r.year} ${r.complete} complete, ${r.published} published, ${r.estimated} estimated, ${plural(ffaWeeks[r.year] || 0, "curve", "curves")}`).join("; ")}. First FFA week ${dateLong(cov.first_ffa_week)}, last ${dateLong(cov.last_ffa_week)}.`,
      source: `Source: method.json coverage, built ${dateLong(manifest.built_on)} from ${num(manifest.documents)} cached documents.`,
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
            columns: [{ label: "Constant", format: (r) => r[0] }, { label: "Value", num: true, format: (r) => (typeof r[1] === "number" ? num(r[1], Number.isInteger(r[1]) ? 0 : 2) : String(r[1])) }],
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
          body.append(h("p", { class: "prose" }, `For comparison with the literature (${CITE_EDERINGTON}): regressing weekly spot changes on front-month FFA changes from ${dateLong(e.first)} to ${dateLong(e.last)} (${plural(e.n, "week", "weeks")}) gives a hedge ratio of ${num(e.hedge_ratio, 2)} and an R-squared of ${num(e.r_squared, 2)}, the share of weekly spot variance a front-month hedge would remove.`));
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
            { label: "First retrieved", format: (s) => dateShort(s.first_retrieved?.slice(0, 10)) },
            { label: "Last retrieved", format: (s) => dateShort(s.last_retrieved?.slice(0, 10)) },
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
            { label: "Group", format: (v) => v.group },
            { label: "Item", format: (v) => v.item },
            { label: "Expected", num: true, format: (v) => fmtV(v.expected) },
            { label: "Reproduced", num: true, format: (v) => fmtV(v.reproduced) },
            { label: "Error", num: true, format: (v) => (isNum(v.error) ? (v.error === 0 ? "0" : Math.abs(v.error) < 1e-3 ? v.error.toExponential(1).replace("-", "\u2212") : signed(v.error, 2)) : "") },
            { label: "Unit", format: (v) => unitOf(v.unit) },
            { label: "Result", format: (v) => h("span", { class: v.ok ? "ok-yes" : "ok-no" }, v.ok ? "Reproduced" : "Not reproduced") },
            { label: "Note", format: (v) => v.note || "" },
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
          { term: "Daily 5TC", desc: `${num(cov.daily_days)} days of prints; exact monthly settlements (complete or published): ${num(cov.exact_months_180)}, of which ${num(cov.exact_months_182)} on both baskets; complete from the study's own daily series: ${num(cov.complete_months_180)} (${cov.complete_months}).` },
          { term: "SEC marks", desc: `${num(cov.sec_quarter_ends_bdry)} BDRY and ${num(cov.sec_quarter_ends_bwet)} BWET quarter ends.` },
          { term: "TD3C", desc: `${num(cov.td3c_weekly)} weekly prints from ${dateLong(cov.td3c_weekly_first)} to ${dateLong(cov.td3c_weekly_last)}; ${num(cov.breakwave_reports)} Breakwave reports.` },
        ]));
        body.append(table({
          caption: "Hedge observations (fixtures) by voyage and horizon",
          columns: [{ label: "Voyage", format: (r) => r.voyage }, { label: "Placed ahead", format: (r) => horizonLabel(r.horizon_months) }, { label: "Fixtures", num: true, format: (r) => num(r.n) }],
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
            ...combos.map((cb) => ({ label: `${cb.voyage}, ${cb.horizon_months} m`, num: true, format: (r) => { const c = (r.hedge || []).find((x) => x.voyage === cb.voyage && x.horizon_months === cb.horizon_months); return c ? `${pct(c.effectiveness_k1)} (${c.n})` : ""; } })),
          ],
          rows: rob,
        }));
        const biasCols = ["1", "2", "3"];
        body.append(table({
          caption: "Mean forecast error under each robustness case, USD a day (contracts in brackets)",
          wrap: true,
          columns: [
            { label: "Case", format: (r) => r.label },
            ...biasCols.map((k) => ({ label: `${k} month${k === "1" ? "" : "s"}`, num: true, format: (r) => { const b = r.bias?.[k]; return b ? `${signed(b.mean_usd_day)} (${b.n})` : ""; } })),
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
            { label: "Curve", format: (f) => dateShort(f.curve) },
            { label: "Tenor", format: (f) => (f.period ? tenorLabel(f.period) : "Every tenor") },
            { label: "Rule", format: (f) => FLAG_RULES[f.rule] || f.rule },
            {
              label: "Detail",
              format: (f) =>
                f.rule === "reprint"
                  ? `${num(f.first)} first, ${num(f.reprint)} in ${f.issue} (${pct(f.gap)})`
                  : f.rule === "one_week_move"
                    ? `${signed(f.move_pct, 1)}% against ${signed(f.median_other_pct, 1)}% for the other tenors`
                    : f.rule === "repeated_page"
                      ? `${f.issue} prints the figures of ${dateShort(f.same_as)} again; the curve is not used`
                      : f.rule === "second_first_print"
                        ? `${f.issue} prints the same date again; the first issue's print is kept`
                        : "",
            },
          ],
          rows: flags,
          note: "Rule: the study keeps the first print; re-prints beyond the study's tolerance and one-week moves out of line with the other tenors are flagged and reported, never silently replaced. A page that repeats the previous issue's figures under new dates is not an assessment of those dates and is not used.",
        }));
        const sec = method.qc?.sec_check || [];
        if (sec.length) {
          body.append(table({
            caption: "Curve against the SEC quarter-end marks within a few days",
            limit: 16,
            columns: [
              { label: "Contract", format: (r) => tenorLabel(r.contract_month) },
              { label: "Curve", format: (r) => dateShort(r.curve) },
              { label: "SEC mark", format: (r) => (r.sec_url ? h("a", { href: r.sec_url }, dateShort(r.sec_as_of)) : dateShort(r.sec_as_of)) },
              { label: "Days apart", num: true, format: (r) => num(r.days_apart) },
              { label: "Curve, USD a day", num: true, format: (r) => num(r.curve_usd_day_180) },
              { label: "SEC, USD a day", num: true, format: (r) => num(r.sec_usd_day_180) },
              { label: "Gap", num: true, format: (r) => signedPct(r.gap) },
              { label: "Flag", format: (r) => (r.flag ? "Flagged" : "") },
            ],
            rows: sec,
            note: "Both on the first basket. A gap can be the market moving between the two dates as well as an error.",
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
        for (const l of method.limitations) ul.append(h("li", {}, typeof l === "string" ? l : l.text || JSON.stringify(l)));
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
  return { update: w.update };
}

export default {
  id: "method",
  name: "Method and data",
  needs: ["method", "manifest", "engine"],
  render,
};
