# Design notes: FFA basis and hedging study

The site is a research note a freight desk can use: the answer to the study's question in under a minute,
and a calculator that sizes and stresses a hedge in five. The owner of the series said this study need not
copy the sibling sites' look, so the visual system below is the study's own. The engineering architecture
is the series' (plain HTML, ES modules and CSS, no build step, no CDN, JSON artifacts with a provenance
manifest, a subpath-aware server, screenshots in both themes).

## Principles

1. **One answer per view.** Each of the six views opens with one takeaway sentence and its key chart.
   Everything else waits behind a button: secondary charts sit behind a row of panel buttons, and the
   "Method", "Assumptions" and "Data" sections behind disclosure buttons. Open sections and the chosen
   panel live in the hash, so a link reproduces exactly what the sender saw
   (`#/curve?panel=slope&open=method,data`).
2. **Every figure from an artifact.** No market number is typed into the page. Takeaway sentences and chart
   titles are composed at run time from `data/*.json`; when a field is missing the sentence says so
   instead of inventing a value. Layout and unit constants are the only numeric literals, kept in one
   named object per module and marked `// literal:` for `tools/check-literals.mjs`.
3. **Provenance in the reader's line of sight.** Every chart carries a source line with the retrieval date,
   every dated curve its issue, page and link, every 2026 Capesize level its basket (180,000 t or
   182,000 t, read from `basket_t` or from `engine.json`'s `BASKET_182_FROM` through `engine.js`).
4. **Paper, not a dashboard.** A warm off-white page, ink text, hairline rules, no cards, no shadows, no
   gradients. Colour is reserved for data.
5. **Not a strategy.** The overview and the bias view say in plain words that roll cost and forward bias
   are costs and premiums a hedger faces, not signals.

## Type

Two self-hosted, openly licensed faces (see `vendor/fonts/README.md`):

- **Figtree** (variable, weights 300 to 900): all text, UI, tables, chart text and every number.
  Figtree carries the OpenType `tnum` feature; `font-variant-numeric: tabular-nums` is set on the
  root, so every figure on the site, the hero figure included, uses tabular figures (a hard rule of this
  brief, which overrides the dataviz habit of proportional hero figures).
- **Newsreader** 500: the takeaway sentence that opens each view, and nothing else. A serif headline
  gives the page the register of a research note and separates the answer from the furniture. No mono
  face: Figtree's tabular figures align columns and ticks on their own.

| Step | Use | Face | Size | Line height |
|---|---|---|---|---|
| Takeaway | the sentence that opens a view (h1) | Newsreader 500 | clamp(1.5rem, 1.1rem + 1.6vw, 2.25rem) | 1.2 |
| Hero figure | the overview's headline share | Figtree 600 | clamp(3rem, 2.2rem + 3.5vw, 4.75rem) | 1 |
| Section | h2 inside a view, chart titles | Figtree 600 | 1.125rem | 1.35 |
| Sub-section | h3 in disclosures | Figtree 600 | 1rem | 1.4 |
| Body | prose, table cells | Figtree 400 | 1rem | 1.6 |
| Small | facts' details, legends, captions | Figtree 400 | 0.875rem | 1.5 |
| Ticks | chart axes | Figtree 400 | 12px | 1 |

Sentence case everywhere; no all-caps labels, no eyebrows above headings, no highlighted word in a headline.

## Space and layout

- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 64, 96 (`--s1` to `--s9`).
- Content width: 72rem maximum; prose at 68ch.
- Side gutter: 16px from 320px, 24px from 600px, 40px from 1024px. No horizontal page scroll at any
  width; wide tables scroll inside their own box (`.table-wrap`, keyboard focusable), and a table wider
  than its box fades on the side that has more columns (`scrollCue` in `src/dom.js`), so a phone reader
  sees there is more before trying to scroll.
- Views are one column on phones. From 1024px the hedge lab puts its three steps beside the outputs.
- Touch targets: every button, link in the navigation, radio and input is at least 44px tall.

## Components

- **Header**: the study's name (links to the overview, never wrapped), the six view links with an
  underline under the current view, and the theme toggle. The links are always one row: below 1100px it
  sits under the name and, on phones, scrolls sideways inside its own box with a fade on the side that has
  more and the current view kept in sight, so the first screen of a view reaches its chart; from 1100px
  name, links and toggle share one row. The theme is set on `<html data-theme>` before first paint from
  `localStorage["nc-theme"]`; a stored choice wins, the default is light.
- **Takeaway**: one serif sentence (h1) per view. A visually hidden prefix names the view for screen readers.
- **Facts** (overview): three figures on a hairline-ruled row, each with a label, a value and the detail
  that makes it checkable (measure, n, dates, link). Deliberately unequal widths; no card chrome.
- **Panel buttons**: a row of native buttons (`aria-pressed`) that swap the secondary chart under the key
  chart; the choice is kept in the hash as `panel=`.
- **Disclosure buttons**: native `<button aria-expanded aria-controls>`; the collapsed body is `hidden`
  and `inert`; open sections are kept in the hash as `open=`.
- **The hash is the view's state.** Whenever a view is shown, its panel and open sections are written
  into the hash (each view reports them through `state()`), and a bare link to a view shown before (the
  navigation) brings back the panel, sections and options it was left with.
- **Segmented controls**: native radio inputs in a fieldset, for chart options (curve date, measure, unit,
  range).
- **Tables**: hairline rows, right-aligned tabular figures, units in the header, links in the last column.
  Key columns come first (the figure a reader came for, then the identifiers and counts), so a phone shows
  them without scrolling. A header longer than 12 characters gets a minimum width in proportion to
  its length, so it wraps to about three lines instead of stacking word by word over a narrow column of
  figures.
- **Notes**: a 2px rule on the left and ink-2 text; used for the not-a-strategy note and data caveats.
- **Inputs** (lab): native inputs, 44px high. A value the visitor typed gets a dashed outline and the tag
  "Your figure"; a default carries its source and date beside the field (under it when the row is
  narrow); a missing price is an empty required field. Once a price is typed, the takeaway, the F0 label
  and the source lines say "(with 1 price of yours)".
- **Step-through** (TD3C cases): Previous and Next buttons, a position line ("Case 2 of 5") and one case
  at a time.

## Charts

One approach: hand-drawn SVG in `src/charts.js`, styled through CSS custom properties, so a theme change
never redraws; each chart redraws only when its width changes (ResizeObserver). Every chart has:

- a title that states the takeaway, composed from the data;
- axis titles with units, a legend in words when there is more than one series;
- an `<svg role="img">` with `<title>` and `<desc>` (the text summary), the same summary printed under
  the chart, and the source line with its retrieval date;
- a tooltip on pointer and on keyboard: the plot is a focusable group, arrow keys step through the points,
  Home and End jump to the ends, Escape hides; the tooltip text is mirrored to a polite live region;
- a table twin in the view's "Data" section.

Marks follow the dataviz rules: 2px lines, markers of radius 4 with a 2px surface ring, bars at most 24px
thick, hairline solid gridlines, no dual axes (two units means two charts or a unit switch). Further rules
from the design reviews:

- a line breaks where the data has no observation (a calendar month the curve did not print, a week with
  no TD3C report) instead of joining across it, and the summary says so; quarter tenors are translucent
  spans apart from the month line;
- a category with too few observations to read (a year under 10 weekly curves, a roll-cost year under 6
  contracts) is drawn faint and its label says how many;
- a label that crosses a gridline or the zero line carries a halo in the page colour; on a forest plot
  under 480px each row's label sits above its interval, and a bar chart whose row labels would take more
  than 40 percent of its width puts them above the bars;
- an axis uses one unit for all its ticks (0, 0.5M, 1.0M) and a time axis puts the year on its first tick;
- chart source lines name the documents, never the site's own files or functions; code names appear only
  inside Method sections.

Assumed inputs are drawn dashed and hollow and labelled "Your figure" or "input"; sourced values are solid.
Levels from licensed sources appear only as the artifacts carry them (cited dated curves with issue and
page, monthly aggregates, derived statistics), and those charts say "levels shown only on cited dates".

**Motion**: one orchestrated moment, the cited curve in the Curve view draws once on the first visit of
the page. With `prefers-reduced-motion: reduce` nothing moves at all, and no other element animates or
transitions.

## Data palette

Every colour does one job; the hue follows the meaning across the site. Values were chosen in OKLCH and
validated with the dataviz skill's `validate_palette.js` for each set of colours that share a chart, in
both themes: lightness band, chroma floor, adjacent-pair separation under protanopia and deuteranopia
(OKLab Delta E, target 8), normal-vision floor (15) and contrast. Ratios below are WCAG 2 ratios computed
by a node script against each theme's page background (light `#f7f6f2`, dark `#131518`); marks need 3:1,
text 4.5:1. Data colours never colour text; legends and labels stay in the ink tokens.

| Role | Token | Light | Ratio on light bg | Dark | Ratio on dark bg | Need | Why this colour |
|---|---|---|---|---|---|---|---|
| Spot (Baltic 5TC, TD3C assessment) | `--c-spot` | `#3d4147` | 9.49:1 | `#c3c6cb` | 10.68:1 | 3:1 | Graphite: the physical index is the reference every paper price is measured against, so it reads like ink, neutral and steady. TD3C, a spot assessment, wears it too. |
| FFA (curve, SEC marks, paper leg) | `--c-ffa` | `#2466c3` | 5.16:1 | `#5992e7` | 5.83:1 | 3:1 | Blue, the one saturated cool hue beside graphite: forward prices, quarter-end marks and the paper leg of a hedge are the same instrument everywhere. |
| Contango | `--c-contango` | `#03856a` | 4.25:1 | `#23aa8a` | 6.26:1 | 3:1 | Cool teal pole of the curve-shape pair: forward above spot, a market paying to wait. |
| Backwardation | `--c-backwardation` | `#c14802` | 4.63:1 | `#df6938` | 5.41:1 | 3:1 | Warm vermilion pole: forward below spot, prompt tightness. Opposite temperature to contango so the polarity reads without a legend. |
| Owner (short FFA) | `--c-owner` | `#9575bc` | 3.50:1 | `#854ebd` | 3.33:1 | 3:1 | Violet, lightness-stepped away from the FFA blue it shares the lab chart with (deuteranopia Delta E above 8). |
| Charterer (long FFA) | `--c-charterer` | `#ae7c02` | 3.42:1 | `#bc7d19` | 5.30:1 | 3:1 | Ochre, the far side of the wheel from violet: the two sides of one trade, never good or bad. Also marks the years when the rolling long paid the roll. |
| Timing basis | `--c-timing` | `#ac3273` | 5.62:1 | `#d5679c` | 5.44:1 | 3:1 | Rose: the largest residual part, given the strongest of the three basis hues. |
| Route basis (and TD34) | `--c-route` | `#418032` | 4.46:1 | `#60a750` | 6.22:1 | 3:1 | Green for "another route": a C3 or C5 voyage against the 5TC basket. TD34, the alternative Gulf route outside the Strait, shares it; the two never share a view. |
| Size basis | `--c-size` | `#0897a9` | 3.23:1 | `#067398` | 3.41:1 | 3:1 | Cyan, chosen by search to separate from the route green beside it (deuteranopia Delta E 15.4 light) and from the paper blue in the same waterfall (15.6). |
| Text, primary | `--ink` | `#16181b` | 16.45:1 | `#ecebe7` | 15.33:1 | 4.5:1 | Body text, values, legends. |
| Text, secondary | `--ink-2` | `#43474e` | 8.63:1 | `#c0c3c8` | 10.35:1 | 4.5:1 | Details under facts, notes. |
| Text, muted | `--ink-3` | `#5b5f66` | 5.93:1 | `#9da1a8` | 7.05:1 | 4.5:1 | Tick labels, captions, source lines. |
| Focus ring | `--focus` | `#1f5fd0` | 5.39:1 | `#86b2ff` | 8.56:1 | 3:1 | 2px outline with a 2px offset on every focusable element. |
| Axis and zero line | `--axis` | `#8d8a82` | 3.19:1 | `#6b7079` | 3.67:1 | 3:1 | The zero line carries meaning in diverging charts, so it clears 3:1; gridlines stay recessive hairlines. |

Sets validated together (adjacent pairs unless noted): paper, timing, route, size (the lab's waterfall);
contango, backwardation; owner, charterer; paper with owner; paper with charterer. All pass in both
themes. Owner, charterer and the three basis hues fail an all-pairs test, as five hues must; they never
share a chart.

Styles that are not colours:

- Second print of a curve (29 June 2026): the FFA blue, hollow markers, a thinner line; the legend names
  it and says the study uses the first print.
- Quarter tenors: a horizontal bar across the quarter's three months, so a quarter never looks like a month.
- Quarter proxy in the lab: a hollow blue marker and the tag "quarter proxy".
- Assumed inputs ("Your figure", the visitor's settlement): ink, dashed, hollow square markers. Dashes
  mean "input" and nothing else on the site; computed reference lines (F0, the locked level) are solid.
- Thin-market TD3C weeks: hollow markers on the TD3C line and a hatched band behind the week.
- A week with a curve but no measurable shape, and an estimated settlement month: an outline in `--axis`
  (3.19:1 light, 3.67:1 dark), so the mark clears 3:1 and reads as "not exact". A week with no curve is
  an empty hairline cell, recessive on purpose: it is the absence of data.
- Settlement status in the Method view is ordinal: complete in `--c-spot` (strongest), published in
  `--axis`, estimated as the outline above.
- Bars carry a 4px rounded data end and a square base; stacked segments are separated by a 2px gap in
  the page colour; markers carry a 2px ring in the page colour.

## Judgement calls

- **Views and panels.** The brief lists more charts per view than fit above the fold. Each view shows the
  key chart; the others sit behind panel buttons in the same view (Curve: contango by week, by year and
  month, slope against spot, TD3C strips; Bias and roll: roll cost by year, error statistics; TD3C:
  forward marks, case studies). One secondary chart shows at a time, chosen in the hash (`panel=`).
- **Curve view default date.** The key chart opens on the latest cited curve that carries a same-day
  spot, because "tenors against the same day's spot" is the chart's point; any other cited date is one
  click away and kept in the hash (`date=`).
- **Long tables.** Data tables over about 16 rows show their first rows and a "Show all" button (a
  second level of disclosure inside the Data section). Numeric tables keep each cell on one line and
  scroll sideways inside their own box on phones; text tables (conventions, policy, validation) wrap.
  Lists that would run to dozens of items (every Breakwave print, every BWET mark) are never in a chart
  summary or above a click: the summary gives the range and the latest strip, the Data section the rows.
- **Narrow charts.** Below 640px the calendar strip turns its years into columns, the waterfall puts each
  label above its bar, and value axes keep every gridline but label only what fits (zero always).
  Labels are measured in a hidden SVG with the page's own CSS, tabular figures included.
- **Takeaways and titles are composed, never typed.** Each sentence is built from artifact values with
  simple comparisons (the largest and smallest cell, the share above or below, the sign of a mean, an
  interval that spans zero). When a value is missing the sentence says the data is not in this build.
- **Shares of n.** The artifacts round shares to four decimals; where n is given the site prints
  count / n (47 of 91 is 51.6%, while 0.5165 would print 51.7%).
- **Lab state in the hash.** Role, voyage and start date are read from the hash (`role=`, `voyage=`,
  `start=`) and written to it when the visitor changes them, with the open steps, so a sized hedge can be
  shared as a link. Defaults are not written, so a bare link follows the latest curve. Typed prices, days,
  k and settlements are not stored anywhere.
- **Downloads and the research note** are listed only when a HEAD request finds the file in the build,
  so a file the pipeline has not written never shows as a dead link (a missing file still logs the 404
  in the browser console, which is the honest signal for a broken build).
- **Theme toggle label.** The button names the theme it switches to ("Dark theme" in light mode),
  rather than a pressed state, because most readers expect a theme button to say what it will do.
- **Focus on navigation.** Changing view moves focus to the view's takeaway (for screen readers); the
  heading shows no focus ring because it is not interactive and not in the tab order.
- **Quarter tenors** are drawn as spans over their months, months as points on the curve line, so a
  quarter never pretends to be a month. In the cited curves' tables the months come first, then the
  quarters, each in calendar order, as the broker's page lists them.
- **Basket of pooled statistics.** The hedge sample runs from 2024 to 2026 across both baskets. Where the
  artifact gives no basket field, the site states the rule from `engine.json` (180,000 t before
  `BASKET_182_FROM`, 182,000 t from then), with the basket numbers produced by `engine.js`.
- **Hedge lab horizon.** The horizon that picks the basis bands and the closest historical setups defaults
  to the whole months between the curve's date and the voyage start, rounded down as the study counts its
  horizons and clamped to 1 to 3; the visitor can override it (Capesize only: TD3C has no bands). A start
  before the curve's date gets a warning. Scenario settlements move every month by the same percentage of
  F0; the physical side earns the settlement (no basis), and the bands add the historical residual.
- **One sign for both roles.** Residuals, bands and the closest setups carry one sign: positive means the
  voyage paid more than the price hedged, which is more earnings for an owner and more hire for a
  charterer. Totals in USD are what the role receives, so a charterer's hire and total are negative.
  Ranges are phrased for the role: worst to best case for an owner's total, best to worst case for a
  charterer's hire net of the paper.
- **Route basis net of its average.** The voyage TCEs leave out port charges and the loading time at the
  port's scale, so the level of the route basis is overstated while its spread is not. The lab's bands
  take the route basis net of its average (`route_mean_removed_usd_day`), the closest setups and their
  waterfall are shown on the same footing, and one phrase names it everywhere: "route basis net of its
  average (+N USD a day)". The overview's tail risk (CVaR) is measured the same way and says so.
- **Two tails.** Variance is the same for both sides of a hedge, the tail is not: an owner's worst
  outcomes are the lowest earnings, a charterer's the highest hire. The overview's Data table gives the
  change in 5% CVaR for both ("owner / charterer"), and the hedge lab quotes the one of the role chosen.
- **Gross and net.** F0 and settlements are gross USD a day; locked amounts and totals are net of the
  route's commission and say so; TD3C amounts are gross freight, with no commission taken off.
- **Out of sample against k = 1.** The overview's out-of-sample ratio is measured on later fixtures than
  the whole-sample k = 1, so each diamond has k = 1 on the same fixtures beside it (a small hollow dot), and
  the window and its n are in the tooltip: the gap between the two is the ratio's cost or gain, not a
  change of sample.
- **Two TD3C monthly averages.** The monthly table averages the Baltic's weekly Worldscale prints and
  stays in Worldscale (a dollar figure beside it would state the licensed flat rate); the cases and forward
  errors settle on the average of Breakwave's prints in USD a tonne. Each column header names its method,
  and a month with one print says it settles at its own fixture.
- **TD34's first date.** In Worldscale the weekly chart names the day the Baltic first assessed TD34 and
  the week it closes ("first assessed on 26 March 2026 (week to 27 March)"), the weekday read from the
  report; in TCE it names the first week with a TCE ("TCE first reported 10 July 2026").
- **Every TD3C case is approximate.** Each settles on one or two public prints a month, so all four carry
  the label; "one print: settles at its own fixture" appears only beside a month the data marks as such.
- **TD3C statistics.** The forward errors by horizon are shown with and without the months that hold a
  marked week, labelled approximate; hedge effectiveness is "not computed" until a horizon has 12 contract
  months with two prints, and the cell says how many it has.
- **Percent fields.** Artifact fields named `*_pct` and `*share*` are fractions; the site multiplies by 100.
- **Minus sign.** Negative figures use U+2212 (a minus sign, not a dash) for alignment in tabular figures.
- **No mono face.** Figtree's tabular figures do the job; a third face would add weight for nothing.

## Data fields the site reads beyond the first schema

Requested while the site was built, now delivered by the pipeline and used by the views:

1. `overview.json`: `curve_baskets` on the headline and each effectiveness row (fixtures hedged on 180,000 t and
   182,000 t curves) and `k_window_min_fixtures`, the out-of-sample ratio's minimum window; the Overview states
   both.
2. `lab.json`, `td3c.json`, `method.json`: a `sources_line` each.
3. `manifest.json`: `downloads` (`file`, `description`, `rows`), listed in the Method view.
4. `method.json`: `limitations`, shown as the Method view's Limitations section.
5. `roll.json`: `ci_note` on a bias row whose sample is too short for two bootstrap blocks.
6. `td3c.json`: each case's `mark_source`, `fixture_source` and `settlement_source`, quoted under the case;
   `statement_check`, Breakwave's 7 April 2026 statement against the third quarter's settlement, under the quote;
   `statistics.by_horizon`, `without_thin_weeks`, `counts`, `threshold_months` and `min_prints_for_residual`
   (the approximate statistics table); `monthly[].month_to_date`, `dollar_months[].ended`,
   `cases[].months[].single_print`, `weekly[].thin_reason` and `td34_assessed_day`; `as_of` for the weekly
   source line.
7. `overview.json`: `oos_first_fixture` and `effectiveness_k1_same_rows` (k = 1 on the out-of-sample
   fixtures), `cvar_route_mean_removed_usd_day`, and the charterer's tail (`cvar_reduction_k1_charterer`,
   `cvar_charterer_unhedged_usd_day`, `cvar_charterer_hedged_usd_day`) beside the owner's.
8. `curve.json`: `cited_curves[].spot_sources`, `spot_on` and `spot_kind` (the spot dot's source), and the
   re-prints of every cited curve.
9. `roll.json`: `roll_1m[]` and `roll_quarter[]` `baskets`, `first` and `last` (the basket mix and the
   months of a partial year); `bias[].block`, `block_unit` and the front quarter's (the bootstrap's blocks,
   read from `mean_ci.block` until those fields arrive).
10. `method.json`: `robustness[].note` under the robustness tables; `ederington.pairs_considered`,
    `pairs_dropped` and `pairs_in_2026`; `qc.sec_check[].band` and `direction`, `qc.sec_summary`; the
    `stale_month_labels` quality flag (`months_read_one_month_on`, `quarters_checked` or
    `months_left_out`) and the `previous_column_copied` flag; `coverage.daily_printed_days` and
    `daily_implied_days` beside `daily_days`.
11. `manifest.json`: `sources[].links`, in the Method view's Sources table.
12. `lab.json`: `bands[].route_mean_removed_usd_day`, `history[].curve_basket_t` and `ship_basket_t`.

Still open: the lab has no TD3C basis bands or historical setups (no settled TD3C series in USD a tonne long
enough); the lab says so. The Ederington paragraph can say how many of its pairs use an implied spot level
once `method.json` carries the count (the page reads `ederington.pairs_implied_spot`); until then it names
the rule only.
