"""The study's answer in plain sentences, every figure read from the artifacts (data/*.json).

Shared by the research note (scripts/note.py) and the README's finding block (scripts/finding.py), so the
two never say different things.
"""

from __future__ import annotations

import datetime as dt


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


def five_findings(ov: dict, curve: dict, roll: dict, td3c: dict, method: dict | None = None) -> list[str]:
    """The answer in five sentences, every figure read from the artifacts."""
    h = ov["headline"]
    cells = {(c["voyage"], c["horizon_months"]): c for c in ov["effectiveness"]}
    trip, c3 = cells.get(("5TC trip", 1), {}), cells.get(("C3", 1), {})
    c3_ci = c3.get("effectiveness_k1_ci") or {}
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
        f"for a C3 voyage ({c3.get('n')} fixtures to {day(c3.get('last_fixture'))}; 90 percent interval "
        f"{pct(c3_ci.get('low'))} to {pct(c3_ci.get('high'))}"
        + (", which includes zero" if (c3_ci.get("low") or 0) <= 0 else "")
        + ")."
        + (
            f" A ratio estimated only from past fixtures removed {pct(kstar)} against {pct(same)} at one for one on "
            f"the same {h['n_oos']} fixtures."
            if kstar is not None and same is not None
            else ""
        ),
        f"What the hedge leaves is route and timing basis: route basis carries {pct(share['route'], 0)} of the "
        f"variance of the hedged C5 result and timing basis {pct(share['timing'], 0)}. Size basis carries "
        f"{pct(abs(share['size']), 0)}: from 2 January 2026 the Baltic derives the 180,000 t basket from the "
        "182,000 t one at a fixed USD 3,503 a day, so a 182,000 t ship hedged with 180,000 t paper carries a "
        "constant, not a risk.",
    ]
    if b1:
        lo, hi = b1["mean_ci"]["low"], b1["mean_ci"]["high"]
        zero = lo is not None and lo <= 0 <= hi
        above = b1["mean_usd_day"] > 0
        out.append(
            f"The 5TC settled on average USD {usd(abs(b1['mean_usd_day']))} a day "
            f"{'above' if above else 'below'} the FFA price one month before expiry "
            f"({b1['n']} contracts, {month_name(b1['first'])} to {month_name(b1['last'])}, each on the basket its "
            f"curve was printed on, 180,000 t before 2026 and 182,000 t in 2026; 90 percent interval "
            f"{signed(lo)} to {signed(hi)}): a rolling {'charterer earned' if above else 'owner earned'} "
            f"that gap and a rolling {'owner gave it up' if above else 'charterer paid it'}"
            f"{', though the interval includes zero' if zero else ''}." + print_sensitivity(method, b1["mean_usd_day"])
        )
    out.append(
        f"The front month stood above the spot (of the curve's day, or the Friday before) in {pct(fa['contango'])} of "
        f"{fa['n']} weekly curves, "
        f"and the next year's first quarter priced below the fourth quarter before it in {pct(q1['share_below'], 0)} "
        f"of the {q1['n']} curves that printed both, {pct(abs(q1['mean_pct']))} lower on average."
    )
    if before and peak:
        out.append(
            f"TD3C went from WS{before[-1]['ws_points']:,.2f} in the week to {day(before[-1]['week'])}, the last "
            f"before the Strait of Hormuz closed, to WS{peak['ws_points']:,.2f} and a round-trip TCE of USD "
            f"{usd(peak['tce_usd_day'])} a day in the week to {day(peak['week'])}." + td3c_cases_sentence(td3c)
        )
    return out


def print_sensitivity(method: dict | None, headline: float) -> str:
    """The one-month bias with each curve's later re-assessment in place of its first print, when it differs."""
    rows = {v.get("key"): ((v.get("bias") or {}).get("1") or {}) for v in (method or {}).get("robustness", [])}
    latest, first = rows.get("latest_print") or {}, rows.get("headline") or {}
    value = latest.get("mean_usd_day")
    if value is None or abs(value - headline) < 250:
        return ""
    closer = (
        f", and sits closer to the settlement (RMSE {usd(latest['rmse_usd_day'])} against "
        f"{usd(first['rmse_usd_day'])}), as a later price would"
        if latest.get("rmse_usd_day") and first.get("rmse_usd_day") and latest["rmse_usd_day"] < first["rmse_usd_day"]
        else ""
    )
    return (
        " The figure depends on the print: the same curve as the next issue re-assesses it a week later gives a "
        f"mean of USD {usd(value)} a day{closer}; the first print is the price a hedger had on the date."
    )


def td3c_cases_sentence(td3c: dict) -> str:
    """What the owner's quarter-end hedges realised against what they locked, as the cases and Table 5 show them,
    then the share on the months a case can measure where it differs, and why the worst fell short.

    A month with one Breakwave print settles at its own fixture and so realises what it locked by construction.
    """
    cases = [c for c in td3c.get("cases", []) if c["total"]["locked_usd"] > 0]
    if not cases:
        return ""
    shares = [c["total"]["total_usd"] / c["total"]["locked_usd"] for c in cases]
    text = (
        " An owner who sold one cargo a month at Amplify's quarter-end marks gave the windfall up on paper and "
        f"realised {', '.join(pct(x, 0) for x in shares[:-1])} and {pct(shares[-1], 0)} of what the marks of "
        f"{day(cases[0]['as_of'])} to {day(cases[-1]['as_of'])} locked, approximate figures from Breakwave's dollar "
        "prints."
    )
    measured = []
    for c in cases:
        t2 = c.get("total_two_prints") or {}
        if t2.get("locked_usd") and len(c.get("months_two_prints", [])) < len(c["months"]):
            months = " and ".join(month_name(m) for m in c["months_two_prints"])
            share2 = pct(t2["total_usd"] / t2["locked_usd"], 0)
            measured.append(f"the {day(c['as_of'])} marks realised {share2} on {months}")
    if measured:
        text += (
            " A month with one print settles at its own fixture; on the months with two prints or more, "
            + " and ".join(measured)
            + "."
        )
    missing = sorted({m for c in cases for m in c.get("months_without_print", [])})
    if missing:
        text += f" {' and '.join(month_name(m) for m in missing)} had no dollar print."
    worst = min(range(len(cases)), key=lambda i: shares[i])
    if shares[worst] < 0.9:
        rows = [m for m in cases[worst]["months"] if not m.get("single_print")] or cases[worst]["months"]
        month = max(rows, key=lambda m: m["settlement"] - m["physical"])
        text += (
            f" The {day(cases[worst]['as_of'])} hedge fell short because {month_name(month['month'])}'s cargo was "
            f"fixed at the month's first print, USD {month['physical']:,.2f} a tonne, while the paper settled near "
            f"USD {money2(month['settlement'])}: timing basis inside the month."
        )
    return text


def money2(x: float) -> str:
    """Two decimals, halves rounded up (186.215 to 186.22), as a reader rounds."""
    from decimal import ROUND_HALF_UP, Decimal

    return f"{Decimal(str(round(x, 6))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):,}"
