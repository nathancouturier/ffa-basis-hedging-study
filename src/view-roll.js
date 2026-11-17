// view-roll.js: forward bias and roll cost. How far each contract's price 1, 2 and 3 months before
// expiry landed from its settlement, and who pays the roll: a rolling long (charterer) or short (owner).

import { h, takeaway, table, note, defs } from "./dom.js";
import { stripChart, hbarChart, empty } from "./charts.js";
import { pct, shareOf, num, signed, signedPct, usdDay, dateLong, dateShort, monthLong, monthShort, plural, listJoin, isNum, capitalise, horizonLabel, signedUsdBig } from "./format.js";
import { wire, sourceLine, downloadLine, basketRule } from "./view-kit.js";

function horizonName(hm) {
  return typeof hm === "number" ? (hm === 1 ? "1 month" : `${hm} months`) : capitalise(String(hm));
}

function errorTip(e) {
  return {
    title: `${monthLong(e.contract)} contract, priced ${dateShort(e.priced_on)}`,
    rows: [
      { key: "ffa", value: `${signed(e.error_usd_day)} USD a day`, label: "settlement minus price" },
      { key: null, value: signedPct(e.error_pct), label: "of the settlement" },
    ],
    note: `${horizonName(e.horizon_months)} before expiry; ${num(e.basket_t)} t basket; settlement ${e.settlement_status === "complete" ? "from the study's complete daily series" : e.settlement_status === "published" ? "published by Himalaya Shipping" : "estimated"}`,
  };
}

function ciText(ci, note) {
  return ci && isNum(ci.low) && isNum(ci.high) ? `${signed(ci.low)} to ${signed(ci.high)}` : note || "no interval (too few observations)";
}

/** The FFA's RMSE against spot's, both on the contracts that have a spot print on the pricing date. */
function naiveText(b) {
  if (!isNum(b.rmse_naive_usd_day)) return "";
  const ffa = isNum(b.rmse_ffa_paired_usd_day) ? b.rmse_ffa_paired_usd_day : b.rmse_usd_day;
  return `on the ${plural(b.n_naive ?? b.n, "contract", "contracts")} with a spot print, RMSE ${num(ffa)} against ${num(b.rmse_naive_usd_day)} for spot`;
}

function biasTip(b) {
  return {
    title: `${horizonName(b.horizon_months)} before expiry, ${plural(b.n, "contract", "contracts")}`,
    rows: [
      { key: "ink", value: `${signed(b.mean_usd_day)} USD a day`, label: "mean error" },
      { key: null, value: ciText(b.mean_ci, b.ci_note), label: "90 percent interval" },
      { key: null, value: signed(b.median_usd_day), label: "median" },
      { key: null, value: num(b.rmse_usd_day), label: `RMSE${isNum(b.rmse_ratio_ffa_to_naive) ? `, ${num(b.rmse_ratio_ffa_to_naive, 2)} of spot's as a forecast` : ""}` },
    ],
    note: `${shareOf(b.share_positive, b.n)} of contracts settled above their price; ${monthShort(b.first)} to ${monthShort(b.last)}`,
  };
}

function basketCounts(errors) {
  const counts = new Map();
  for (const e of errors) if (isNum(e.basket_t)) counts.set(e.basket_t, (counts.get(e.basket_t) || 0) + 1);
  const parts = [...counts.entries()].sort((x, y) => x[0] - y[0]).map(([t, n]) => `${plural(n, "error", "errors")} on the ${num(t)} t basket`);
  return parts.length ? listJoin(parts) : "";
}

function signNote(rows) {
  const pos = rows.filter((r) => r.roll_cost_usd_day > 0).length;
  const neg = rows.filter((r) => r.roll_cost_usd_day < 0).length;
  if (pos && neg) return `the long paid in ${plural(pos, "strategy-year", "strategy-years")} and earned in ${plural(neg, "strategy-year", "strategy-years")}`;
  return `the sign is the same in all ${plural(rows.length, "strategy-year", "strategy-years")} so far, on samples this small`;
}

function render(section, ctx) {
  const { roll, engine } = ctx.data;
  const bias = (roll.bias || []).slice().sort((a, b) => a.horizon_months - b.horizon_months);
  const qb = roll.quarter_bias;
  const one = bias.find((b) => b.horizon_months === 1) || bias[0];

  // ---------------------------------------------------------- takeaway
  let sentence = "The forecast errors are not in this build of the data.";
  if (one && isNum(one.mean_usd_day)) {
    const above = one.mean_usd_day > 0;
    const ci = one.mean_ci;
    const spansZero = ci && ci.low < 0 && ci.high > 0;
    sentence = `On average the 5TC settled ${usdDay(Math.abs(one.mean_usd_day))} ${above ? "above" : "below"} the FFA price ${horizonLabel(one.horizon_months)} before expiry${ci && isNum(ci.low) ? ` (90 percent interval ${signed(ci.low)} to ${signed(ci.high)})` : ""}: a rolling charterer ${above ? "earned" : "paid"} that gap and a rolling owner ${above ? "gave it up" : "earned it"}${spansZero ? ", though the interval includes zero" : ""}.`;
  }
  section.append(takeaway("Bias and roll", sentence));
  const variants = Object.fromEntries((ctx.data.method?.robustness || []).map((v) => [v.key, (v.bias || {})[String(one?.horizon_months)] || null]));
  const latest = variants.latest_print;
  const first = variants.headline;
  if (one && latest && first && isNum(latest.mean_usd_day) && isNum(first.mean_usd_day) && latest.mean_usd_day !== first.mean_usd_day) {
    const closer = isNum(latest.rmse_usd_day) && isNum(first.rmse_usd_day) && latest.rmse_usd_day < first.rmse_usd_day;
    section.append(h("p", { class: "lede" }, `The figure depends on which print of the curve is used. The study uses each curve's first print, the price a hedger had on the date; the same curve as the next issue re-assesses it a week later gives a mean of ${signed(latest.mean_usd_day)} USD a day${closer ? ` and sits closer to the settlement (RMSE ${num(latest.rmse_usd_day)} against ${num(first.rmse_usd_day)}), as a later price would` : ""}.`));
  }

  // ---------------------------------------------------------- key chart
  const key = h("div");
  section.append(key);
  const errors = roll.errors || [];
  if (bias.length) {
    const cats = bias.map((b) => ({
      key: String(b.horizon_months),
      label: horizonName(b.horizon_months),
      short: `${b.horizon_months} m`,
      sub: `n = ${b.n}`,
      subShort: String(b.n),
      points: errors.filter((e) => e.horizon_months === b.horizon_months).map((e) => ({ y: e.error_usd_day, hollow: e.settlement_status !== "complete", tip: errorTip(e) })),
      mean: b.mean_usd_day,
      lo: b.mean_ci?.low,
      hi: b.mean_ci?.high,
      tip: biasTip(b),
    }));
    if (qb && isNum(qb.mean_usd_day)) {
      cats.push({ key: "q", label: "Front quarter", short: "Quarter", sub: `n = ${qb.n}`, subShort: String(qb.n), points: [], mean: qb.mean_usd_day, lo: qb.mean_ci?.low, hi: qb.mean_ci?.high, tip: biasTip(qb) });
    }
    const ratios = bias.filter((b) => isNum(b.rmse_ratio_ffa_to_naive));
    const allBetter = ratios.length && ratios.every((b) => b.rmse_ratio_ffa_to_naive < 1);
    const title = `Mean error ${listJoin(bias.map((b) => signed(b.mean_usd_day)))} USD a day at ${listJoin(bias.map((b) => String(b.horizon_months)))} months${ratios.length ? `; the FFA's RMSE was ${listJoin(ratios.map((b) => num(b.rmse_ratio_ffa_to_naive, 2)))} of spot's as a forecast${allBetter ? ", better at every horizon" : ""}` : ""}`;
    stripChart(key, {
      title,
      subtitle: `Error = settlement minus the FFA price paid that many months before expiry, USD a day, one dot per contract month; the black bar is the mean with its 90 percent interval (moving block bootstrap). Positive: the contract settled above its price. Each contract on the basket its curve was printed on: ${basketCounts(errors) || "as printed"}.`,
      legend: [
        { label: "Settled on the study's complete daily series", cls: "ffa", kind: "dot" },
        { label: "Settled at Himalaya Shipping's published average", cls: "ffa", kind: "hollow" },
        { label: "Mean and 90 percent interval", cls: "ink", kind: "line" },
      ],
      cats,
      y: { title: "Settlement minus price, USD a day", format: (v) => signed(v) },
      summary: `${bias.map((b) => `${horizonName(b.horizon_months)}: mean ${signed(b.mean_usd_day)} USD a day (90 percent interval ${ciText(b.mean_ci)}), median ${signed(b.median_usd_day)}, ${shareOf(b.share_positive, b.n)} positive of ${b.n}, RMSE ${num(b.rmse_usd_day)}${naiveText(b) ? `; ${naiveText(b)}` : ""}`).join("; ")}.${qb ? ` Front quarter: mean ${signed(qb.mean_usd_day)} (${ciText(qb.mean_ci, qb.ci_note)}), ${plural(qb.n, "quarter", "quarters")}, ${monthShort(qb.first)} to ${monthShort(qb.last)}.` : ""} Contracts ${monthShort(one.first)} to ${monthShort(one.last)}.`,
      source: sourceLine(roll, "Banchero Costa weekly FFA assessments; monthly 5TC settlements."),
    });
  } else empty(key, { title: "Forecast errors", text: "roll.json carries no bias rows in this build." });

  // -------------------------------------------------------------- panels
  const panels = [
    {
      id: "cost",
      label: "Roll cost by year",
      render(body) {
        const groups = [];
        const row = (r) => ({
          label: String(r.year),
          value: r.roll_cost_usd_day,
          cls: r.roll_cost_usd_day > 0 ? "charterer" : "owner",
          valueLabel: signed(r.roll_cost_usd_day),
          tip: {
            title: `${r.year}, ${plural(r.n, "contract", "contracts")}`,
            rows: [
              { key: r.roll_cost_usd_day > 0 ? "charterer" : "owner", value: `${signed(r.roll_cost_usd_day)} USD a day`, label: r.roll_cost_usd_day > 0 ? "paid by the long (charterer), earned by the short (owner)" : "paid by the short (owner), earned by the long (charterer)" },
              { key: null, value: signedPct(r.roll_cost_pct), label: "of the settlement" },
              { key: null, value: signedUsdBig(r.ship_year_usd), label: "a ship-year" },
              { key: null, value: num(r.n), label: r.n === 1 ? "contract" : "contracts" },
            ],
            note: r.statuses?.length ? `Settlements: ${listJoin(r.statuses)}` : "Quarter settlements from monthly averages",
          },
        });
        if ((roll.roll_1m || []).length) groups.push({ label: "Rolling one-month long", rows: roll.roll_1m.map(row) });
        if ((roll.roll_quarter || []).length) groups.push({ label: "Rolling front-quarter long", rows: roll.roll_quarter.map(row) });
        if (!groups.length) {
          empty(body, { title: "Roll cost by year", text: "roll.json carries no roll cost rows in this build." });
          return;
        }
        const m1 = roll.roll_1m || [];
        const paid = m1.filter((r) => r.roll_cost_usd_day > 0);
        const earned = m1.filter((r) => r.roll_cost_usd_day < 0);
        const parts = [];
        if (paid.length) parts.push(`paid ${listJoin(paid.map((r) => `USD ${num(r.roll_cost_usd_day)} a day in ${r.year}`))}`);
        if (earned.length) parts.push(`earned ${listJoin(earned.map((r) => `USD ${num(-r.roll_cost_usd_day)} a day in ${r.year}`))}`);
        const box = h("div");
        body.append(box);
        hbarChart(box, {
          title: parts.length ? `A charterer rolling one-month longs ${parts.join(" and ")}` : "Roll cost by year",
          subtitle: `Roll cost = price paid minus settlement, averaged over the year's contracts, USD a day, each contract on the basket its curve was printed on (${basketCounts(errors.filter((e) => e.horizon_months === 1)) || "as printed"} at one month). The percent of settlement, the cost per ship-year and the number of contracts are in the table below.`,
          legend: [
            { label: "The long (charterer) pays, the short (owner) earns", cls: "charterer", kind: "rect" },
            { label: "The short (owner) pays, the long (charterer) earns", cls: "owner", kind: "rect" },
          ],
          sides: { neg: "Owner pays", pos: "Charterer pays" },
          groups,
          x: { title: "Roll cost of a rolling long, USD a day", format: (v) => signed(v) },
          summary: [...(roll.roll_1m || []).map((r) => ["Rolling one-month long", r]), ...(roll.roll_quarter || []).map((r) => ["Rolling front-quarter long", r])].map(([g, r]) => `${g}, ${r.year}: ${signed(r.roll_cost_usd_day)} USD a day (${signedPct(r.roll_cost_pct)} of settlement, ${plural(r.n, "contract", "contracts")})`).join("; ") + ". A positive cost is paid by the rolling long and earned by the short.",
          source: sourceLine(roll, "Banchero Costa weekly FFA assessments; monthly 5TC settlements."),
        });
        const costRows = [...(roll.roll_1m || []).map((r) => ({ ...r, strategy: "Rolling one-month long" })), ...(roll.roll_quarter || []).map((r) => ({ ...r, strategy: "Rolling front-quarter long" }))];
        body.append(table({
          caption: "Roll cost by year",
          columns: [
            { label: "Strategy", format: (r) => r.strategy },
            { label: "Year", format: (r) => String(r.year) },
            { label: "Contracts", num: true, format: (r) => num(r.n) },
            { label: "USD a day", num: true, format: (r) => signed(r.roll_cost_usd_day) },
            { label: "% of settlement", num: true, format: (r) => signedPct(r.roll_cost_pct) },
            { label: "USD a ship-year", num: true, format: (r) => signed(r.ship_year_usd) },
            { label: "Who pays", format: (r) => (r.roll_cost_usd_day > 0 ? "Charterer (long)" : r.roll_cost_usd_day < 0 ? "Owner (short)" : "Neither") },
            { label: "Settlements", format: (r) => (r.statuses?.length ? listJoin(r.statuses) : "") },
          ],
          rows: costRows,
          note: "A ship-year is the daily cost over a year of days.",
        }));
        body.append(h("div", { class: "prose" },
          h("h3", {}, "Who pays the roll"),
          h("p", {}, "Error is the settlement minus the price paid. A hedger who buys the contract ahead of expiry, holds it to settlement and repeats (a charterer covering future hire) pays the roll cost when the curve sat above where the months settled; the owner who sells the same paper earns it. When the curve sat below the settlement, the long earns and the short pays."),
          h("p", {}, `Roll cost is the price paid minus the settlement, so a positive figure is a cost to the long. A ship-year is that cost a day over a year of days. These are costs and premiums a hedger faces, not returns to chase: ${signNote(costRows)}, and the intervals in the key chart show how wide the uncertainty is.`)));
      },
    },
    {
      id: "stats",
      label: "Error statistics",
      render(body) {
        const rows = [...bias, ...(qb ? [qb] : [])];
        body.append(table({
          caption: "Forecast errors by horizon (settlement minus price, USD a day)",
          columns: [
            { label: "Horizon", format: (b) => horizonName(b.horizon_months) },
            { label: "Contracts", num: true, format: (b) => num(b.n) },
            { label: "From", format: (b) => monthShort(b.first) },
            { label: "To", format: (b) => monthShort(b.last) },
            { label: "Mean", num: true, format: (b) => signed(b.mean_usd_day) },
            { label: "90% interval", num: true, format: (b) => ciText(b.mean_ci, b.ci_note) },
            { label: "Mean, % of settlement", num: true, format: (b) => signedPct(b.mean_pct) },
            { label: "Median", num: true, format: (b) => signed(b.median_usd_day) },
            { label: "RMSE", num: true, format: (b) => num(b.rmse_usd_day) },
            { label: "RMSE interval", num: true, format: (b) => (b.rmse_ci && isNum(b.rmse_ci.low) ? `${num(b.rmse_ci.low)} to ${num(b.rmse_ci.high)}` : "none") },
            { label: "Contracts with spot", num: true, format: (b) => (isNum(b.n_naive) ? num(b.n_naive) : "") },
            { label: "FFA's RMSE on them", num: true, format: (b) => (isNum(b.rmse_ffa_paired_usd_day) ? num(b.rmse_ffa_paired_usd_day) : "") },
            { label: "Spot's RMSE", num: true, format: (b) => (isNum(b.rmse_naive_usd_day) ? num(b.rmse_naive_usd_day) : "") },
            { label: "FFA / spot", num: true, format: (b) => (isNum(b.rmse_ratio_ffa_to_naive) ? num(b.rmse_ratio_ffa_to_naive, 3) : "") },
            { label: "Positive", num: true, format: (b) => shareOf(b.share_positive, b.n) },
          ],
          rows,
          note: "Spot's RMSE: the error of using the spot on the pricing date (or the Friday before) as the forecast of the settlement, on the contracts that have one. A ratio below 1 means the FFA forecast better.",
        }));
      },
    },
  ];

  // --------------------------------------------------------- disclosures
  const rule = basketRule(engine);
  const formulas = Object.fromEntries((ctx.data.method?.formulas || []).map((f) => [f.name, f.text]));
  const w = wire(ctx, "roll", {
    panels,
    sections: [
      {
        id: "method",
        label: "Method",
        render(body) {
          body.append(defs([
            { term: "Error", desc: formulas["Forecast error"] || "error = S minus F(h months before expiry); roll cost of a rolling long = F minus S." },
            { term: "Price at a horizon", desc: "The month's price on the last weekly curve printed at least h months before its expiry; the front quarter uses the quarter's price on the curve before the quarter starts." },
            { term: "Settlement", desc: formulas.Settlement || "The average of the Baltic's assessments on every publication day of the month." },
            { term: "Intervals", desc: `Moving block bootstrap of the mean and the RMSE, ${bias[0]?.mean_ci ? `blocks of ${listJoin(bias.map((b) => `${b.mean_ci.block} at ${horizonName(b.horizon_months)}`))}` : "with blocks that grow with the horizon"}, fixed seed.` },
            { term: "Spot as a forecast", desc: "The naive forecast of a contract's settlement is the spot on the day the price was taken; RMSE against it tells whether the curve carried information." },
            { term: "Roll cost by year", desc: "The average of (price paid minus settlement) over the year's contracts, in USD a day and as a percent of settlement; a ship-year multiplies the daily cost by a year of days." },
          ]));
        },
      },
      {
        id: "assumptions",
        label: "Assumptions",
        render(body) {
          body.append(defs([
            { term: "Exact months", desc: "Errors use contracts whose month settled exactly: complete in the study's own daily series, or published by Himalaya Shipping in its monthly commercial updates (SEC 6-K exhibits). Estimated months enter only the robustness table (Method and data)." },
            { term: "Basket", desc: `Each contract on the basket its curve was printed on${basketCounts(errors) ? `: ${basketCounts(errors)}` : ""}; the per-contract table states it.${rule ? ` The ${num(rule.after)} t basket exists from ${dateLong(rule.from)}.` : ""}` },
            { term: "First print", desc: "Each week's curve as first printed; the latest print is a robustness case." },
            { term: "Small samples", desc: "Two years of weekly curves give a few dozen contract months per horizon and a handful of quarters; read the intervals before the means." },
          ]));
        },
      },
      {
        id: "data",
        label: "Data",
        render(body) {
          body.append(table({
            caption: "Errors by contract",
            limit: 16,
            columns: [
              { label: "Contract", format: (e) => monthShort(e.contract) },
              { label: "Horizon", format: (e) => horizonName(e.horizon_months) },
              { label: "Priced on", format: (e) => dateShort(e.priced_on) },
              { label: "Basket, t", num: true, format: (e) => num(e.basket_t) },
              { label: "Settlement minus price, USD a day", num: true, format: (e) => signed(e.error_usd_day) },
              { label: "% of settlement", num: true, format: (e) => signedPct(e.error_pct) },
              { label: "Settlement", format: (e) => e.settlement_status },
            ],
            rows: errors.slice().sort((a, b) => (a.contract < b.contract ? -1 : a.contract > b.contract ? 1 : a.horizon_months - b.horizon_months)),
          }));
          const settlements = (roll.settlements || []).slice().sort((a, b) => (a.month < b.month ? 1 : -1));
          body.append(table({
            caption: "Monthly 5TC settlements",
            limit: 16,
            columns: [
              { label: "Month", format: (r) => monthShort(r.month) },
              { label: "Status", format: (r) => r.status },
              { label: rule ? `USD a day, ${num(rule.before)} t` : "USD a day, first basket", num: true, format: (r) => (isNum(r.usd_day_180) ? num(r.usd_day_180) : "") },
              { label: rule ? `USD a day, ${num(rule.after)} t` : "USD a day, second basket", num: true, format: (r) => (isNum(r.usd_day_182) ? num(r.usd_day_182) : "") },
              { label: "Days observed", num: true, format: (r) => pct(r.coverage, 0) },
              { label: "Published", format: (r) => (r.published_url ? h("a", { href: r.published_url }, "6-K exhibit") : "") },
            ],
            rows: settlements,
            note: "Complete: every London publication day in the study's own daily series. Published: the month's average as Himalaya Shipping published it (SEC 6-K). Estimated: the average of the days observed, labelled with that coverage, never used as a settlement in the headline.",
          }));
          body.append(downloadLine([{ file: "forecast_errors.csv" }, { file: "roll_cost_by_year.csv" }, { file: "monthly_settlements_5tc.csv" }]));
        },
      },
    ],
  });
  section.append(note(h("strong", {}, "Costs a hedger faces, not a strategy. "), "Forward bias and roll cost tell a desk what rolling a hedge has cost, by year and horizon. They are reported whatever their sign and are not a signal to trade."));
  if (w.panelsEl) section.append(w.panelsEl);
  section.append(w.disclosuresEl);
  return { update: w.update };
}

export default {
  id: "roll",
  name: "Bias and roll",
  needs: ["roll", "engine", "method"],
  render,
};
