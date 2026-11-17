# Data audit

Every source the study reads, as probed from the build environment on 17 November 2026: the endpoint, what it
covers, its units, its terms, a sample, and what the repository keeps of it. `data/raw/manifest.json` lists every
downloaded document with its URL, retrieval time (UTC), sha256 and size; the documents themselves stay out of git
(`data/raw/` is ignored) and `make data` fetches them again from those URLs. The fetcher reads each host's
robots.txt, obeys its rules and crawl delay (30 seconds for Hellenic Shipping News, at least 2 seconds everywhere),
names the project in its User-Agent and sends SEC EDGAR the contact its fair access policy asks for (from the
environment variable `SEC_USER_AGENT`, never written to a file).

## Sources the pipeline fetches

| Source | Endpoint | Coverage and units | Terms and what is kept | Sample |
|---|---|---|---|---|
| Banchero Costa weekly market report, as republished by Hellenic Shipping News | listing: `https://www.hellenicshippingnews.com/wp-json/wp/v2/media?search=bancosta`; files: `.../wp-content/uploads/YYYY/MM/Bancosta-Weekly-YYYY-WW.pdf` | Capesize FFA assessments (current month, next months, three or four quarters; two Mondays), BCI TC average, C3 and C5 (two Fridays), IFO380, VLSFO and LSMGO at Rotterdam, Fujairah and Singapore; USD a day, USD a tonne. The FFA page first appears in the issues HSN holds in week 1 of 2021 (HSN holds no 2020 issue; the 2019 issues have no FFA page) | Copyright of Banchero Costa: the extracted panel stays in the ignored cache; committed are derived statistics and the dated curves of the validation weeks and the latest week, cited with issue and page | week 27 of 2022, Capesize FFA of 11 July: Jul-22 22,764, Q2 23 17,271 (previous week 23,240) USD a day |
| Baltic Exchange weekly reports | `https://www.balticexchange.com/en/data-services/WeeklyRoundup/tanker/news/YYYY/tanker-report-week-N.html` and `.../dry/news/YYYY/bulk-report-week-N.html` | TD3C (and TD34 from its trial) in Worldscale points and as a round-trip TCE, weekly, 2023 to 2026; the Capesize week in words | Baltic copyright: each weekly TD3C and TD34 print is committed as an individually cited figure with its link | week to 9 October 2026: TD3C WS1,318.75, TCE USD 1,412,594 a day; TD34 WS841.07, USD 912,660 |
| Reuters' daily dry bulk report as republished | Hellenic Shipping News and Cyprus Shipping News posts (`/wp-json/wp/v2/posts?search=...` with their text); MarineLink (`/news/sitemaparchive/YYYYMM` and each article); Maritime Professional (the 29 July 2026 anchor) | the day's capesize 5TC and its change (USD a day), the capesize index | Copyright of the publishers: daily prints stay in the cache; they enter only monthly averages | 29 July 2026: "fell $664 to $33,384" (180,000 t; the BCI of 4,067 is the 182,000 t basket's) |
| handybulk.com Baltic Dry Index archive | `https://www.handybulk.com/baltic-dry-index/YYYY/month/` | daily capesize earnings (the 5TC) and BCI points; every publication day from January to October 2026, a few days a month before | robots.txt allows all and signals `use=reference, ai-train=no`: daily prints stay in the cache | 31 July 2026: BCI 4,296 points, earnings USD 38,960 (182,000 t, since 0.11026 x 38,960 = 4,296) |
| Amplify Commodity Trust (BDRY, BWET), SEC EDGAR | `https://data.sec.gov/submissions/CIK0001610940.json`; each 10-Q and 10-K under `https://www.sec.gov/Archives/edgar/data/1610940/` | every freight future held at each quarter end: contracts and notional; price = notional / contracts (one day a lot, 1,000 t for TD3C) | Public record: every mark committed with its filing's link (`data/public/sec_marks.json`) | 30 September 2025: BDRY Capesize October 2025, 275 contracts, USD 6,837,600, so USD 24,864 a day |
| Himalaya Shipping Ltd. 6-K exhibits, SEC EDGAR | full-text search `https://efts.sec.gov/LATEST/search-index?q=...&forms=6-K`; each exhibit under `https://www.sec.gov/Archives/edgar/data/1959455/` | the month's average of the Baltic 5TC (180,000 t), May 2023 to October 2026 | Public record: committed with links (`data/public/himalaya_5tc.json`) | filed 8 July 2026: "The Baltic 5TC 180 Capesize Index averaged US$35,414 during June 2026" |
| Breakwave Advisors bi-weekly tanker report, via HSN | `.../wp-content/uploads/YYYY/MM/BreakwaveTankers<Month><D><YYYY>Report.pdf`; the 7 April 2026 insight at `breakwaveadvisors.com/insights/tanker4726` | TD3C in USD a tonne ("VLCC Middle East-Asia Spot Rates") and the Breakwave Tanker Futures Index, July 2023 to November 2026 | Breakwave's copyright: each print committed as a cited point with its report's link | 21 October 2025: 20.73 USD a tonne, index 1,658 |
| The Edge Malaysia, "Baltic Exchange shipping updates" | addresses in `data/seed/edge_weekly_reports.json` (found by searching the title; no sitemap) | the Baltic's weekly report republished: a cross-check of the TD3C prints | Copyright of the publisher: cached, used to check | week to 13 November 2026: TD3C WS1,014.38, USD 1,078,714 |
| Amplify ETFs holdings pages | `https://amplifyetfs.com/BDRY-holdings/`, `/BWET-holdings/`, rendered in a browser | the funds' current freight futures and as-of date | The funds' public disclosure: one snapshot per refresh in `data/public/amplify_holdings.json` | none yet: the pages draw their tables with scripts from www.gstatic.com, which the build environment's proxy refuses; the first snapshot comes from the scheduled refresh |
| The rule books | Baltic GMB v8.8 (current address) and v7.09 (the guide's former address), the TD3C TCE note (July 2017), the Baltic Investor Indices white paper (2024), EEX release 047a, the ICE TDL specification, EIA Today in Energy (26 March 2026) | conventions, baskets, ships, settlement rules | Cited with page; not redistributed | GMB v8.8 printed page 77: "C5TC(180) ... Derived Value: C5TC(182)-3,503" |

## Hosts refused by the build environment's network policy

Each was asked once and not retried. What each would have added:

- reuters.com: Reuters' own daily reports, every day, which would have completed the daily 5TC before 2026 and
  made every settlement the study's own average.
- gov.uk: the machine-readable bank holiday list (the calendar is built by statute instead and checked against
  the complete 2026 months).
- www.gstatic.com (and the Amplify page's other script hosts): the Amplify holdings tables in this environment.
- web.archive.org: archived copies of reports missing from the republishers (for example Banchero Costa's 2020
  issues, which Hellenic Shipping News does not hold).
- bancosta.com: Banchero Costa's own archive.
- gcaptain.com, bairdmaritime.com, brecorder.com, worldports.org, drybulkmagazine.com, thedcn.com.au,
  bimco.org, seanews.ir, ics.org.uk: more republished daily and weekly reports.
- breakbulk.news, xindemarinenews.com: the press accounts of how TD3C was assessed during the closure and of
  the dispute over it; the study uses the Baltic's own weekly wording instead.
- live.euronext.com, mfn.se, inderes.fi, placera.se, globenewswire.com, himalaya-shipping.com: Himalaya
  Shipping's releases (read instead from its SEC filings).
- doi.org, onlinelibrary.wiley.com, jstor.org, link.springer.com, ideas.repec.org, econpapers.repec.org,
  openaccess.city.ac.uk, core.ac.uk, api.crossref.org, api.openalex.org: the literature, none of which could be
  opened, so no published result is compared.

## Data policy

| Source | Decision |
|---|---|
| Baltic indices (5TC daily, TD3C, TD34) | Daily values stay in the ignored cache. Committed: monthly settlement averages, derived statistics, and weekly TD3C and TD34 prints each with its link. |
| Banchero Costa weekly report | The extracted panel stays in the cache. Committed: derived statistics and at most six dated curves (the validation weeks 11 July 2022 and 27 July 2026, the double-printed 29 June 2026 and the latest week), each cited. |
| SEC filings (Amplify, Himalaya) | Public records, committed with links. |
| Breakwave reports | Each dollar print and index value committed as a cited point. |
| handybulk.com, Reuters as republished | Daily prints stay in the cache; they enter only monthly averages and derived statistics. |
| Worldscale flat rates | Never published; only the test of whether dated pairs agree. |

`tools/check-policy.mjs` enforces the policy on every artifact and download in the gate: no key carrying a daily
level or a flat rate, no more than six dated curves, monthly settlement rows only, no level columns in the
downloads except the SEC marks.

<!-- coverage:start -->
## Coverage (written by scripts/build.py)

| Item | Value |
|---|---|
| First and last FFA curve | 2021-01-08 and 2026-11-08 |
| FFA curves by year | 2021: 2, 2022: 1, 2023: 14, 2024: 46, 2025: 40, 2026: 40 |
| Banchero Costa issues read | 150 (89 with at least one table read by OCR) |
| Monthly settlements by year | 2020: 7 estimated; 2021: 10 estimated; 2022: 11 estimated; 2023: 1 complete, 4 estimated, 7 published; 2024: 12 published; 2025: 12 published; 2026: 10 complete |
| Complete settlement months (the study's own average of every publication day) | 11 on the 180,000 t basket (July 2023; January to October 2026); 10 of them also on the 182,000 t basket |
| Published settlement months (Himalaya Shipping, SEC) | May to June 2023; August 2023 to December 2025 |
| Exact settlement months (complete or published), 180,000 t | 42 |
| Days in the pooled daily 5TC | 1041 |
| Hedge observations (voyage, horizon, fixtures) | 5TC trip 1m 130, 5TC trip 2m 128, 5TC trip 3m 94, C3 1m 108, C3 2m 91, C3 3m 88, C5 1m 130, C5 2m 128, C5 3m 94 |
| TD3C weekly prints | 188 (2023-01-06 to 2026-11-13) |
| Breakwave tanker reports | 68 |
| SEC quarter ends | BDRY 35, BWET 14 |

## Quality control (written by scripts/build.py)

- Reprints compared: 1142 tenor pairs; 108 differ by more than 10 percent. The previous-week column is a later re-assessment, not a copy; the first print is used and the latest is a sensitivity.
- SEC comparisons within three days of a quarter end: 31, of which 3 differ by more than 10 percent (listed in data/method.json, qc).
- One-week moves flagged: 5.
- Repeated pages (an issue reprinting the previous assessment under new dates), not used: 2024-W11 (dated 2024-03-18, same figures as 2024-03-11), 2025-W12 (dated 2025-03-24, same figures as 2025-03-17), 2025-W28 (dated 2025-07-14, same figures as 2025-06-30), 2025-W29 (dated 2025-07-21, same figures as 2025-07-14), 2025-W32 (dated 2025-08-11, same figures as 2025-08-04).
- Breakwave reports whose side panel repeats the previous report's figures, not used: BreakwaveTankersMay202025Report.pdf.
<!-- coverage:end -->
