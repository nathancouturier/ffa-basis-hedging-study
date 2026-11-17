// view-overview.js: the answer. How much of a voyage's earnings variance a 5TC hedge removes, by voyage
// and horizon, three facts, and who sells and who buys.

import { h, takeaway, table, note, defs } from "./dom.js";
import { forestChart, lineChart } from "./charts.js";
import { pct, shareOf, usdDay, num, numTrim, dateLong, dateShort, ws, horizonLabel, listJoin, signed, isNum, capitalise, plural } from "./format.js";
import { wire, basketForWindow, basketRule, sourceLine, downloadLine, sectionHead, retrievedOf } from "./view-kit.js";

const VOYAGES = ["5TC trip", "C3", "C5"];
const SHAPE = Object.freeze({ rolesHeight: 200 }); // literal: px, height of the small owner and charterer chart

function horizonShort(hm) {
  return hm === 1 ? "1 month" : `${hm} months`;
}

function cellTip(r) {
  const rows = [
    { key: "ffa", value: pct(r.effectiveness_k1), label: "of the variance removed at k = 1" },
  ];
  if (r.effectiveness_k1_ci) rows.push({ key: null, value: `${pct(r.effectiveness_k1_ci.low)} to ${pct(r.effectiveness_k1_ci.high)}`, label: "90 percent interval" });
  if (isNum(r.effectiveness_kstar_oos)) {
    rows.push({ key: "ink", value: pct(r.effectiveness_kstar_oos), label: `out-of-sample minimum variance ratio, ${plural(r.n_oos, "fixture", "fixtures")}${isNum(r.effectiveness_k1_same_rows) ? ` (k = 1 on the same fixtures: ${pct(r.effectiveness_k1_same_rows)})` : ""}` });
  }
  rows.push({ key: null, value: `${usdDay(r.sd_unhedged_usd_day)} to ${num(r.sd_hedged_usd_day)}`, label: "standard deviation, unhedged to hedged" });
  return {
    title: `${r.voyage}, hedge placed ${horizonLabel(r.horizon_months)} ahead`,
    rows,
    note: `${plural(r.n, "fixture", "fixtures")}, ${dateShort(r.first_fixture)} to ${dateShort(r.last_fixture)}`,
  };
}

function render(section, ctx) {
  const { overview, engine, method } = ctx.data;
  const hl = overview.headline || {};
  const effs = overview.effectiveness || [];
  const window = basketForWindow(engine, hl.first_fixture, hl.last_fixture);
  const rule = basketRule(engine);

  // ---------------------------------------------------------- takeaway
  const sentence = isNum(hl.effectiveness_k1)
    ? `A 5TC hedge placed ${horizonLabel(hl.horizon_months)} before the fixture removed ${pct(hl.effectiveness_k1)} of the variance of a ${hl.voyage} voyage's earnings.`
    : "The headline effectiveness is not in this build of the data.";
  section.append(takeaway("Overview", sentence));

  const facts = [];
  if (hl.effectiveness_k1_ci) facts.push({ term: "90 percent interval", desc: `${pct(hl.effectiveness_k1_ci.low)} to ${pct(hl.effectiveness_k1_ci.high)} (moving block bootstrap, blocks of ${hl.effectiveness_k1_ci.block} weeks, ${num(hl.effectiveness_k1_ci.resamples)} resamples)` });
  if (isNum(hl.n)) facts.push({ term: "Fixtures", desc: `${num(hl.n)} Fridays, ${dateLong(hl.first_fixture)} to ${dateLong(hl.last_fixture)}` });
  if (overview.as_of) facts.push({ term: "Data as of", desc: dateLong(overview.as_of) });
  if (window) {
    const cb = hl.curve_baskets || {};
    const counts = Object.entries(cb).filter(([, n]) => n > 0).map(([b, n]) => `${num(n)} on ${num(Number(b))} t curves`);
    facts.push({ term: "Basket", desc: `${capitalise(window)}${counts.length > 1 ? ` (hedges: ${listJoin(counts)})` : ""}` });
  }
  const meta = h("dl", { class: "headline-meta" });
  for (const f of facts) meta.append(h("div", {}, h("dt", {}, f.term), h("dd", {}, f.desc)));
  section.append(meta);

  // ---------------------------------------------------------- key chart
  const keyBox = h("div");
  section.append(keyBox);
  const cells = effs.filter((r) => isNum(r.effectiveness_k1));
  if (cells.length) {
    const lo = cells.reduce((a, b) => (b.effectiveness_k1 < a.effectiveness_k1 ? b : a));
    const hi = cells.reduce((a, b) => (b.effectiveness_k1 > a.effectiveness_k1 ? b : a));
    const groups = VOYAGES.filter((v) => cells.some((r) => r.voyage === v)).map((v) => ({
      label: v,
      rows: cells.filter((r) => r.voyage === v).sort((a, b) => a.horizon_months - b.horizon_months).map((r) => ({
        label: `${horizonShort(r.horizon_months)}, n = ${r.n}`,
        est: r.effectiveness_k1,
        lo: r.effectiveness_k1_ci?.low,
        hi: r.effectiveness_k1_ci?.high,
        emph: r.voyage === hl.voyage && r.horizon_months === hl.horizon_months,
        extra: isNum(r.effectiveness_kstar_oos) ? { value: r.effectiveness_kstar_oos } : null,
        tip: cellTip(r),
      })),
    }));
    const oos = cells.filter((r) => isNum(r.effectiveness_kstar_oos));
    const byVoyage = VOYAGES.map((v) => {
      const rs = cells.filter((r) => r.voyage === v).sort((a, b) => a.horizon_months - b.horizon_months);
      if (!rs.length) return null;
      return `${v}: ${listJoin(rs.map((r) => `${pct(r.effectiveness_k1)} at ${horizonShort(r.horizon_months)}`))}`;
    }).filter(Boolean);
    let summary = `Share of earnings variance removed at a 1:1 hedge ratio. ${byVoyage.join("; ")}.`;
    if (oos.length) {
      const scope = oos.length === cells.length ? "for every voyage and horizon, on the later fixtures that have enough history" : `only for ${listJoin(oos.map((r) => `${r.voyage} at ${horizonShort(r.horizon_months)}`))}`;
      summary += ` The minimum variance ratio estimated on past fixtures exists ${scope}. Against k = 1 on the same fixtures it removed: ${oos.map((r) => `${r.voyage} at ${horizonShort(r.horizon_months)}, ${pct(r.effectiveness_kstar_oos)} against ${pct(r.effectiveness_k1_same_rows)} (${r.n_oos} fixtures)`).join("; ")}.`;
    }
    const outside = cells.filter((r) => r.effectiveness_k1_ci && (r.effectiveness_k1 < r.effectiveness_k1_ci.low || r.effectiveness_k1 > r.effectiveness_k1_ci.high));
    const footer = outside.length
      ? h("p", { class: "chart-summary" }, `${listJoin(outside.map((r) => `${r.voyage} at ${horizonShort(r.horizon_months)}`))}: the 90 percent interval (${listJoin(outside.map((r) => `${pct(r.effectiveness_k1_ci.low)} to ${pct(r.effectiveness_k1_ci.high)}`))}) does not contain the estimate (${listJoin(outside.map((r) => pct(r.effectiveness_k1)))}). A percentile bootstrap interval can sit off the estimate when the statistic is skewed in small samples; read that cell with care.`)
      : null;
    forestChart(keyBox, {
      title: `Effectiveness ranges from ${pct(lo.effectiveness_k1)} (${lo.voyage}, ${horizonShort(lo.horizon_months)}) to ${pct(hi.effectiveness_k1)} (${hi.voyage}, ${horizonShort(hi.horizon_months)})`,
      subtitle: "Share of the variance of the earnings surprise (gross TCE minus the FFA strip, USD a day) removed by a 5TC hedge, by voyage and by how far ahead of the fixture the hedge was placed. Percent.",
      legend: [
        { label: "Hedge ratio 1:1, with its 90 percent interval", cls: "ffa", kind: "dot" },
        { label: "Minimum variance ratio estimated on past fixtures only (out of sample), on the later fixtures where it exists; k = 1 on those same fixtures is in the tooltip and the summary", cls: "ink", kind: "diamond" },
      ],
      valueTitle: "k = 1",
      x: { title: "Variance removed, percent", format: (v, axis) => (axis ? pct(v, 0) : pct(v)) },
      groups,
      summary,
      source: sourceLine(overview, "the study's artifacts"),
      footer,
    });
  }

  // ------------------------------------------------------------- facts
  const factEls = h("dl", { class: "facts" });
  const byKey = Object.fromEntries((overview.facts || []).map((f) => [f.key, f]));
  const basis = byKey.basis_left;
  if (basis) {
    const share = hl.residual_variance_share || {};
    const fact = h("div", { class: "fact" },
      h("dt", {}, "Basis left after the hedge"),
      h("dd", { class: "fact-value" }, `USD ${num(basis.value_usd_day)}`, " ", h("span", { class: "fact-unit" }, "a day")),
      h("dd", { class: "fact-detail" }, `Standard deviation of the hedged ${hl.voyage} result (${horizonShort(hl.horizon_months)}, k = 1) against ${usdDay(basis.unhedged_usd_day)} unhedged; ${plural(basis.n, "fixture", "fixtures")}.`));
    const parts = ["timing", "route", "size"].filter((k) => isNum(share[k]));
    if (parts.length) {
      const dd = h("dd", { class: "split" });
      const allPositive = parts.every((k) => share[k] >= 0);
      if (allPositive) {
        const bar = h("div", { class: "split-bar", role: "img", "aria-label": `Residual variance: ${listJoin(parts.map((k) => `${k} basis ${pct(share[k])}`))}` });
        for (const k of parts) if (share[k] > 0) bar.append(h("span", { class: `k-${k}`, style: `flex: ${share[k]} 1 0` }));
        dd.append(bar);
      }
      const leg = h("ul", { class: "split-legend" });
      for (const k of parts) leg.append(h("li", {}, h("span", { class: `split-key k-${k}`, "aria-hidden": "true" }), `${capitalise(k)} basis ${pct(share[k])}`));
      dd.append(leg);
      fact.append(dd);
    }
    factEls.append(fact);
  }
  const contango = byKey.contango_share;
  if (contango) {
    factEls.append(h("div", { class: "fact" },
      h("dt", {}, "Weeks in contango"),
      h("dd", { class: "fact-value" }, shareOf(contango.value, contango.n)),
      h("dd", { class: "fact-detail" }, `Of ${plural(contango.n, "weekly curve", "weekly curves")}, measured as the ${contango.measure}. See the Curve view for adjacent months and quarters.`)));
  }
  const peak = byKey.td3c_peak;
  if (peak) {
    const detail = h("dd", { class: "fact-detail" }, `Worldscale points, and ${usdDay(peak.tce_usd_day)} as a round-trip TCE, in the week to ${dateLong(peak.week)}. `);
    if (peak.url) detail.append(h("a", { href: peak.url }, "Baltic Exchange weekly tanker report"));
    factEls.append(h("div", { class: "fact" },
      h("dt", {}, "TD3C's 2026 extreme"),
      h("dd", { class: "fact-value" }, ws(peak.ws_points)),
      detail));
  }
  if (factEls.childElementCount) section.append(factEls);

  // ------------------------------------------------------ owner, charterer
  const roles = h("div", { class: "roles" });
  const text = h("div", { class: "prose" },
    sectionHead("Owner or charterer: the same hedge, mirrored"),
    h("p", {}, "An owner sells FFAs against the voyage it will fix; a charterer buys them against the hire it will pay. Both remove the same share of variance, because one position is the other with the sign reversed. Their profit and loss runs in opposite directions: when the settlement falls below the price, the owner's paper gains what its voyage loses, and the charterer's paper loses what its cheaper hire saves."),
    h("p", {}, "A short pays (F minus S) times the days hedged, a long (S minus F); the owner hedges the days it will earn, net of commission, as the Method and data view sets out."));
  roles.append(text);
  const chartBox = h("div");
  roles.append(chartBox);
  section.append(roles);
  const sd = hl.sd_unhedged_usd_day;
  if (isNum(sd)) {
    const pts = (sign) => [{ x: -sd, y: sign * sd }, { x: sd, y: -sign * sd }];
    lineChart(chartBox, {
      title: "Below the price the owner's paper gains; above it the charterer's does",
      subtitle: `Paper profit and loss per FFA day against the settlement's distance from the price, USD, over plus or minus one standard deviation of the ${hl.voyage} surprise (${usdDay(sd)}).`,
      legend: [
        { label: "Owner, short FFA", cls: "owner", kind: "line" },
        { label: "Charterer, long FFA", cls: "charterer", kind: "line" },
      ],
      height: SHAPE.rolesHeight,
      x: { type: "linear", title: "Settlement minus FFA price, USD a day", format: (v) => signed(v) },
      y: { title: "USD per FFA day", includeZero: true, format: (v) => signed(v) },
      series: [
        { cls: "owner", points: pts(1).map((p) => ({ ...p, tip: { title: `Settlement ${signed(p.x)} USD a day from the price`, rows: [{ key: "owner", value: signed(p.y), label: "owner (short), USD per FFA day" }, { key: "charterer", value: signed(-p.y), label: "charterer (long)" }] } })), dots: true },
        { cls: "charterer", points: pts(-1), dots: true },
      ],
      summary: `An owner short one FFA day gains a dollar for every dollar the settlement falls below the price and loses the same when it rises; a charterer long the same day mirrors it. At one standard deviation of the surprise (${usdDay(sd)}) one side gains USD ${num(sd)} per FFA day and the other loses it.`,
      source: `Source: the payoff of an FFA settled against the monthly average of the Baltic assessments (EEX Capesize 5TC futures, one day a lot; contract specification ${retrievedOf(ctx.data.manifest, "EEX")}).`,
    });
  }

  section.append(note(h("strong", {}, "A hedging study, not a trading strategy. "), "Roll cost and forward bias are costs and premiums a hedger faces when it rolls paper; the study reports them so a desk can price its hedge, not as a signal, a position size or a profit to chase."));

  // -------------------------------------------------------- disclosures
  const formulas = Object.fromEntries((method?.formulas || []).map((f) => [f.name, f.text]));
  const w = wire(ctx, "overview", {
    sections: [
      {
        id: "method",
        label: "Method",
        render(body) {
          const items = [
            { term: "Fixtures", desc: "Every Friday from the first usable curve to the last week whose voyage months have settled. A fixture is a voyage starting that day: a trip at the day's 5TC as long as that week's C5 voyage (timing basis only), or a C3 or C5 voyage at that Friday's route rate, made a gross TCE by the voyage-tce-model engine with the Baltic vessel of the date." },
            { term: "Hedge", desc: "Placed 1, 2 or 3 months before the fixture on the latest curve printed by then, sized as the voyage's days in each calendar month (net of commission), and held to settlement." },
            { term: "Measure", desc: formulas.Surprise || "U = gross TCE minus F0; hedged = U minus k (S minus F0); effectiveness = 1 minus Var(hedged) / Var(U)." },
            { term: "Strip price", desc: formulas.Strip || "F0 = the day-weighted FFA over the voyage's months." },
            { term: "Residual", desc: formulas["Residual at k = 1"] || "TCE minus S, split into route, timing and size basis." },
            { term: "Intervals", desc: hl.effectiveness_k1_ci ? `Moving block bootstrap, ${num(hl.effectiveness_k1_ci.resamples)} resamples, fixed seed ${hl.effectiveness_k1_ci.seed}; the block is the horizon in weeks plus four (${listJoin(cells.filter((r) => r.voyage === hl.voyage).map((r) => `${r.effectiveness_k1_ci?.block} weeks at ${horizonShort(r.horizon_months)}`))}).` : "Moving block bootstrap." },
            { term: "Minimum variance ratio", desc: `k* = Cov(U, S minus F0) / Var(S minus F0), estimated on an expanding window of past fixtures only (fixtures whose last month settled before the hedge date, at least ${isNum(hl.k_window_min_fixtures) ? num(hl.k_window_min_fixtures) : "a year of"} of them) and applied to the next fixture; reported where the window is long enough, on the fixtures where it exists.` },
            { term: "Tail risk", desc: "The reduction in the conditional value at risk of the surprise (the average of the worst 5 percent of outcomes), shown in the Data section." },
          ];
          body.append(defs(items));
        },
      },
      {
        id: "assumptions",
        label: "Assumptions",
        render(body) {
          const commission = engine?.constants?.CAPESIZE_COMMISSION_PCT;
          const items = [
            { term: "Hedge ratio", desc: "k = 1 (one FFA day per voyage day kept by the owner) unless the out-of-sample ratio is named." },
            { term: "Commission", desc: isNum(commission) ? `${numTrim(commission)} percent total on the Capesize routes (Baltic Guide to Market Benchmarks): the voyage TCE is grossed up by it before it meets the gross 5TC, and the owner hedges the net share.` : "The route's total commission, from data/engine.json." },
            { term: "Curve prints", desc: "The first print of each weekly curve; a curve re-assessed in the next issue is a robustness case (Method and data, robustness)." },
            { term: "Missing months", desc: "A voyage month not printed takes its quarter's price, flagged as a quarter proxy; the robustness table drops those fixtures." },
            { term: "Settlements", desc: "Exact months only in the headline: complete months from the study's own daily series and months whose average Himalaya Shipping published. Estimated months enter only the robustness checks." },
            { term: "Basket", desc: window ? `${capitalise(window)}; a curve dated from ${dateLong(rule.from)} is read on the basket it was printed on.` : "As printed on each curve." },
          ];
          body.append(defs(items));
        },
      },
      {
        id: "data",
        label: "Data",
        render(body) {
          body.append(table({
            caption: "Hedge effectiveness by voyage and horizon",
            label: "Hedge effectiveness table",
            columns: [
              { key: "voyage", label: "Voyage" },
              { label: "Horizon", format: (r) => horizonShort(r.horizon_months) },
              { label: "Fixtures", num: true, format: (r) => num(r.n) },
              { label: "Window", format: (r) => `${dateShort(r.first_fixture)} to ${dateShort(r.last_fixture)}` },
              { label: "Removed, k = 1", num: true, format: (r) => pct(r.effectiveness_k1) },
              { label: "90% interval", num: true, format: (r) => (r.effectiveness_k1_ci ? `${pct(r.effectiveness_k1_ci.low)} to ${pct(r.effectiveness_k1_ci.high)}` : "") },
              { label: "Out of sample k*", num: true, format: (r) => (isNum(r.effectiveness_kstar_oos) ? `${pct(r.effectiveness_kstar_oos)} (n = ${r.n_oos})` : "") },
              { label: "k* in sample", num: true, format: (r) => (isNum(r.k_in_sample) ? num(r.k_in_sample, 3) : "") },
              { label: "SD unhedged, USD a day", num: true, format: (r) => num(r.sd_unhedged_usd_day) },
              { label: "SD hedged, USD a day", num: true, format: (r) => num(r.sd_hedged_usd_day) },
              { label: "Tail risk cut (CVaR)", num: true, format: (r) => pct(r.cvar_reduction_k1) },
            ],
            rows: effs,
          }));
          body.append(table({
            caption: "Where the hedged result's variance comes from (k = 1)",
            label: "Residual decomposition table",
            columns: [
              { key: "voyage", label: "Voyage" },
              { label: "Horizon", format: (r) => horizonShort(r.horizon_months) },
              { label: "Timing share", num: true, format: (r) => pct(r.residual_variance_share?.timing) },
              { label: "Route share", num: true, format: (r) => pct(r.residual_variance_share?.route) },
              { label: "Size share", num: true, format: (r) => pct(r.residual_variance_share?.size) },
              { label: "Mean timing, USD a day", num: true, format: (r) => num(r.residual_mean_usd_day?.timing) },
              { label: "Mean route, USD a day", num: true, format: (r) => num(r.residual_mean_usd_day?.route) },
              { label: "Mean size, USD a day", num: true, format: (r) => num(r.residual_mean_usd_day?.size) },
            ],
            rows: effs,
            note: rule
              ? `Shares are each part's variance plus its covariances with the other parts, so a part can carry a small negative share. Size basis has no variance from ${dateLong(rule.from)}, where the ${num(rule.before)} t basket is the ${num(rule.after)} t one less a fixed differential.`
              : "Shares are each part's variance plus its covariances with the other parts, so a part can carry a small negative share.",
          }));
          body.append(downloadLine([{ file: "hedge_effectiveness.csv" }, { file: "hedge_outcomes.csv", what: "every fixture's surprise and basis parts, no levels" }]));
        },
      },
    ],
  });
  section.append(w.disclosuresEl);
  return { update: w.update };
}

export default {
  id: "overview",
  name: "Overview",
  needs: ["overview", "engine", "method", "manifest"],
  render,
};
