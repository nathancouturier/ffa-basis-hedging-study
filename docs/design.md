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
  width; wide tables scroll inside their own box (`.table-wrap`, keyboard focusable).
- Views are one column on phones. From 1024px the hedge lab puts its three steps beside the outputs.
- Touch targets: every button, link in the navigation, radio and input is at least 44px tall.

## Components

- **Header**: the study's name (links to the overview), the six view links (a two-column grid on phones,
  one row from 900px) with an underline under the current view, and the theme toggle. The theme is set on
  `<html data-theme>` before first paint from `localStorage["nc-theme"]`; a stored choice wins, the
  default is light.
- **Takeaway**: one serif sentence (h1) per view. A visually hidden prefix names the view for screen readers.
- **Facts** (overview): three figures on a hairline-ruled row, each with a label, a value and the detail
  that makes it checkable (measure, n, dates, link). Deliberately unequal widths; no card chrome.
- **Panel buttons**: a row of native buttons (`aria-pressed`) that swap the secondary chart under the key
  chart; the choice is kept in the hash as `panel=`.
- **Disclosure buttons**: native `<button aria-expanded aria-controls>`; the collapsed body is `hidden`
  and `inert`; open sections are kept in the hash as `open=`.
- **Segmented controls**: native radio inputs in a fieldset, for chart options (curve date, measure, unit,
  range).
- **Tables**: hairline rows, right-aligned tabular figures, units in the header, links in the last column.
- **Notes**: a 2px rule on the left and ink-2 text; used for the not-a-strategy note and data caveats.
- **Inputs** (lab): native inputs, 44px high. A value the visitor typed gets a dashed outline and the tag
  "Your figure"; a default carries its source and date beside the field; a missing price is an empty
  required field.
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
thick, hairline solid gridlines, no dual axes (two units means two charts or a unit switch). Assumed
inputs are drawn dashed and hollow and labelled "Your figure" or "input"; sourced values are solid.
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
- **Narrow charts.** Below 640px the calendar strip turns its years into columns, the waterfall puts each
  label above its bar, and value axes keep every gridline but label only what fits (zero always).
  Labels are measured in a hidden SVG with the page's own CSS, tabular figures included.
- **Takeaways and titles are composed, never typed.** Each sentence is built from artifact values with
  simple comparisons (the largest and smallest cell, the share above or below, the sign of a mean, an
  interval that spans zero). When a value is missing the sentence says the data is not in this build.
- **Shares of n.** The artifacts round shares to four decimals; where n is given the site prints
  count / n (47 of 91 is 51.6%, while 0.5165 would print 51.7%).
- **Lab state in the hash.** Role, voyage and start date are kept in the hash (`role=`, `voyage=`,
  `start=`), with the open steps, so a sized hedge can be shared as a link. Typed prices, days, k and
  settlements are not stored anywhere.
- **Downloads and the research note** are listed only when a HEAD request finds the file in the build,
  so a file the pipeline has not written never shows as a dead link (a missing file still logs the 404
  in the browser console, which is the honest signal for a broken build).
- **Theme toggle label.** The button names the theme it switches to ("Dark theme" in light mode),
  rather than a pressed state, because most readers expect a theme button to say what it will do.
- **Focus on navigation.** Changing view moves focus to the view's takeaway (for screen readers); the
  heading shows no focus ring because it is not interactive and not in the tab order.
- **Quarter tenors** are drawn as spans over their months, months as points on the curve line, so a
  quarter never pretends to be a month.
- **Basket of pooled statistics.** The hedge sample runs from 2024 to 2026 across both baskets. Where the
  artifact gives no basket field, the site states the rule from `engine.json` (180,000 t before
  `BASKET_182_FROM`, 182,000 t from then), with the basket numbers produced by `engine.js`.
- **Hedge lab horizon.** The horizon that picks the basis bands and the closest historical setups defaults
  to the whole months between the curve's date and the voyage start, clamped to 1 to 3, and the visitor
  can override it. Scenario settlements move every month by the same percentage of F0; the physical side
  earns the settlement (no basis), and the bands add the historical residual.
- **Charterer's view.** The lab's historical outcomes are stored from the owner's side; for a charterer
  the site reverses their signs and says so.
- **Percent fields.** Artifact fields named `*_pct` and `*share*` are fractions; the site multiplies by 100.
- **Minus sign.** Negative figures use U+2212 (a minus sign, not a dash) for alignment in tabular figures.
- **No mono face.** Figtree's tabular figures do the job; a third face would add weight for nothing.

## Requests to the data owner

The site renders without each of these and says what is missing; it uses each field as soon as it appears.

1. `overview.json`: a basket field for the headline and each effectiveness row (the sample spans
   180,000 t and 182,000 t). Today the site states the rule from `engine.json` and `engine.js`.
2. `overview.json`: the minimum window of the out-of-sample minimum variance ratio (for example
   `k_window_min_weeks`), so the site can state it from data instead of "an expanding window of past
   fixtures".
3. `overview.json`: an earlier build had the C3 three-month interval outside its point estimate; the
   current build does not. The site still prints a note for any cell whose percentile interval excludes
   its estimate; if that recurs, consider a bias-corrected interval.
4. `lab.json`: TD3C has no basis bands or historical setups. Add them when a settled TD3C series in USD a
   tonne exists; the lab says so meanwhile.
5. `lab.json`, `td3c.json`, `method.json`: a `sources_line` like the overview, curve and roll artifacts.
   The site composes one from each artifact's own fields and the manifest's retrieval dates.
6. `manifest.json`: a `downloads` list (`file`, `description`, `rows`). The site lists the seven CSVs in
   `data/downloads/` from its own descriptions until then, each shown only if the file exists.
7. `method.json`: a `limitations` list. The Method view adds a Limitations section when it is present.
8. `roll.json`: `quarter_bias.mean_ci` is null (six quarters). The site prints "no interval"; if a block
   bootstrap on so few quarters is not meaningful, say so in a field (for example `ci_note`).
9. `td3c.json` `cases`: the step-through renders the four cases from the schema in the brief. Each case
   settles on a single Breakwave print, which the site labels approximate from `prints`; a case field
   naming the settlement source would let the label quote it.
10. Delivered while the site was built and now used: `td3c.json` `cases`, `breakwave_statement` and
    `statistics`; `method.json` `hedge_by_year` (robustness by calendar year); the same-day spot on the
    8 November 2026 cited curve; the research note PDF at the repository root.
