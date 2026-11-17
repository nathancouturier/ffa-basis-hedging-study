# Methodology

The rules the study is built by, each with the document it is read from. They were fixed before the results
were computed; where a rule had to change because of what the data turned out to be, the change and its
reason are in the decision record below. Code references point to `src/ffabasis/`.

## 1. Contracts and conventions

| Convention | Rule | Source |
|---|---|---|
| 5TC basket to 24 December 2025 | C5TC = C8_14 x 0.25 + C9_14 x 0.125 + C10_14 x 0.25 + C14 x 0.25 + C16 x 0.125, on the BCI180 ship; every route at 5 percent total commission | Baltic Exchange, Guide to Market Benchmarks (GMB) v7.09, December 2025, printed page 75 |
| 5TC basket from 2 January 2026 | C5TC(182) = C8_182 x 0.15 + C9_182 x 0.125 + C10_182 x 0.35 + C14_182 x 0.25 + C16_182 x 0.125; C5TC(180) = C5TC(182) less USD 3,503 a day, a derived value | GMB v8.8, September 2026, printed page 77 |
| Capesize futures | EEX CPTM (180,000 t) and C5TM (182,000 t): one day a lot, USD a day; the underlying is the arithmetic average of all the Baltic's daily assessments of the month; December's last registration day is 24 December | EEX Contract Specifications for Trade Registration, release 047a (23 July 2026), pages 7 and 8 |
| TD3C | 270,000 t Ras Tanura to Ningbo, laydays 15/30, age 15, 3.75 percent total commission; published in Worldscale (TD3C), USD a tonne (TD3C$) and as a TCE (TD3C-TCE) | GMB v8.8, printed pages 84 and 87 |
| TD3C futures | ICE TDL: 1,000 t a lot, USD a tonne to 0.0001; the average of the Baltic's assessments on each Baltic publication day of the month; December to the 24th | ICE contract specification (retrieved 17 November 2026) |
| Gross against net | A time charter index and its FFA are gross; a voyage TCE is net of commission and is grossed up by it before the comparison; the hedge is the voyage's days times the net share | GMB v8.8, section 7.4.3, pages 35 and 36 |
| Ships | BCI182 from 2 January 2026 (14 kn on 52 t laden and 44 t ballast); BCI180 before (14 kn laden or 15 kn ballast on 62 t; 12 or 13 kn on 43 t); each at its fastest pairs, as voyage-tce-model prices the BCI182 | GMB v8.8 page 78; GMB v7.09 page 76 |
| Cargo | 170,000 t on C3 and C5 in every period (C3 allowed 160,000 or 170,000 t before 2025 and C5 still does): the study's choice | GMB v8.8 page 77; Baltic circular 44/24 |
| Publication days | London business days: weekdays less England and Wales bank holidays (statutory rules and the 2020, 2022 and 2023 proclamations) | `calendar.py`, checked against every complete month of 2026 |

The brief named the 182,000 t contract "C5TCM". EEX's code is C5TM; C5TCM is the data vendor ticker that BDRY's
filings give its 180 kt contract ("Capesize 5TC FFA 180kt Timecharter Average", Amplify Commodity Trust 10-K for
the year to 30 June 2026).

## 2. Data rules

- **First print.** A curve dated D is the one printed in the issue whose current column is D. The next issue's
  previous-week column for D is a later re-assessment (it differs by a median of about 3 percent); it checks the
  first print and serves as the "latest print" of the sensitivity. Gaps over 10 percent are flagged (`panel.py`).
- **One-week moves.** A tenor whose week-on-week change differs from the median change of the curve's other
  tenors by more than 15 percentage points is flagged (the Q2 2023 contract on 11 July 2022, down 25.7 percent
  while the others moved about 2 percent, is one).
- **SEC check.** Each curve within three days of a quarter-end BDRY mark is compared with it on the 180,000 t
  basket; gaps over 10 percent are flagged. Flags never change a value.
- **Repeated pages.** A page whose every tenor shared with the issue before it (at least three) carries the
  identical figure was not updated: Banchero Costa reprinted the previous assessment under new dates (weeks 28 and
  29 of 2025 repeat the curve of 30 June 2025, whose printed premium matches that day's spot). Such a curve is
  flagged and not used, and its previous-week column is not taken as a reprint (`panel.py`). A Breakwave report
  whose side panel repeats the previous report's figures is left out the same way.
- **Stale month labels.** A page that prints a month before its own date carries the previous layout's labels.
  Banchero Costa's quarters are the average of their months to the dollar, so if, read one month on, every quarter
  whose three months are printed equals their average, the months are read one month on; otherwise the page's
  months are left out and its quarters kept. Flagged either way (one page: week 48 of 2024, dated 2 December 2024,
  prints the December to May prices as "Nov-24" to "Apr-25", and its Q1 25 equals the average of the rows labelled
  "Dec-24" to "Feb-25").
- **Baskets.** Before 2 January 2026 every curve and spot print is on 180,000 t. In 2026 a curve is on the basket
  its page labels ("CAPESIZE (182k)") or, unlabelled, the basket its premium column implies (the front month over
  the same day's spot on each basket). A spot print's basket is read from the BCI printed beside it (BCI = 0.11026 x
  the 182,000 t basket, GMB v8.8 page 76; 0.12058 x the 180,000 t one, GMB v7.09 page 75) or from an exact match
  with another print of the same day through the USD 3,503 differential.
- **Quarter proxies.** A voyage month that a curve does not print as a month takes its quarter, flagged; a month
  printed neither way leaves the curve out for that hedge, which then takes the latest curve before it within the
  14 days. Results are reported with and without proxies.
- **Quarters from months.** A quarter that a curve prints only as its three months is priced at their average (a
  quarter is the average of its months: EEX release 047a), in the curve shape, the first-quarter discount, the
  slope and the front-quarter errors.
- **Publication days.** London business days, less the Baltic's closure from 25 December to 1 January, which
  Reuters reports every year it was checked ("will not publish data for the main index from December 25 through
  January 1, 2021"; "observed a week-long holiday from Dec. 25 to Dec. 29, 2023"; "will not be published until
  Jan. 2, 2025"). A broker's Friday column dated inside the closure repeats the last level before it and is not
  a publication day; no fixture falls on such a Friday.
- **Daily 5TC and settlements.** Every public print of a day is pooled (`daily.py`). A Reuters or handybulk print
  also gives its change, so the previous publication day's level; it is used only where that day has no print,
  marked implied, and where both exist they must agree (the chain check). A month's settlement is the average of
  every publication day; it is computed only for a complete month. Otherwise the month takes the average Himalaya
  Shipping published in its SEC filings ("published"); otherwise, for the robustness that admits all months only,
  the average of the days observed when at least four days span the month, one on or before the 10th and one on or
  after the 19th ("estimated"). When a day's prints
  disagree, the value most source families support wins (handybulk, Reuters in any republication, Banchero Costa;
  the level implied by the next day's change counts as support); a tie goes to the value nearest the median of the
  other days within a week. A print that loses implies nothing for the day before.
- **OCR.** Some reports were uploaded with tables in fonts that have no Unicode map. Those tables are read by OCR
  (Tesseract 5 at four times page size, a second reading with a white margin when the first gives no table). The
  text is normalised before it is parsed (long dashes, lone noise glyphs, a hyphenless date, a quarter label read
  as "Qi25", a month label whose first letter the page itself clips, restored from its unique last two letters),
  the tenors have to come in calendar order, and each row is kept only if it reproduces its own printed
  week-on-week change, or, for bunkers, the printed spread between grades.

## 3. Analysis rules

- **Curve shape.** For each curve: front month against the same day's spot on the same basket (spot of the
  Friday before when the Monday has no print); adjacent month and adjacent quarter spreads; contango when the
  later tenor is above the earlier one, backwardation below. Shares by year and calendar month. The first-quarter
  discount: Q1 against Q4 when the curve prices both. Slope: the first full quarter after the front month less the front
  month, in percent of spot, averaged in USD 5,000 bins of the spot level (the weekly spot itself is not published).
- **Forecast error and roll cost.** For each contract month with a settlement and h = 1, 2, 3: the price on the last
  curve of month M - h that prints contract M (a page whose row for M failed its OCR check gives way to the week
  before it); error = settlement - price (positive: a gain to the long, a cost to the short). Mean,
  median, RMSE, share positive; RMSE against the naive forecast (the spot on the pricing date); 90 percent moving
  block bootstrap intervals (block of the horizon in weeks plus four, in months; 2,000 resamples; seed 20261117).
  Roll cost of a rolling long = price paid - settlement, by contract year, in USD a day, percent and per
  ship-year (times 365). The front quarter: bought on the last curve of the month before it starts that prices it,
  held to the average of its three monthly settlements; its bootstrap block is two quarters (the horizon to the
  quarter's last month, 13 weeks, plus four, in quarters).
  The comparison with the naive forecast is made on the contracts that have a spot print on the pricing date, the
  FFA's RMSE recomputed on the same contracts.
- **Hedge effectiveness.** See `hedge.py`: weekly fixtures; the 5TC trip (the C5 voyage's days at the day's 5TC),
  C3 and C5 voyages priced by the vendored engine; hedges placed 1, 2 or 3 months before on the latest curve (no
  older than 14 days) that prices every month of the voyage; U = gross TCE - F0, X = S - F0; effectiveness = 1 - Var(U - kX) / Var(U) at k = 1 and at k*
  estimated only from fixtures settled before the hedge date (at least 52); intervals by moving block bootstrap
  (block of the horizon in weeks plus four, in weeks); 5 percent CVaR of U and U - X for each role (an owner's
  lowest 5 percent of earnings, a charterer's highest 5 percent of hire: the surprise is skewed, so the two
  differ), both with the route basis's mean taken out (its level is overstated by the costs the voyage TCEs leave out, and a constant shift moves a tail
  measure though not a variance); the residual's variance split into route, timing and size basis by
  Cov(part, residual) / Var(residual). For a 2026 voyage hedged on a 2025 curve (180,000 t), the surprise includes
  the fixed USD 3,503 between the ship's basket and the paper's: size basis, a constant. Taking it out of the
  surprise lowers the three-month effectiveness by one to five points (C3 most) and leaves the others nearly
  unchanged.
- **Basis bands in the lab.** The 5th to 95th percentiles of the residual at k = 1 by voyage and horizon, with the
  route basis's mean removed: its level is overstated by the costs the voyage TCEs leave out, its spread is not.
- **Ederington.** Monday to Monday changes of the spot and of the next month's FFA on the same basket, regressed;
  R squared is the variance a hedge at the regression ratio removes (Ederington 1979). A pair needs curves 7 days
  apart with the tenor on both and a spot level on both Mondays (printed, or implied by the next day's printed
  change); the contract is the month after the later Monday's month, so it is never in its own settlement month at
  either end; most pairs before 2026 lack a Monday level, so the
  sample is small and leans on 2026 (the pair accounting is in data/method.json).
- **TD3C.** The weekly record is the Baltic's own weekly tanker report (republished copies are checked against it).
  A week is marked when the Baltic's VLCC paragraph says its Gulf assessment was theoretical or hypothetical or hard
  for its panellists ("mostly theoretical", "an extraordinarily difficult week ... for the Baltic panellists",
  "challenges for the Baltic panellists", "some difficulties in assessing"), or that transits through the Strait of
  Hormuz were extremely limited or blocked; the reason is kept with the week. TD34 is read in Worldscale from its
  first print (the week to 27 March 2026, assessed on Thursdays) and as a TCE from the week to 10 July 2026; a
  level the report gives as a range is recorded at its upper end with the range in the week's note. The next
  report sometimes restates the previous Friday differently (13 March 2026 gives "WS466.67 last Friday" where 6
  March printed WS473.33); each week keeps its own report's figure. USD a tonne = WS / 100 x flat rate; a flat rate is
  never stated: it is implied by dated pairs (Breakwave's dollar print against the Baltic's Worldscale print of the
  nearest earlier assessment, the gap kept) and used for a period only if the pairs agree (interquartile range
  within 2 percent of the median, at least four pairs; 2025 split at 1 July for the Ras Tanura port cost change).
  Case studies hedge one 270,000 t cargo a month at Amplify's quarter-end TD3C marks, the cargo fixed at the month's
  first Breakwave print and the paper settled at the average of the month's prints (approximate). Breakwave's
  statement of 7 April 2026 (third-quarter futures nearly 50 percent below the index) is set against the BWET
  marks of the quarter end before it and against each third-quarter month's settlement estimate. A month is
  estimated only once it has ended. Item 3's statistics for TD3C are reported only where at least 12 contract
  months have a mark and a settlement estimate at the same horizon; the variance a hedge removes needs 12 months
  with at least two prints, since with one print the settlement estimate is the fixture itself and the hedged
  residual is zero by construction.

## 4. What changed while building, and why

- Settlements: the brief expected complete daily months from republished Reuters reports; they cover only part
  of the days before 2026, so published monthly averages (Himalaya Shipping, SEC) fill those months, checked to the
  dollar against every complete month.
- Reprint tolerance: 1 percent was planned; the previous-week column turned out to be a re-assessment that
  differs by a median of 3.1 percent, so the flag threshold is 10 percent and both prints feed the sensitivity.
- TD3C dollars: the flat-rate test fails for 2026 (dollar and Worldscale prints are four days apart in a market
  that moved by a fifth in a week), so 2026 stays in Worldscale and the dollar cases use Breakwave's prints.
- Repeated pages: not foreseen; found when the 2025 issues read by OCR gave identical curves on different dates.
  The rule above was written before the results were recomputed.
- Late 2023 and early 2024 issues print the spot table's dates on the line after the table's name; the parser
  read them from the name's line and dropped those issues whole until the dates were read from the table's first
  "Unit dd-Mon dd-Mon".
- Marked TD3C weeks: the first reading marked only the weeks of "difficulties in assessing" and of blocked
  transits, and recorded 6, 13 and 20 March 2026 as "able to price". Re-read against the rule's own description
  after an independent review, those three reports also call the assessment "mostly theoretical" or the week
  "extraordinarily difficult" or a "challenge" for the panellists, so they are marked as well. The TD3C statistics
  without marked weeks drop the same months as before (March and April 2026).
- TD3C statistics: the first computation counted the month still running (November 2026, one print) as settled
  and let months with a single Breakwave print, whose settlement estimate is the fixture itself, into the variance
  removed (a residual of zero by construction). Both were corrected after a review; the effectiveness is not
  reported, as fewer than 12 months per horizon have two prints, and the error statistics stand on the months
  that have ended.
- A second review of the analysis code found five edge cases, each corrected before the results were recomputed:
  a contract whose row the month's last page lost to the OCR check was left out of the forecast errors instead of
  taking the week before (four contracts, three of them large negative errors); a quarter printed only as its
  three months was not priced (two front quarters, and the slope and first-quarter test on the curves that print
  their next quarter as months); the front quarter's bootstrap counted its block in months on rows that are
  quarters (four quarters instead of two); the calendar took the days between Christmas and New Year as publication
  days, so a broker's repeated Friday column (29 December 2023) became a fixture; and the 2 December 2024 page's
  stale month labels were read as printed. The 5 percent CVaR, measured on the owner's tail only, is now given for
  each role, and the monthly TD3C table keeps Worldscale only (a dollar figure beside the Worldscale average it was
  converted from states the implied flat rate).
- TD34 before July 2026 was printed in Worldscale only; the parser looked for a TCE and missed fourteen weeks
  until it read a Worldscale-only print.
- Daily 5TC: handybulk's March 2024 page carries the report of 4 March 2025 under "5-March-2024", and its
  December 2025 page dates the first week a day late. The pool took handybulk first by fixed priority; it now
  votes by agreement, which restores the Reuters and Banchero Costa values (Ederington's R squared moves from 0.23
  to 0.42 on the corrected March 2024 days; other results move by a few tenths of a point at most).
