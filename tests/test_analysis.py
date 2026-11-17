"""Statistics, analysis rules and parsers, with numbers checked by hand and synthetic report text."""

import datetime as dt
import json
from pathlib import Path

import pytest

from ffabasis import analysis, daily, engine, hedge, panel, stats, td3c
from ffabasis.sources import bancosta, himalaya, reuters, tankers

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache" / "panel.json"


# ---------------------------------------------------------------- statistics


def test_effectiveness_and_min_variance_ratio():
    u = [1.0, 2.0, 3.0, 4.0]
    assert stats.effectiveness(u, [0.5, 1.0, 1.5, 2.0]) == pytest.approx(0.75)
    x = [0.5, 1.0, 1.5, 2.0]
    assert stats.min_variance_ratio(u, x) == pytest.approx(2.0)
    # At k* the hedged series is constant: everything removed.
    k = stats.min_variance_ratio(u, x)
    assert stats.effectiveness(u, [a - k * b for a, b in zip(u, x, strict=True)]) == pytest.approx(1.0)


def test_cvar_is_the_mean_of_the_worst_tail_as_a_loss():
    assert stats.cvar([-10, -5, 0, 5, 10], alpha=0.2) == 10.0
    assert stats.cvar([-10, -6, 0, 5, 10, 12, 14, 15, 20, 30], alpha=0.2) == 8.0


def test_ederington_r_squared_of_an_exact_relation():
    f = [1.0, -2.0, 3.0, 0.5, -1.0]
    result = stats.ederington([0.5 * v for v in f], f)
    assert result["hedge_ratio"] == pytest.approx(0.5)
    assert result["r_squared"] == pytest.approx(1.0)


def test_block_bootstrap_is_reproducible_and_brackets_the_estimate():
    values = [float((i * 37) % 11) for i in range(80)]
    first = stats.block_bootstrap(values, stats.mean, block=8)
    again = stats.block_bootstrap(values, stats.mean, block=8)
    assert first == again
    assert first["low"] <= first["estimate"] <= first["high"]
    assert first["resamples"] == 2000 and first["seed"] == stats.SEED


def test_rmse_and_share_positive():
    assert stats.rmse([3.0, -4.0]) == pytest.approx((12.5) ** 0.5)
    assert stats.share_positive([1, -1, 2, 0]) == 0.5


# ------------------------------------------------------------- analysis rules


def test_months_back_keeps_the_day_or_the_months_last():
    assert analysis.months_back("2026-03-31", 1) == "2026-02-28"
    assert analysis.months_back("2026-05-15", 3) == "2026-02-15"
    assert analysis.months_back("2026-01-10", 2) == "2025-11-10"


def test_price_uses_the_month_else_its_quarter_as_a_proxy():
    curve = {"tenors": {"2026-10": 39535.0, "2026-12": 37621.0, "2027-Q1": 28157.0}}
    assert analysis.price(curve, "2026-10") == (39535.0, False)
    assert analysis.price(curve, "2027-02") == (28157.0, True)
    assert analysis.price(curve, "2026-11") == (None, False)
    assert analysis.price(curve, "2027-02", allow_proxy=False) == (None, False)


def test_block_months_follows_horizon_weeks_plus_four():
    assert [analysis.block_months(h) for h in (1, 2, 3)] == [2, 3, 4]


def test_settlement_hierarchy_complete_published_estimated():
    months = [
        {
            "month": "2026-06",
            "complete": True,
            "settlement_180_usd_day": 35414.05,
            "observed_days": 22,
            "expected_days": 22,
            "coverage": 1.0,
            "partial_average_180_usd_day": 35414.05,
        },
        {
            "month": "2025-06",
            "complete": False,
            "settlement_180_usd_day": None,
            "observed_days": 7,
            "expected_days": 21,
            "coverage": 0.33,
            "partial_average_180_usd_day": 23000.0,
        },
        {
            "month": "2022-06",
            "complete": False,
            "settlement_180_usd_day": None,
            "observed_days": 5,
            "expected_days": 20,
            "coverage": 0.25,
            "partial_average_180_usd_day": 29000.0,
        },
        {
            "month": "2022-07",
            "complete": False,
            "settlement_180_usd_day": None,
            "observed_days": 2,
            "expected_days": 21,
            "coverage": 0.1,
            "partial_average_180_usd_day": 22000.0,
        },
    ]
    daily_days = {"2025-06-02": {}, "2025-06-27": {}, "2022-06-03": {}, "2022-06-24": {}, "2022-07-01": {}}
    p = {
        "months": months,
        "daily": daily_days,
        "published_5tc": [{"month": "2025-06", "value_usd_day": 24076.0, "url": "u"}],
    }
    s = analysis.settlements(p)
    assert s["2026-06"]["status"] == "complete"
    assert s["2025-06"]["status"] == "published" and s["2025-06"]["value_180"] == 24076.0
    assert s["2022-06"]["status"] == "estimated"
    assert "2022-07" not in s
    assert analysis.settlement_in(s, "2026-06", 182000) == pytest.approx(35414.05 + 3503)
    assert analysis.settlement_in(s, "2025-06", 182000) is None


def test_hedge_summary_matches_a_hand_computation():
    rows = []
    for i in range(12):
        u = float((i % 5) * 1000 - 2000)
        x = 0.8 * u + float((i % 3) - 1) * 100
        rows.append(
            {
                "horizon_months": 1,
                "fixture": "2026-%02d-01" % (i + 1) if i < 9 else "2026-1%d-01" % (i - 9),
                "unhedged": u,
                "paper_move": x,
                "route_basis": 0.0,
                "timing_basis": u - x,
                "size_basis": 0.0,
                "last_month": "2026-01",
                "hedged_on": "2025-12-01",
            }
        )
    s = hedge.summarise(rows, 1)
    u = [r["unhedged"] for r in sorted(rows, key=lambda r: r["fixture"])]
    h = [r["unhedged"] - r["paper_move"] for r in sorted(rows, key=lambda r: r["fixture"])]
    assert s["effectiveness_k1"] == pytest.approx(1 - stats.variance(h) / stats.variance(u))
    assert s["residual_variance_share"]["timing"] == pytest.approx(1.0)


def test_out_of_sample_ratio_uses_only_settled_outcomes():
    rows = [
        {"unhedged": float(i), "paper_move": float(i) / 2, "last_month": "2024-01", "hedged_on": "2024-03-01"}
        for i in range(60)
    ]
    rows.append({"unhedged": 1.0, "paper_move": 1.0, "last_month": "2025-01", "hedged_on": "2024-01-15"})
    ks = hedge.out_of_sample_ratios(rows)
    assert ks[0] == pytest.approx(2.0)
    assert ks[-1] is None  # its hedge date precedes every settlement


def test_ocr_rows_must_reproduce_their_printed_change():
    assert panel._wow_consistent({"current": 28660.0, "previous": 28235.0, "wow_printed": "+1.5%"})
    # OCR reads a "+" as "4" ("+2.7%" as "42.7%"): the printed magnitude modulo 10 still has to match.
    assert panel._wow_consistent({"current": 34307.0, "previous": 33399.0, "wow_printed": "42.7%"})
    # A misread figure (84,307 for 34,307) does not reproduce the printed change and is dropped.
    assert panel._wow_consistent({"current": 84307.0, "previous": 33399.0, "wow_printed": "+2.7%"}) is False
    assert bancosta.wow_consistent({"current": 25346.0, "previous": 22965.0, "wow_printed": "+10.4%"})


# --------------------------------------------------------------------- parsers


def test_reuters_parser_and_basket():
    text = (
        "The capesize index fell 73 points, or 1.8%, to 4,067 on Wednesday. Average daily earnings for capesize "
        "vessels, which typically carry 150,000-ton cargoes, fell $664 to $33,384."
    )
    row = reuters.parse(text, dt.date(2026, 7, 29))
    assert row["date"] == "2026-07-29" and row["c5tc_usd_day"] == 33384 and row["change_usd_day"] == -664
    assert row["basket_t"] == 180000  # 4,067 is 0.11026 x (33,384 + 3,503)
    pre = reuters.parse(
        "Average daily earnings for capesize vessels rose $1,039 to $20,807 on Tuesday.", dt.date(2023, 5, 10)
    )
    assert pre["date"] == "2023-05-09" and pre["basket_t"] == 180000


def test_tanker_parser_reads_the_close_not_the_week_passed_through():
    text = (
        "VLCC The rate for the TD3C route (270,000 mt Middle East Gulf to China) rose from WS100.00 last Friday "
        "to WS120.50 on Thursday. This gives a daily round-trip TCE of US$110,000 for the standard Baltic VLCC. "
        "TD34 (Gulf of Oman/China) gained 10 points to WS80.25, giving a round-trip TCE of US$70,000/day. "
        "Suezmax In the Suezmax sector rates fell."
    )
    row = tankers.parse(text, dt.date(2026, 9, 18))
    assert row["td3c_ws_points"] == 120.5 and row["td3c_tce_usd_day"] == 110000
    assert row["td34_ws_points"] == 80.25 and row["assessed_day"] == "Thursday"
    old = tankers.parse(
        "VLCC The rate for the 270,000 mt Middle East Gulf to China climbed to WS74.55 on Tuesday "
        "easing back to be assessed at WS71.5 and corresponds to a daily round-trip TCE of $48,914. "
        "In the Atlantic market rates rose.",
        dt.date(2024, 3, 8),
    )
    assert old["td3c_ws_points"] == 71.5 and old["td3c_tce_usd_day"] == 48914


def test_himalaya_sentence():
    rows = himalaya.AVERAGE_RE.search("The Baltic 5TC 180 Capesize Index averaged US$35,414 during June 2026.")
    assert rows.group("value") == "35,414" and rows.group("month") == "June" and rows.group("basket").strip() == "180"


def test_flat_rate_period_splits_2025_at_july():
    assert td3c.period_of("2025-06-30") == "2025-H1"
    assert td3c.period_of("2025-07-01") == "2025-H2"
    assert td3c.period_of("2026-03-01") == "2026"


# ---------------------------------------------------------------- daily pool


def test_pool_implies_the_previous_day_and_checks_the_chain():
    obs = [
        {
            "date": "2026-07-28",
            "c5tc_usd_day": 37551,
            "change_usd_day": -539,
            "basket_t": 182000,
            "source": "handybulk.com",
        },
        {
            "date": "2026-07-29",
            "c5tc_usd_day": 33384,
            "change_usd_day": -664,
            "basket_t": 180000,
            "source": "Reuters via Maritime Professional",
        },
    ]
    days = daily.pool(obs)
    assert days["2026-07-28"]["value_180"] == 37551 - 3503
    assert days["2026-07-27"]["kind"] == "implied" and days["2026-07-27"]["value_180"] == 37551 + 539 - 3503
    assert days["2026-07-28"]["chain"][0]["ok"]


# ------------------------------------------------------- anchors in the cache


@pytest.mark.skipif(not CACHE.exists(), reason="the licensed panel is built by make data")
def test_every_validation_anchor_reproduces():
    from ffabasis import content, results

    p = json.loads(CACHE.read_text(encoding="utf-8"))
    rows = content.validation(p, results.compute(p))
    failures = [r for r in rows if not r["ok"]]
    assert not failures, failures
    assert len(rows) >= 50


@pytest.mark.skipif(not CACHE.exists(), reason="the licensed panel is built by make data")
def test_2026_curves_are_on_the_182_basket_and_earlier_ones_on_180():
    p = json.loads(CACHE.read_text(encoding="utf-8"))
    for date, curve in p["curves"].items():
        if curve.get("tenors"):
            expected = 182000 if date >= engine.BASKET_182_FROM else 180000
            assert curve["basket_t"] == expected, (date, curve.get("basket_how"))
