"""The hedge engine: settlement, baskets, strips, basis and the paper side of a voyage.

Every function here is pure arithmetic on plain, JSON shaped values, so that
src/engine.js repeats it line for line and tools/validate-engine.mjs holds the
two within 1e-9 (relative) on the generated cases in data/fixtures/. Market
figures are inputs; the only constants are contract and convention figures,
each with its source.

Conventions (docs/methodology.md has the text each is read from):

* Capesize 5TC FFA (EEX CPTM for the 180,000 t basket, C5TCM for the 182,000 t
  one; the same at other venues): one day per lot, USD a day, settling on the
  arithmetic average of the Baltic's daily 5TC assessments over every trading
  day of the contract month (EEX contract specifications, release 047a,
  23 July 2026). A quarter settles on the average of its three months, a
  calendar on its twelve.
* From 2 January 2026 the Baltic assesses the basket for a 182,000 dwt ship and
  publishes the 180,000 t basket as the 182,000 t one less USD 3,503 a day
  (Guide to Market Benchmarks v8.8, page 77). Before that date only the
  180,000 t basket settled contracts.
* TD3C FFA (ICE TDL): 1,000 t a lot, USD a tonne to four decimals, settling on
  the average of the Baltic's TD3C assessments on each Baltic publication day
  of the contract month; the December contract stops on the 24th or the
  business day before.
* A time charter index and its FFA are gross daily hire, each route at its
  total commission; a voyage TCE is net. The voyage TCE is grossed up by its
  commission before it is set against the FFA (GMB v8.8, section 7.4.3,
  pages 35 and 36), and an owner who keeps the net share of what the index
  pays hedges its net earnings with the voyage's days times that share.
* Owners sell FFAs, charterers buy. A short receives (F minus S) x size, a
  long (S minus F) x size.
* Hedge size: FFA days equal to the voyage's days, spread over calendar months
  day by day from the fixture date (the ballast leg first), at the net share;
  a TD3C hedge in tonnes equal to the cargo.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any

PERCENT = 100.0

#: GMB v8.8, Appendix 2, page 77: C5TC(180) = C5TC(182) - 3,503 USD/day, from 2 January 2026.
C5TC_180_DIFFERENTIAL_USD_DAY = 3503.0
#: The first day the 182,000 t basket is the Baltic's 5TC (circulars 19/25 and 41/25, GMB v8.8 page 77).
BASKET_182_FROM = "2026-01-02"
BASKETS_T = (180000, 182000)
#: The Baltic's total commission on every Capesize route and the 5TC basket (GMB v8.8 pages 77 and 78).
CAPESIZE_COMMISSION_PCT = 5.0
#: Baltic tanker routes, TD3C among them, carry 3.75 percent total commission (circular 27/21; GMB v8.8 page 2).
TANKER_COMMISSION_PCT = 3.75
#: Contract sizes: one day a lot (EEX 5TC futures); 1,000 t a lot (ICE TDL).
DAYS_PER_LOT_5TC = 1.0
TONNES_PER_LOT_TD3C = 1000.0
#: The TD3C December contract settles over the days to the 24th (ICE TDL specification).
TD3C_DECEMBER_LAST_DAY = 24


def _total(values: Iterable[float]) -> float:
    """Left to right addition, the order src/engine.js adds in."""
    total = 0.0
    for value in values:
        total += value
    return total


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------


def is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def days_in_month(year: int, month: int) -> int:
    if month == 2:
        return 29 if is_leap(year) else 28
    return 30 if month in (4, 6, 9, 11) else 31


def parse_date(iso: str) -> tuple[int, int, int]:
    """'YYYY-MM-DD' as integers."""
    return int(iso[0:4]), int(iso[5:7]), int(iso[8:10])


def month_key(year: int, month: int) -> str:
    return "%04d-%02d" % (year, month)


def add_months(month: str, n: int) -> str:
    """'YYYY-MM' plus n months."""
    year, mon = int(month[0:4]), int(month[5:7])
    index = year * 12 + (mon - 1) + n
    return month_key(index // 12, index % 12 + 1)


def months_between(earlier: str, later: str) -> int:
    """Whole months from one 'YYYY-MM' to another."""
    return (int(later[0:4]) * 12 + int(later[5:7])) - (int(earlier[0:4]) * 12 + int(earlier[5:7]))


def quarter_of(month: str) -> str:
    """'YYYY-MM' to 'YYYY-Qn'."""
    return "%s-Q%d" % (month[0:4], (int(month[5:7]) - 1) // 3 + 1)


def quarter_months(quarter: str) -> list[str]:
    """'YYYY-Qn' to its three months."""
    year, q = quarter[0:4], int(quarter[6])
    first = (q - 1) * 3 + 1
    return [month_key(int(year), first + i) for i in range(3)]


def month_days(start: str, total_days: float) -> list[dict[str, Any]]:
    """A voyage's days spread over calendar months, day by day from the start date.

    The start date is the first day of the voyage (the fixture date, the
    ballast leg first). The first month counts its remaining days including
    the start date, each later month all its days, the last month the
    fraction left. Returns [{"month": "YYYY-MM", "days": d}, ...].
    """
    if total_days <= 0:
        raise ValueError("a voyage needs a positive number of days")
    year, month, day = parse_date(start)
    remaining = float(total_days)
    out: list[dict[str, Any]] = []
    first = True
    while remaining > 0:
        available = float(days_in_month(year, month) - (day - 1 if first else 0))
        span = available if available < remaining else remaining
        out.append({"month": month_key(year, month), "days": span})
        remaining -= span
        first = False
        month += 1
        if month == 13:
            month = 1
            year += 1
    return out


# ---------------------------------------------------------------------------
# Settlement and baskets
# ---------------------------------------------------------------------------


def settlement_average(values: Sequence[float]) -> float:
    """The arithmetic average of a contract month's assessments (every publication day)."""
    if not values:
        raise ValueError("no assessments to average")
    return _total(float(v) for v in values) / len(values)


def settles_on(day: str, month: str, product: str) -> bool:
    """Whether a publication day belongs to a contract month's settlement period.

    product '5tc': every publication day of the month. product 'td3c': every
    publication day, except that December stops on the 24th (a publication
    day after it, if any, does not count).
    """
    if day[0:7] != month:
        return False
    if product == "td3c" and month[5:7] == "12":
        return int(day[8:10]) <= TD3C_DECEMBER_LAST_DAY
    if product in ("5tc", "td3c"):
        return True
    raise ValueError("unknown product %s" % product)


def period_average(month_settlements: Mapping[str, float], months: Sequence[str]) -> float:
    """A quarter or calendar: the plain average of its months' settlements."""
    return _total(float(month_settlements[m]) for m in months) / len(months)


def basket_of(day: str) -> int:
    """The basket the Baltic's 5TC was assessed for on a date: 182,000 t from 2 January 2026."""
    return 182000 if day >= BASKET_182_FROM else 180000


def convert_basket(value_usd_day: float, from_t: int, to_t: int, day: str) -> float:
    """Move a 5TC value between the two baskets through the fixed differential.

    Only defined from 2 January 2026, when both baskets exist; before it the
    182,000 t basket did not settle contracts and no conversion is made.
    """
    if from_t == to_t:
        return float(value_usd_day)
    if day < BASKET_182_FROM:
        raise ValueError("no 182,000 t basket before %s" % BASKET_182_FROM)
    if (from_t, to_t) == (182000, 180000):
        return float(value_usd_day) - C5TC_180_DIFFERENTIAL_USD_DAY
    if (from_t, to_t) == (180000, 182000):
        return float(value_usd_day) + C5TC_180_DIFFERENTIAL_USD_DAY
    raise ValueError("unknown basket pair %s, %s" % (from_t, to_t))


# ---------------------------------------------------------------------------
# Strips, basis and curve shape
# ---------------------------------------------------------------------------


def strip_price(weights: Sequence[Mapping[str, Any]], prices: Mapping[str, float]) -> float:
    """The day weighted price of a strip: sum(days x price) / sum(days)."""
    days = _total(float(w["days"]) for w in weights)
    value = _total(float(w["days"]) * float(prices[w["month"]]) for w in weights)
    return value / days


def basis(ffa: float, spot: float) -> float:
    """Basis per tenor: FFA minus spot."""
    return float(ffa) - float(spot)


def shape(earlier: float, later: float) -> str:
    """Contango when the later tenor stands above the earlier one, backwardation below, flat when equal."""
    if later > earlier:
        return "contango"
    if later < earlier:
        return "backwardation"
    return "flat"


def gross_up(net_tce_usd_day: float, commission_pct: float) -> float:
    """A voyage TCE, net of commission, grossed up to compare with gross daily hire."""
    return float(net_tce_usd_day) / (1.0 - float(commission_pct) / PERCENT)


def net_share(commission_pct: float) -> float:
    return 1.0 - float(commission_pct) / PERCENT


# ---------------------------------------------------------------------------
# The paper side of a voyage
# ---------------------------------------------------------------------------


def hedge_lots(weights: Sequence[Mapping[str, Any]], commission_pct: float, ratio: float) -> list[dict[str, Any]]:
    """Time charter FFA days by month: the voyage's days at the net share, times the hedge ratio."""
    keep = net_share(commission_pct)
    return [{"month": w["month"], "days": float(w["days"]) * keep * float(ratio)} for w in weights]


def paper_pnl(role: str, ffa: float, settlement: float, size: float) -> float:
    """What the paper pays: a short (the owner) receives (F - S) x size, a long (the charterer) (S - F) x size."""
    if role == "owner":
        return (float(ffa) - float(settlement)) * float(size)
    if role == "charterer":
        return (float(settlement) - float(ffa)) * float(size)
    raise ValueError("role is owner or charterer")


def strip_pnl(
    role: str,
    lots: Sequence[Mapping[str, Any]],
    ffa: Mapping[str, float],
    settlement: Mapping[str, float],
) -> float:
    """The paper's result over a strip of monthly lots, each month at its own price and settlement."""
    return _total(paper_pnl(role, ffa[lot["month"]], settlement[lot["month"]], lot["days"]) for lot in lots)


def surprise(physical_gross: float, f0: float) -> float:
    """Unhedged surprise: the gross voyage TCE less the strip's FFA on the hedge date."""
    return float(physical_gross) - float(f0)


def hedged_surprise(physical_gross: float, f0: float, s: float, ratio: float) -> float:
    """The owner's surprise once hedged: (TCE - F0) - k x (S - F0)."""
    return (float(physical_gross) - float(f0)) - float(ratio) * (float(s) - float(f0))


def outcome(
    role: str,
    physical_rate: float,
    f0: float,
    s: float,
    days: float,
    commission_pct: float,
    ratio: float,
) -> dict[str, float]:
    """A hedged voyage at a settlement scenario, per voyage and per day.

    physical_rate is the gross rate the voyage earns (a 5TC trip's hire, or a
    voyage TCE grossed up); f0 the strip's FFA on the hedge date; s the strip's
    settlement. The owner earns the physical and is short the paper; the
    charterer pays the physical and is long. Money is net of commission on
    both legs, since the hedge is sized at the net share.
    """
    keep = net_share(commission_pct)
    size = float(days) * keep * float(ratio)
    physical = float(physical_rate) * float(days) * keep
    paper = paper_pnl(role, f0, s, size)
    if role == "owner":
        total = physical + paper
        locked = float(f0) * float(days) * keep
    else:
        total = -physical + paper
        locked = -float(f0) * float(days) * keep
    return {
        "size_days": size,
        "physical_usd": physical if role == "owner" else -physical,
        "paper_usd": paper,
        "total_usd": total,
        "locked_usd": locked,
        "total_usd_day": total / float(days),
        "versus_locked_usd": total - locked,
    }


def td3c_outcome(
    role: str, physical_usd_t: float, f0: float, s: float, tonnes: float, ratio: float
) -> dict[str, float]:
    """A TD3C cargo hedged in tonnes: freight at physical_usd_t, paper at f0 against settlement s (USD a tonne)."""
    size = float(tonnes) * float(ratio)
    physical = float(physical_usd_t) * float(tonnes)
    paper = paper_pnl(role, f0, s, size)
    sign = 1.0 if role == "owner" else -1.0
    total = sign * physical + paper
    locked = sign * float(f0) * float(tonnes)
    return {
        "size_t": size,
        "lots": size / TONNES_PER_LOT_TD3C,
        "physical_usd": sign * physical,
        "paper_usd": paper,
        "total_usd": total,
        "locked_usd": locked,
        "versus_locked_usd": total - locked,
    }


def ws_to_usd_t(ws_points: float, flat_rate_usd_t: float) -> float:
    """Worldscale points to USD a tonne: WS / 100 x flat rate."""
    return float(ws_points) / PERCENT * float(flat_rate_usd_t)


def implied_flat_rate(usd_t: float, ws_points: float) -> float:
    """The flat rate a dated pair implies: USD a tonne x 100 / WS."""
    return float(usd_t) * PERCENT / float(ws_points)


def constants() -> dict[str, Any]:
    """Every constant the engine computes with, for src/engine.js, which holds no figure of its own."""
    return {
        "PERCENT": PERCENT,
        "C5TC_180_DIFFERENTIAL_USD_DAY": C5TC_180_DIFFERENTIAL_USD_DAY,
        "BASKET_182_FROM": BASKET_182_FROM,
        "CAPESIZE_COMMISSION_PCT": CAPESIZE_COMMISSION_PCT,
        "TANKER_COMMISSION_PCT": TANKER_COMMISSION_PCT,
        "DAYS_PER_LOT_5TC": DAYS_PER_LOT_5TC,
        "TONNES_PER_LOT_TD3C": TONNES_PER_LOT_TD3C,
        "TD3C_DECEMBER_LAST_DAY": TD3C_DECEMBER_LAST_DAY,
    }
