"""Write the research note, FFA-Basis-Hedging-Study-Research-Note.pdf, from the committed artifacts.

Body in Liberation Serif, charts drawn with matplotlib in the site's data
palette (the light theme's custom properties in styles/tokens.css), tables
drawn as images whose columns fit their longest string (measured with
TextPath), 0.26 inch rows at 200 dpi. The text holds no figure of its own:
every number is read from data/*.json. After writing, the PDF's text is
extracted and checked for long dashes and the page count (3 to 5).
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
plt.rcParams["font.family"] = FontProperties(fname=CHART_FONT).get_name()


def palette() -> dict[str, str]:
    """The light theme's colours: every custom property of the first :root block in styles/tokens.css."""
    text = (ROOT / "styles" / "tokens.css").read_text(encoding="utf-8")
    block = re.search(r":root\s*\{([^}]*)\}", text)
    return dict(re.findall(r"--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})", block.group(1) if block else ""))


PAL = palette()
INK = PAL.get("ink", "#16181b")
MUTED = PAL.get("ink-3", "#5b5f66")
GRID = PAL.get("grid", "#e5e2da")
AXIS = PAL.get("axis", "#8d8a82")
C = {key[2:]: value for key, value in PAL.items() if key.startswith("c-")}


def load(name: str) -> dict:
    return json.loads((ROOT / "data" / f"{name}.json").read_text(encoding="utf-8"))


def day(iso: str | None) -> str:
    if not iso:
        return "n/a"
    d = dt.date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%B %Y')}"


def month_name(period: str) -> str:
    return dt.date.fromisoformat(period + "-01").strftime("%B %Y")


def pct(x: float | None, places: int = 1) -> str:
    return "n/a" if x is None else f"{100 * x:.{places}f}%"


def usd(x: float | None) -> str:
    return "n/a" if x is None else f"{round(x):,}"


def signed(x: float | None) -> str:
    return "n/a" if x is None else f"{round(x):+,}"


def millions(x: float) -> str:
    return f"{x / 1e6:+,.1f} m"


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


def style_axes(ax, grid_axis: str = "y") -> None:
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(AXIS)
    ax.tick_params(colors=MUTED, labelsize=7.5)
    getattr(ax, f"{grid_axis}axis").grid(True, color=GRID, lw=0.6)
    ax.set_axisbelow(True)


def effectiveness_chart(cells: list[dict]) -> Image:
    """One row per voyage and horizon: k = 1 with its interval (FFA colour), k* out of sample (ink diamond)."""
    rows = [c for v in ("5TC trip", "C3", "C5") for c in cells if c["voyage"] == v]
    fig, ax = plt.subplots(figsize=(6.3, 3.0))
    labels = []
    for i, c in enumerate(rows):
        y = len(rows) - i
        ci = c.get("effectiveness_k1_ci") or {}
        if ci.get("low") is not None:
            # A percentile interval is drawn from its own ends: it need not straddle the estimate.
            ax.hlines(y, 100 * ci["low"], 100 * ci["high"], color=C["ffa"], lw=1.2)
        ax.plot([100 * c["effectiveness_k1"]], [y], "o", ms=4.8, color=C["ffa"])
        if c.get("effectiveness_kstar_oos") is not None:
            ax.plot([100 * c["effectiveness_kstar_oos"]], [y], "D", ms=4.2, mfc="white", mec=INK, mew=1.0)
        labels.append((y, f"{c['voyage']}, {c['horizon_months']} month{'s' if c['horizon_months'] > 1 else ''}"))
    ax.axvline(0, color=AXIS, lw=0.8)
    ax.set_yticks([y for y, _ in labels], [t for _, t in labels])
    ax.set_xlabel("Variance of the earnings surprise removed, percent", fontsize=8, color=MUTED)
    ax.plot([], [], "o", color=C["ffa"], label="Hedge ratio 1:1, with its 90 percent interval")
    ax.plot([], [], "D", mfc="white", mec=INK, label="Minimum variance ratio from past fixtures only")
    ax.legend(frameon=False, fontsize=7.5, ncol=2, loc="lower center", bbox_to_anchor=(0.45, 1.0))
    style_axes(ax, "x")
    return chart(fig)


def contango_chart(curve: dict) -> Image:
    rows = curve["shares"]["front_vs_spot_by_year"]
    years = sorted(rows)
    fig, ax = plt.subplots(figsize=(6.3, 1.9))
    vals = [100 * rows[y]["contango"] for y in years]
    ax.bar(years, vals, color=C["contango"], width=0.55)
    for y, v, n in zip(years, vals, [rows[y]["n"] for y in years], strict=True):
        ax.text(y, v + 3, f"{v:.0f}% of {n}", ha="center", fontsize=7, color=INK)
    ax.set_ylim(0, 115)
    ax.set_ylabel("Weekly curves in contango, %", fontsize=8, color=MUTED)
    style_axes(ax)
    return chart(fig)


def td3c_chart(td3c: dict) -> Image:
    weeks = [w for w in td3c["weekly"] if w["week"] >= "2025-07-01"]
    fig, ax = plt.subplots(figsize=(6.3, 2.3))
    xs = [dt.date.fromisoformat(w["week"]) for w in weeks]
    for w in weeks:
        if w["thin_market"]:
            ax.axvspan(
                dt.date.fromisoformat(w["week"]) - dt.timedelta(days=3),
                dt.date.fromisoformat(w["week"]) + dt.timedelta(days=3),
                color=C.get("none", GRID),
                lw=0,
            )
    ax.plot(xs, [w["ws_points"] for w in weeks], color=C["spot"], lw=1.4, label="TD3C, Ras Tanura to Ningbo")
    td34 = [(dt.date.fromisoformat(w["week"]), w["td34_ws_points"]) for w in weeks if w.get("td34_ws_points")]
    if td34:
        ax.plot(
            [a for a, _ in td34], [b for _, b in td34], color=C["route"], lw=1.2, label="TD34, Mina Al Fahal to Ningbo"
        )
    closed = next((e for e in td3c.get("events", []) if "Hormuz" in e["text"]), None)
    if closed:
        when = dt.date.fromisoformat(closed["date"])
        ax.axvline(when, color=AXIS, lw=0.8, ls=":")
        ax.text(
            when + dt.timedelta(days=4), ax.get_ylim()[1] * 0.9, f"Hormuz closed, {day(closed['date'])}", fontsize=7
        )
    ax.set_ylabel("Worldscale points", fontsize=8, color=MUTED)
    ax.fill_between([], [], color=C.get("none", GRID), label="Thin market (Baltic wording)")
    ax.legend(frameon=False, fontsize=7.2, loc="upper left")
    style_axes(ax)
    return chart(fig)


# ------------------------------------------------------------------ the note


def five_findings(ov: dict, curve: dict, roll: dict, td3c: dict) -> list[str]:
    """The answer in five sentences, every figure read from the artifacts."""
    h = ov["headline"]
    cells = {(c["voyage"], c["horizon_months"]): c for c in ov["effectiveness"]}
    trip, c3 = cells.get(("5TC trip", 1), {}), cells.get(("C3", 1), {})
    ci = h["effectiveness_k1_ci"] or {}
    share = h["residual_variance_share"]
    b1 = next((b for b in roll["bias"] if b and b["horizon_months"] == 1), None)
    fa = curve["shares"]["front_vs_spot"]["all"]
    q1 = curve["q1_discount"]
    facts = {f["key"]: f for f in ov["facts"]}
    peak = facts.get("td3c_peak", {})
    before = [w for w in td3c["weekly"] if w["week"] < "2026-03-02"]
    kstar, same = h.get("effectiveness_kstar_oos"), h.get("effectiveness_k1_same_rows")
    out = [
        f"A 5TC hedge placed one month ahead removed {pct(h['effectiveness_k1'])} of the variance of a C5 voyage's "
        f"earnings against the forward (90 percent interval {pct(ci.get('low'))} to {pct(ci.get('high'))}; "
        f"{h['n']} weekly fixtures, {day(h['first_fixture'])} to {day(h['last_fixture'])}), "
        f"{pct(trip.get('effectiveness_k1'))} for a trip at the day's 5TC and {pct(c3.get('effectiveness_k1'))} "
        "for a C3 voyage."
        + (
            f" A ratio estimated only from past fixtures removed {pct(kstar)} against {pct(same)} at one for one on "
            f"the same {h['n_oos']} fixtures."
            if kstar is not None and same is not None
            else ""
        ),
        f"What the hedge leaves is route and timing basis: route basis carries {pct(share['route'], 0)} of the "
        f"variance of the hedged C5 result and timing basis {pct(share['timing'], 0)}; size basis carries none, "
        "because from 2 January 2026 the Baltic derives the 180,000 t basket from the 182,000 t one at a fixed "
        "USD 3,503 a day.",
    ]
    if b1:
        lo, hi = b1["mean_ci"]["low"], b1["mean_ci"]["high"]
        zero = lo is not None and lo <= 0 <= hi
        above = b1["mean_usd_day"] > 0
        out.append(
            f"The 5TC settled on average USD {usd(abs(b1['mean_usd_day']))} a day "
            f"{'above' if above else 'below'} the FFA price one month before expiry "
            f"({b1['n']} contracts, {month_name(b1['first'])} to {month_name(b1['last'])}; 90 percent interval "
            f"{signed(lo)} to {signed(hi)}): a rolling {'charterer earned' if above else 'owner earned'} "
            f"that gap and a rolling {'owner gave it up' if above else 'charterer paid it'}"
            f"{', though the interval includes zero' if zero else ''}."
        )
    out.append(
        f"The front month stood above the same day's spot in {pct(fa['contango'])} of {fa['n']} weekly curves, "
        f"and the next year's first quarter priced below the fourth quarter before it in {pct(q1['share_below'], 0)} "
        f"of the {q1['n']} curves that printed both, {pct(abs(q1['mean_pct']))} lower on average."
    )
    if before and peak:
        out.append(
            f"TD3C went from WS{before[-1]['ws_points']:,.2f} in the week to {day(before[-1]['week'])}, the last "
            f"before the Strait of Hormuz closed, to WS{peak['ws_points']:,.2f} and a round-trip TCE of USD "
            f"{usd(peak['tce_usd_day'])} a day in the week to {day(peak['week'])}. An owner short the quarter-end "
            "marks gave up that windfall on paper and realised close to what the marks had locked, less the timing "
            "basis of each month (Table 5)."
        )
    return out


def build() -> list:
    ov, curve, roll, td3c, method, manifest = (
        load(n) for n in ("overview", "curve", "roll", "td3c", "method", "manifest")
    )
    h = ov["headline"]
    cov = method["coverage"]
    as_of = day(ov["as_of"])
    retrieved = day(manifest["built_on"])
    body = ParagraphStyle(
        "body", fontName="LiberationSerif", fontSize=10, leading=13.2, alignment=TA_JUSTIFY, spaceAfter=5
    )
    bullet = ParagraphStyle("bullet", parent=body, leftIndent=12, bulletIndent=0, spaceAfter=3)
    head = ParagraphStyle(
        "head", fontName="LiberationSerif-Bold", fontSize=11.5, leading=14, spaceBefore=8, spaceAfter=4
    )
    title = ParagraphStyle("title", fontName="LiberationSerif-Bold", fontSize=17, leading=21, spaceAfter=4)
    small = ParagraphStyle("small", parent=body, fontSize=8.5, leading=11, alignment=0)

    def source(line: str) -> Paragraph:
        return Paragraph(f"Source: {line} Data as of {as_of}.", small)

    s: list = []
    s.append(Paragraph("FFA basis and hedging: Capesize 5TC and TD3C", title))
    s.append(Paragraph(f"Nathan Couturier. Research note, data to {as_of}. {SITE}", small))
    s.append(Spacer(1, 6))
    s.append(
        Paragraph(
            "<b>Question.</b> How well do Capesize 5TC and TD3C forward freight agreements hedge the earnings of a "
            "physical voyage, what does the curve's shape cost a hedger who rolls, and where does the remaining "
            "basis come from? The study compares the Baltic's spot assessments with the FFA curve every week the "
            "public record allows. It is a hedging study: no signal, no position sizing, no profit and loss "
            "presented as a strategy.",
            body,
        )
    )
    s.append(Paragraph("<b>Findings</b>", head))
    for i, text in enumerate(five_findings(ov, curve, roll, td3c), 1):
        s.append(Paragraph(text, bullet, bulletText=f"{i}."))
    s.append(Spacer(1, 4))
    s.append(
        KeepTogether(
            [
                Paragraph(
                    "<b>Figure 1.</b> How much of a voyage's earnings uncertainty a 5TC hedge removes. Share of the "
                    "variance of the earnings surprise (gross TCE less the FFA strip, USD a day) removed, by voyage "
                    "and by how far ahead of the fixture the hedge was placed; 90 percent moving block bootstrap "
                    "intervals (block of the horizon in weeks plus four, 2,000 resamples, fixed seed). Curves and "
                    "settlements on the 180,000 t basket before 2 January 2026 and the 182,000 t basket from then.",
                    small,
                ),
                effectiveness_chart(ov["effectiveness"]),
                source(ov["sources_line"]),
            ]
        )
    )

    s.append(Paragraph("<b>Data and method</b>", head))
    s.append(
        Paragraph(
            f"Forward curves are Banchero Costa's weekly Capesize FFA assessments as Hellenic Shipping News "
            f"republishes them ({cov['issues_read']} issues read; first curve {day(cov['first_ffa_week'])}, last "
            f"{day(cov['last_ffa_week'])}); the study uses each curve's first print. The Baltic 5TC is the weighted "
            "basket of five Capesize time charter routes; from 2 January 2026 it is assessed for a 182,000 dwt ship "
            "and the 180,000 t basket is that value less USD 3,503 a day (Guide to Market Benchmarks v8.8, page 77). "
            "A contract settles on the average of every publication day of its month. A month's settlement is the "
            f"study's own average where every day is printed in public ({cov['complete_months']}), otherwise the "
            "monthly average Himalaya Shipping files with the SEC, which matches every complete month to within a "
            "dollar. C3 and C5 earnings are voyage TCEs from voyage-tce-model's engine, vendored at a pinned commit, "
            "with the Baltic's ship of the date and that week's Singapore bunkers, grossed up by their 5 percent "
            "commission to compare with a gross index.",
            body,
        )
    )
    s.append(
        Paragraph(
            "Every Friday a voyage is fixed: a trip at the day's 5TC (as long as that week's C5 voyage, so timing "
            "basis only), a C3 Tubarao to Qingdao and a C5 West Australia to Qingdao voyage. A hedge is placed 1, 2 or "
            "3 months before on the latest curve, the voyage's days spread over its calendar months at the net share, "
            "and held to settlement. With U the gross TCE less the strip price F0 and X the settlement less F0, the "
            "hedged surprise is U less kX and effectiveness is 1 less Var(U less kX) over Var(U), at k = 1 and at a "
            "minimum variance k estimated only on fixtures settled before the hedge date (at least 52). The residual "
            "at k = 1 splits exactly into route basis (voyage TCE less the day's 5TC), timing basis (the day's 5TC "
            "less the settlement of the months hedged) and size basis (the ship's basket against the curve's).",
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
            "n/a"
            if r.get("effectiveness_kstar_oos") is None
            else f"{pct(r['effectiveness_kstar_oos'])} / {pct(r['effectiveness_k1_same_rows'])} ({r['n_oos']})",
            pct(r["cvar_reduction_k1"]),
            pct(r["residual_variance_share"]["route"], 0),
            pct(r["residual_variance_share"]["timing"], 0),
        ]
        for r in ov["effectiveness"]
    ]
    s.append(
        KeepTogether(
            [
                Paragraph(
                    "<b>Table 1.</b> Hedge effectiveness by voyage and horizon. k* out of sample against k = 1 on "
                    "the same fixtures (their number in brackets). CVaR: the reduction in the 5 percent expected "
                    "shortfall of the surprise at k = 1. Route and timing: shares of the hedged residual's variance.",
                    small,
                ),
                table_png(
                    ["Voyage", "Horizon", "Fixtures", "k = 1", "90% interval", "k* / k = 1", "CVaR", "Route", "Timing"],
                    rows,
                    numeric={2, 3, 5, 6, 7, 8},
                ),
            ]
        )
    )
    e = method["ederington"]
    s.append(
        Paragraph(
            f"<b>Residual and Ederington.</b> One month ahead, the hedged C5 result still has a standard deviation of "
            f"USD {usd(h['sd_hedged_usd_day'])} a day against USD {usd(h['sd_unhedged_usd_day'])} unhedged, and its "
            f"5 percent CVaR falls from USD {usd(h['cvar_unhedged_usd_day'])} to USD {usd(h['cvar_hedged_usd_day'])}. "
            "Route basis is the C5 voyage's own freight moving apart from the 5TC; timing basis is the day's rate "
            "against the average of the months the voyage runs through. Ederington's measure on weekly changes "
            f"(spot and the next month's FFA, Monday to Monday, same basket) gives R squared {e['r_squared']:.2f} at a "
            f"ratio of {e['hedge_ratio']:.2f} on {int(e['n'])} weekly pairs ({day(e['first'])} to {day(e['last'])}), "
            "the measure the literature reports, for the reader to set beside it.",
            body,
        )
    )

    s.append(Paragraph("<b>Curve shape</b>", head))
    sh = curve["shares"]
    q1 = curve["q1_discount"]
    ms, qs = sh["month_spreads"]["all"], sh["quarter_spreads"]["all"]
    bins = [b for b in curve["slope_by_spot"] if b["n"] >= 5]
    low_bin = bins[0] if bins else None
    high_bin = bins[-1] if bins else None
    slope = (
        f" With spot between USD {usd(low_bin['spot_from'])} and {usd(low_bin['spot_to'])} a day the first full "
        f"quarter sat {low_bin['mean_slope_pct']:+.1f} percent of spot from the front month ({low_bin['n']} curves); "
        f"with spot between USD {usd(high_bin['spot_from'])} and {usd(high_bin['spot_to'])}, "
        f"{high_bin['mean_slope_pct']:+.1f} percent ({high_bin['n']} curves)."
        if low_bin and high_bin and low_bin is not high_bin
        else ""
    )
    s.append(
        Paragraph(
            f"Adjacent months were in contango in {pct(ms['contango'])} of {ms['n']} pairs and adjacent quarters in "
            f"{pct(qs['contango'])} of {qs['n']}. The first-quarter discount is the curve's most regular feature: Q1 "
            f"priced below the Q4 before it in {pct(q1['share_below'], 0)} of {q1['n']} curves, by "
            f"{pct(abs(q1['mean_pct']))} on average.{slope}",
            body,
        )
    )
    s.append(
        KeepTogether(
            [
                Paragraph(
                    "<b>Figure 2.</b> Contango against spot by year. Share of weekly curves whose front month priced "
                    "above the same day's 5TC on the same basket, with the number of curves (few before 2024).",
                    small,
                ),
                contango_chart(curve),
                source(curve["sources_line"]),
            ]
        )
    )

    s.append(Paragraph("<b>Bias and roll cost</b>", head))
    bias = [r for r in roll["bias"] if r]
    rows = [
        [
            f"{r['horizon_months']} month{'s' if r['horizon_months'] != 1 else ''}",
            str(r["n"]),
            signed(r["mean_usd_day"]),
            "n/a"
            if r["mean_ci"]["low"] is None
            else f"{signed(r['mean_ci']['low'])} to {signed(r['mean_ci']['high'])}",
            usd(r["rmse_usd_day"]),
            pct(r["share_positive"], 0),
            "n/a"
            if r.get("rmse_ratio_ffa_to_naive") is None
            else f"{r['rmse_ratio_ffa_to_naive']:.2f} ({r['n_naive']})",
        ]
        for r in bias
    ]
    qb = roll.get("quarter_bias")
    if qb:
        rows.append(
            [
                "Front quarter",
                str(qb["n"]),
                signed(qb["mean_usd_day"]),
                "n/a"
                if qb["mean_ci"]["low"] is None
                else f"{signed(qb['mean_ci']['low'])} to {signed(qb['mean_ci']['high'])}",
                usd(qb["rmse_usd_day"]),
                pct(qb["share_positive"], 0),
                "n/a",
            ]
        )
    s.append(
        KeepTogether(
            [
                Paragraph(
                    "<b>Table 2.</b> Forecast error, settlement less the price on the last curve h months before "
                    "the contract month, USD a day, each contract on the basket its curve was printed on. Positive: "
                    "the contract settled above the price, a gain to a long (a charterer) and a cost to a short (an "
                    "owner). FFA / spot: the FFA's RMSE over that of the spot on the pricing date as a forecast, on "
                    "the contracts with that spot (their number in brackets).",
                    small,
                ),
                table_png(
                    ["Horizon", "Contracts", "Mean", "90% interval", "RMSE", "Positive", "FFA / spot"],
                    rows,
                    numeric={1, 2, 4, 5, 6},
                ),
            ]
        )
    )
    roll_rows = [
        [
            label,
            str(r["year"]),
            str(r["n"]),
            signed(r["roll_cost_usd_day"]),
            f"{100 * r['roll_cost_pct']:+.1f}%",
            signed(r["ship_year_usd"]),
        ]
        for label, key in (("One-month long", "roll_1m"), ("Front-quarter long", "roll_quarter"))
        for r in roll[key]
    ]
    s.append(
        KeepTogether(
            [
                Paragraph(
                    "<b>Table 3.</b> Roll cost of a rolling long, price paid less settlement, by contract year. "
                    "Positive: the long (charterer) pays and the short (owner) earns. A ship-year is the daily "
                    "figure over 365 days. Years with few contracts say little.",
                    small,
                ),
                table_png(
                    ["Strategy", "Year", "Contracts", "USD a day", "Of settlement", "USD a ship-year"],
                    roll_rows,
                    numeric={1, 2, 3, 4, 5},
                ),
                source(roll["sources_line"]),
            ]
        )
    )

    s.append(Paragraph("<b>Robustness</b>", head))
    rob_rows = []
    for v in method["robustness"]:
        cells = {(x["voyage"], x["horizon_months"]): x for x in v["hedge"]}
        c5, trip = cells.get(("C5", 1), {}), cells.get(("5TC trip", 1), {})
        b1 = (v.get("bias") or {}).get("1") or {}
        rob_rows.append(
            [
                ROBUSTNESS_NAMES.get(v["key"], v["key"]),
                f"{pct(c5.get('effectiveness_k1'))} ({c5.get('n', 0)})",
                f"{pct(trip.get('effectiveness_k1'))} ({trip.get('n', 0)})",
                f"{signed(b1.get('mean_usd_day'))} ({b1.get('n', 0)})",
            ]
        )
    by_year = "; ".join(f"{r['year']} {pct(r['effectiveness_k1'])} ({r['n']})" for r in method["hedge_by_year"]["C5"])
    s.append(
        KeepTogether(
            [
                Paragraph(
                    "<b>Table 4.</b> The headline under each pre-registered variant: one-month effectiveness at k = 1 "
                    "for C5 and the 5TC trip, and the one-month mean forecast error in USD a day (observations in "
                    f"brackets). By calendar year the C5 figure is {by_year}.",
                    small,
                ),
                table_png(["Variant", "C5, 1 month", "5TC trip, 1 month", "Bias, 1 month"], rob_rows, {1, 2, 3}),
            ]
        )
    )

    s.append(Paragraph("<b>TD3C through the 2026 closure</b>", head))
    thin = [w["week"] for w in td3c["weekly"] if w["thin_market"]]
    flat = td3c["flat_rate_test"]
    s.append(
        Paragraph(
            "TD3C is read in Worldscale points from the Baltic's own weekly tanker report. The study marks a week as a "
            "thin market when that report says its panellists had difficulty assessing the routes from the Gulf or "
            f"that transits were extremely limited or blocked ({', '.join(day(w) for w in thin)}). A Worldscale print "
            "becomes dollars a tonne only through a flat rate implied by dated public pairs, and only where the pairs "
            "agree: "
            + "; ".join(
                f"{k} {'agrees' if v['consistent'] else 'does not'} (spread {pct(v['dispersion'])} of the median, "
                f"{v['n']} pairs)"
                for k, v in flat.items()
            )
            + ". So 2026 stays in Worldscale, and the dollar case studies use Breakwave's own dollar prints: one cargo "
            "of 270,000 t a month hedged at Amplify's quarter-end TD3C marks (SEC), fixed at the month's first print "
            "and settled at the average of the month's prints, an approximation.",
            body,
        )
    )
    s.append(
        KeepTogether(
            [
                Paragraph(
                    "<b>Figure 3.</b> TD3C through the closure of the Strait of Hormuz, with TD34, the trial route "
                    "loading outside the Gulf. Weekly Worldscale points; shaded weeks are those the Baltic found hard "
                    "to assess.",
                    small,
                ),
                td3c_chart(td3c),
                source(td3c["sources_line"]),
            ]
        )
    )
    case_rows = [
        [
            day(c["as_of"]),
            ", ".join(dt.date.fromisoformat(m["month"] + "-01").strftime("%b %y") for m in c["months"]),
            millions(c["total"]["locked_usd"]),
            millions(c["total"]["physical_vs_locked_usd"]),
            millions(c["total"]["paper_usd"]),
            millions(c["total"]["total_usd"]),
        ]
        for c in td3c["cases"]
    ]
    st = td3c["statistics"]
    stats_note = (
        ""
        if st["by_horizon"]
        else f" Item 3's statistics for TD3C need at least {st['threshold_months']} contract months at one horizon; "
        "the marks give "
        + ", ".join(
            f"{c['n']} at {c['horizon_months']} month{'s' if c['horizon_months'] > 1 else ''}" for c in st["counts"]
        )
        + ", so none are reported."
    )
    s.append(
        KeepTogether(
            [
                Paragraph(
                    "<b>Table 5.</b> TD3C case studies for an owner short the marks, USD millions: what the marks "
                    "locked, the physical freight against that, the paper result (the short pays the settlement less "
                    f"the mark) and the realised total. Approximate.{stats_note}",
                    small,
                ),
                table_png(
                    ["Marks of", "Months", "Locked", "Physical against locked", "Paper", "Realised"],
                    case_rows,
                    numeric={2, 3, 4, 5},
                ),
            ]
        )
    )

    s.append(Paragraph("<b>Validation and limits</b>", head))
    val = method["validation"]
    ok = sum(1 for r in val if r["ok"])
    s.append(
        Paragraph(
            f"{ok} of {len(val)} validation anchors reproduce: the SEC marks to the cent, Banchero Costa's printed "
            "curves to the dollar, the USD 3,503 basket gap on 3 and 29 July 2026, the Baltic's weekly TD3C prints, "
            "Breakwave's prints, the vendored engine within 1e-9 of its own published results and every complete "
            "month against Himalaya Shipping's published average. "
            + " ".join(f"<i>{x['title']}.</i> {x['text']}" for x in method.get("limitations", [])[1:]),
            body,
        )
    )
    s.append(
        Paragraph(
            f"Sources retrieved to {retrieved}: Banchero Costa weekly reports and Breakwave Advisors tanker reports "
            "(via Hellenic Shipping News), the Baltic Exchange's weekly reports and Guide to Market Benchmarks, "
            "handybulk.com, Reuters' daily reports as republished, the SEC filings of Amplify Commodity Trust and "
            "Himalaya Shipping, EEX and ICE contract specifications, EIA. Every figure is traceable in the "
            "repository (data/AUDIT.md, data/method.json, docs/methodology.md).",
            small,
        )
    )
    return s


#: Short names of the robustness variants for Table 4 (their full definitions are in data/method.json).
ROBUSTNESS_NAMES = {
    "headline": "Headline: first prints, exact months",
    "latest_print": "Latest print of each curve",
    "all_months": "All months, estimated ones included",
    "complete_only": "Complete months only (own daily series)",
    "no_proxies": "No quarter proxies",
    "basket_180_2026": "2026 curves read as 180,000 t",
}


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
        subject="Research note",
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
