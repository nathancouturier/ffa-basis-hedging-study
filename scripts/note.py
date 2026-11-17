"""Write the research note, FFA-Basis-Hedging-Study-Research-Note.pdf, from the committed artifacts.

Body in Liberation Serif, charts drawn with matplotlib in the site's data
palette (read from styles/*.css), tables drawn as images whose columns fit
their longest string (measured with TextPath), 0.26 inch rows at 200 dpi. The
text holds no figure of its own: every number is read from data/*.json. After
writing, the PDF's text is extracted and checked for long dashes.
"""

from __future__ import annotations

import datetime as dt
import io
import json
import re
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.textpath import TextPath
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm, inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "FFA-Basis-Hedging-Study-Research-Note.pdf"
LIB = Path("/usr/share/fonts/truetype/liberation")
SITE = "https://nathancouturier.github.io/ffa-basis-hedging-study/"

pdfmetrics.registerFont(TTFont("LiberationSerif", "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"))
pdfmetrics.registerFont(TTFont("LiberationSerif-Bold", str(LIB / "LiberationSerif-Bold.ttf")))
pdfmetrics.registerFont(TTFont("LiberationSerif-Italic", str(LIB / "LiberationSerif-Italic.ttf")))
pdfmetrics.registerFontFamily(
    "LiberationSerif",
    normal="LiberationSerif",
    bold="LiberationSerif-Bold",
    italic="LiberationSerif-Italic",
    boldItalic="LiberationSerif-Bold",
)

LMAR, RMAR, ROW_H, DPI, PAD = 0.12, 0.12, 0.26, 200, 0.16
TABLE_FONT = FontProperties(fname=str(LIB / "LiberationSans-Regular.ttf"), size=8.5)
TABLE_BOLD = FontProperties(fname=str(LIB / "LiberationSans-Bold.ttf"), size=8.5)
CHART_FONT = str(LIB / "LiberationSans-Regular.ttf")


def palette() -> dict[str, str]:
    """The light theme's data colours from the site's stylesheets (custom properties named --data-*)."""
    colours: dict[str, str] = {}
    for css in sorted((ROOT / "styles").glob("*.css")):
        text = css.read_text(encoding="utf-8")
        for block in re.finditer(r":root\s*\{([^}]*)\}", text):
            for name, value in re.findall(
                r"--((?:data|ink|text|muted|grid|accent)[\w-]*)\s*:\s*(#[0-9a-fA-F]{3,8})", block.group(1)
            ):
                colours.setdefault(name, value)
    return colours


PAL = palette()


def colour(*names: str, default: str = "#2b2b2b") -> str:
    for name in names:
        for key, value in PAL.items():
            if name in key:
                return value
    return default


INK = colour("text", default="#1f2328")
MUTED = colour("muted", default="#5b6370")
GRID = colour("grid", default="#d9dce1")
C_SERIES = {
    "5TC trip": colour("timing", default="#3b6ea5"),
    "C3": colour("route", default="#b5651d"),
    "C5": colour("spot", "accent", default="#1f2328"),
}


def load(name: str) -> dict:
    return json.loads((ROOT / "data" / f"{name}.json").read_text(encoding="utf-8"))


def day(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%B %Y')}"


def pct(x: float | None, places: int = 0) -> str:
    return "n/a" if x is None else f"{100 * x:.{places}f}%"


def usd(x: float | None) -> str:
    return "n/a" if x is None else f"{round(x):,}"


# ------------------------------------------------------------------ tables


def text_width_in(text: str, prop: FontProperties) -> float:
    path = TextPath((0, 0), text, prop=prop)
    return (path.get_extents().width if text else 0.0) / 72.0


def table_png(header: list[str], rows: list[list[str]], numeric: set[int] | None = None) -> Image:
    """A table as an image: each column as wide as its longest string plus padding, 0.26 inch rows at 200 dpi."""
    numeric = numeric or set()
    widths = []
    for c in range(len(header)):
        longest = max([text_width_in(header[c], TABLE_BOLD)] + [text_width_in(r[c], TABLE_FONT) for r in rows])
        widths.append(longest + PAD)
    fig_w = LMAR + sum(widths) + RMAR
    fig_h = ROW_H * (len(rows) + 1) + 0.08
    fig = plt.figure(figsize=(fig_w, fig_h), dpi=DPI)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, fig_w)
    ax.set_ylim(fig_h, 0)
    ax.axis("off")
    x = LMAR
    for c, w in enumerate(widths):
        align = "right" if c in numeric else "left"
        tx = x + w - PAD / 2 if c in numeric else x + PAD / 2
        ax.text(tx, ROW_H * 0.62, header[c], ha=align, va="center", fontproperties=TABLE_BOLD, color=INK)
        for r, row in enumerate(rows):
            ax.text(tx, ROW_H * (r + 1.62), row[c], ha=align, va="center", fontproperties=TABLE_FONT, color=INK)
        x += w
    ax.plot([LMAR, fig_w - RMAR], [ROW_H * 1.12] * 2, color=MUTED, lw=0.6)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=DPI)
    plt.close(fig)
    buf.seek(0)
    return Image(buf, width=fig_w * inch, height=fig_h * inch)


# ------------------------------------------------------------------ charts


def chart(fig) -> Image:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=DPI, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    w, h = fig.get_size_inches()
    return Image(buf, width=w * inch, height=h * inch)


def style_axes(ax) -> None:
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(MUTED)
    ax.tick_params(colors=MUTED, labelsize=7.5)
    ax.yaxis.grid(True, color=GRID, lw=0.6)
    ax.set_axisbelow(True)


def effectiveness_chart(cells: list[dict]) -> Image:
    plt.rcParams["font.family"] = FontProperties(fname=CHART_FONT).get_name()
    fig, ax = plt.subplots(figsize=(6.3, 2.5))
    voyages = ["5TC trip", "C3", "C5"]
    for i, v in enumerate(voyages):
        for c in cells:
            if c["voyage"] != v:
                continue
            x = c["horizon_months"] + (i - 1) * 0.18
            ci = c["effectiveness_k1_ci"] or {}
            if ci.get("low") is None:
                ci = {}
            # The interval is drawn from its own ends: a percentile interval need not straddle the estimate.
            ax.vlines(
                x,
                100 * ci.get("low", c["effectiveness_k1"]),
                100 * ci.get("high", c["effectiveness_k1"]),
                color=C_SERIES[v],
                lw=1.1,
            )
            ax.plot(
                [x],
                [100 * c["effectiveness_k1"]],
                "o",
                ms=4.5,
                color=C_SERIES[v],
                label=v if c["horizon_months"] == min(r["horizon_months"] for r in cells if r["voyage"] == v) else None,
            )
    ax.axhline(0, color=MUTED, lw=0.8)
    ax.set_xticks([1, 2, 3], ["1 month", "2 months", "3 months"])
    ax.set_xlabel("Hedge placed before the fixture", fontsize=8, color=MUTED)
    ax.set_ylabel("Variance removed, percent", fontsize=8, color=MUTED)
    ax.legend(frameon=False, fontsize=7.5, ncol=3, loc="upper center", bbox_to_anchor=(0.5, 1.18))
    style_axes(ax)
    return chart(fig)


def contango_chart(curve: dict) -> Image:
    rows = curve["shares"]["front_vs_spot_by_year"]
    years = sorted(rows)
    fig, ax = plt.subplots(figsize=(6.3, 1.9))
    vals = [100 * rows[y]["contango"] for y in years]
    ax.bar(years, vals, color=colour("contango", default="#2f7d6d"), width=0.55)
    for y, v, n in zip(years, vals, [rows[y]["n"] for y in years], strict=True):
        ax.text(y, v + 2, f"{v:.0f}% of {n}", ha="center", fontsize=7, color=INK)
    ax.set_ylim(0, 110)
    ax.set_ylabel("Weeks in contango, percent", fontsize=8, color=MUTED)
    style_axes(ax)
    return chart(fig)


def td3c_chart(td3c: dict) -> Image:
    weeks = [w for w in td3c["weekly"] if w["week"] >= "2025-07-01"]
    fig, ax = plt.subplots(figsize=(6.3, 2.2))
    xs = [dt.date.fromisoformat(w["week"]) for w in weeks]
    ax.plot(
        xs, [w["ws_points"] for w in weeks], color=colour("spot", "accent", default="#1f2328"), lw=1.3, label="TD3C"
    )
    td34 = [(dt.date.fromisoformat(w["week"]), w["td34_ws_points"]) for w in weeks if w.get("td34_ws_points")]
    if td34:
        ax.plot(
            [a for a, _ in td34],
            [b for _, b in td34],
            color=colour("ffa", default="#7a5195"),
            lw=1.1,
            ls="--",
            label="TD34 (trial)",
        )
    for w in weeks:
        if w["thin_market"]:
            ax.axvspan(
                dt.date.fromisoformat(w["week"]) - dt.timedelta(days=3),
                dt.date.fromisoformat(w["week"]) + dt.timedelta(days=3),
                color=GRID,
                lw=0,
            )
    ax.axvline(dt.date(2026, 3, 2), color=MUTED, lw=0.8, ls=":")
    ax.text(dt.date(2026, 3, 6), ax.get_ylim()[1] * 0.92, "Hormuz closed, 2 March 2026", fontsize=7, color=MUTED)
    ax.set_ylabel("Worldscale points", fontsize=8, color=MUTED)
    ax.legend(frameon=False, fontsize=7.5, loc="upper left")
    style_axes(ax)
    return chart(fig)


# ------------------------------------------------------------------ the note


def build() -> list:
    ov, curve, roll, td3c, method, manifest = (
        load(n) for n in ("overview", "curve", "roll", "td3c", "method", "manifest")
    )
    h = ov["headline"]
    facts = {f["key"]: f for f in ov["facts"]}
    cov = method["coverage"]
    body = ParagraphStyle(
        "body", fontName="LiberationSerif", fontSize=10, leading=13.2, alignment=TA_JUSTIFY, spaceAfter=5
    )
    head = ParagraphStyle(
        "head", fontName="LiberationSerif-Bold", fontSize=11.5, leading=14, spaceBefore=8, spaceAfter=4
    )
    title = ParagraphStyle("title", fontName="LiberationSerif-Bold", fontSize=17, leading=21, spaceAfter=4)
    small = ParagraphStyle("small", parent=body, fontSize=8.5, leading=11)
    s = []
    s.append(Paragraph("FFA basis and hedging: Capesize 5TC and TD3C", title))
    s.append(Paragraph(f"Nathan Couturier. Research note, data to {day(ov['as_of'])}. {SITE}", small))
    s.append(Spacer(1, 6))
    ci = h["effectiveness_k1_ci"]
    b = facts.get("basis_left", {})
    c = facts.get("contango_share", {})
    t = facts.get("td3c_peak", {})
    s.append(
        Paragraph(
            "<b>Question.</b> How well do Capesize 5TC and TD3C forward freight agreements hedge the "
            "earnings of a physical voyage, what does the curve's shape cost a hedger who rolls, and where "
            "does the remaining basis come from? This is a hedging study: no signal, no position sizing, "
            "no profit and loss presented as a strategy.",
            body,
        )
    )
    s.append(
        Paragraph(
            f"<b>Answer.</b> A 5TC hedge placed one month before a C5 West Australia to Qingdao fixture removed "
            f"{pct(h['effectiveness_k1'])} of the variance of the voyage's earnings measured against the forward "
            f"(90 percent block bootstrap interval {pct(ci['low'])} to {pct(ci['high'])}, {h['n']} weekly fixtures from "
            f"{day(h['first_fixture'])} to {day(h['last_fixture'])}, hedge ratio one). What it leaves is a standard "
            f"deviation of USD {usd(b.get('value_usd_day'))} a day against USD {usd(b.get('unhedged_usd_day'))} unhedged. "
            f"The front month stood above the same day's spot in {pct(c.get('value'))} of {c.get('n')} weeks. TD3C "
            f"reached WS{t.get('ws_points', 0):,.2f}, a round-trip TCE of USD {usd(t.get('tce_usd_day'))} a day, in the "
            f"week to {day(t['week']) if t.get('week') else 'n/a'}.",
            body,
        )
    )
    s.append(
        Paragraph(
            "<b>Figure 1.</b> Share of earnings variance removed at a one for one hedge, by horizon and "
            "voyage, with 90 percent intervals (moving block bootstrap, block of the horizon in weeks plus "
            "four, 2,000 resamples, fixed seed).",
            small,
        )
    )
    s.append(effectiveness_chart(ov["effectiveness"]))
    s.append(Paragraph("<b>Data and conventions</b>", head))
    s.append(
        Paragraph(
            f"Forward curves are Banchero Costa's weekly Capesize FFA assessments ({cov['issues_read']} issues read from "
            f"Hellenic Shipping News; first curve {day(cov['first_ffa_week'])}, last {day(cov['last_ffa_week'])}). The "
            "Baltic 5TC is the weighted basket of five time charter routes; from 2 January 2026 it is assessed for a "
            "182,000 dwt ship and the 180,000 t basket is that value less USD 3,503 a day (Guide to Market Benchmarks "
            "v8.8, page 77). Every 2026 figure here states its basket. A contract settles on the average of every "
            "publication day of its month. Monthly settlements are the study's own averages where every day is printed "
            f"in public ({cov['settlements_by_year'].get('2026', {}).get('complete', 0)} months of 2026), else the monthly "
            "averages Himalaya Shipping files with the SEC, which match every complete month to within a dollar. C3 and "
            "C5 earnings are voyage TCEs from voyage-tce-model's engine (vendored at a pinned commit) with the Baltic "
            "ship of the date and that week's Singapore bunkers, grossed up by their 5 percent commission.",
            body,
        )
    )
    rows = [
        [
            r["voyage"],
            f"{r['horizon_months']} m",
            str(r["n"]),
            pct(r["effectiveness_k1"]),
            "n/a"
            if not r["effectiveness_k1_ci"]
            else f"{pct(r['effectiveness_k1_ci']['low'])} to {pct(r['effectiveness_k1_ci']['high'])}",
            pct(r.get("effectiveness_kstar_oos")),
            usd(r["sd_unhedged_usd_day"]),
            usd(r["sd_hedged_usd_day"]),
        ]
        for r in ov["effectiveness"]
    ]
    s.append(
        KeepTogether(
            [
                Paragraph(
                    "<b>Table 1.</b> Hedge effectiveness. SD in USD a day; k* estimated on past "
                    "outcomes only (expanding window of at least 52 settled fixtures).",
                    small,
                ),
                table_png(
                    [
                        "Voyage",
                        "Horizon",
                        "Fixtures",
                        "k = 1",
                        "90% interval",
                        "k* out of sample",
                        "SD unhedged",
                        "SD hedged",
                    ],
                    rows,
                    numeric={2, 3, 5, 6, 7},
                ),
            ]
        )
    )
    s.append(Paragraph("<b>Curve shape, bias and roll cost</b>", head))
    s.append(contango_chart(curve))
    bias = [r for r in roll["bias"] if r]
    rows = [
        [
            f"{r['horizon_months']} month{'s' if r['horizon_months'] != 1 else ''}",
            str(r["n"]),
            usd(r["mean_usd_day"]),
            "n/a" if not r["mean_ci"] else f"{usd(r['mean_ci']['low'])} to {usd(r['mean_ci']['high'])}",
            usd(r["rmse_usd_day"]),
            pct(r["share_positive"]),
            "n/a" if r.get("rmse_ratio_ffa_to_naive") is None else f"{r['rmse_ratio_ffa_to_naive']:.2f}",
        ]
        for r in bias
    ]
    s.append(
        Paragraph(
            "<b>Table 2.</b> Forecast error, settlement less the price paid h months before expiry, USD a "
            "day. Positive: the contract settled above the price, a gain to a long (charterer) and a cost "
            "to a short (owner). Roll cost is the negative.",
            small,
        )
    )
    s.append(
        table_png(
            ["Horizon", "Contracts", "Mean error", "90% interval", "RMSE", "Share positive", "RMSE / naive"],
            rows,
            numeric={1, 2, 4, 5, 6},
        )
    )
    roll_rows = [
        [str(r["year"]), str(r["n"]), usd(r["roll_cost_usd_day"]), pct(r["roll_cost_pct"], 1), usd(r["ship_year_usd"])]
        for r in roll["roll_1m"]
    ]
    s.append(
        Paragraph(
            "<b>Table 3.</b> Roll cost of a rolling one-month long (price paid one month before expiry "
            "less settlement), by contract year.",
            small,
        )
    )
    s.append(
        table_png(["Year", "Contracts", "USD a day", "Percent", "USD a ship-year"], roll_rows, numeric={1, 2, 3, 4})
    )
    s.append(Paragraph("<b>TD3C through the 2026 closure</b>", head))
    s.append(td3c_chart(td3c))
    s.append(
        Paragraph(
            "TD3C in Worldscale points from the Baltic's weekly tanker report; the shaded weeks are those in which the "
            "Baltic wrote that its panellists had difficulty assessing Gulf loadings or that transits were extremely "
            "limited. A dated public pair of a dollar print and a Worldscale print agrees well enough to imply one flat "
            "rate only where the test says so; otherwise the year stays in Worldscale (data/td3c.json, flat_rate_test). "
            "The case studies on the site hedge one cargo a month at Amplify's quarter-end TD3C marks (SEC) and settle "
            "against Breakwave's dollar prints, labelled approximate.",
            body,
        )
    )
    s.append(Paragraph("<b>Validation and limits</b>", head))
    ok = sum(1 for r in method["validation"] if r["ok"])
    s.append(
        Paragraph(
            f"{ok} of {len(method['validation'])} validation anchors reproduce: the SEC marks to the cent, Banchero "
            "Costa's printed curves to the dollar, the 2026 basket gap, the TD3C weekly prints, Breakwave's prints, the "
            "vendored engine within 1e-9 and the published monthly 5TC averages. Limits: before 2026 the daily 5TC is "
            "public only in part, so earlier settlements come from Himalaya Shipping's published averages or, in the "
            "robustness, from partial averages; Banchero Costa's previous-week column differs from its first print by a "
            "median of about 3 percent, so the study uses first prints and reports the latest as a sensitivity; the "
            "literature (Ederington 1979; Kavussanos and Nomikos 2000; Alizadeh and Nomikos 2009) could not be opened "
            "from the build environment, so no comparison with it is drawn.",
            body,
        )
    )
    s.append(
        Paragraph(
            f"Sources retrieved to {manifest['built_on']}; every figure is traceable in the repository "
            "(data/AUDIT.md, data/method.json).",
            small,
        )
    )
    return s


def main() -> int:
    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        leftMargin=2.0 * cm,
        rightMargin=2.0 * cm,
        topMargin=1.7 * cm,
        bottomMargin=1.7 * cm,
        title="FFA basis and hedging: Capesize 5TC and TD3C",
        author="Nathan Couturier",
    )
    doc.build(build())
    import pdfplumber

    with pdfplumber.open(OUT) as pdf:
        pages = len(pdf.pages)
        text = "".join(p.extract_text() or "" for p in pdf.pages)
    if re.search("[\u2013\u2014]", text):
        print("the note's text holds a long dash")
        return 1
    print(f"wrote {OUT.name}: {pages} pages, no long dash")
    return 0 if 3 <= pages <= 5 else 1


if __name__ == "__main__":
    sys.exit(main())
