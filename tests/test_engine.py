"""The hedge engine's formulas, with numbers checked by hand."""

import pytest

from ffabasis import engine


def test_month_days_from_the_fixture_date_counts_the_start_day():
    # 76.522292 days from 3 July 2026: 29 days of July (3 to 31), all of August, the rest in September,
    # as voyage-tce-model's ffa_strip spreads its C3 voyage of the week to 3 July 2026.
    weights = engine.month_days("2026-07-03", 76.522292)
    assert [w["month"] for w in weights] == ["2026-07", "2026-08", "2026-09"]
    assert weights[0]["days"] == 29.0
    assert weights[1]["days"] == 31.0
    assert weights[2]["days"] == pytest.approx(16.522292, abs=1e-12)


def test_month_days_crosses_a_year_and_a_leap_february():
    weights = engine.month_days("2027-12-30", 63.5)
    assert [w["month"] for w in weights] == ["2027-12", "2028-01", "2028-02", "2028-03"]
    assert [w["days"] for w in weights] == [2.0, 31.0, 29.0, 1.5]
    assert sum(w["days"] for w in weights) == 63.5


def test_month_days_inside_one_month():
    assert engine.month_days("2026-02-10", 5.25) == [{"month": "2026-02", "days": 5.25}]


def test_month_days_refuses_no_days():
    with pytest.raises(ValueError):
        engine.month_days("2026-02-10", 0)


def test_month_arithmetic():
    assert engine.add_months("2026-11", 3) == "2027-02"
    assert engine.add_months("2026-01", -1) == "2025-12"
    assert engine.months_between("2025-11", "2026-02") == 3
    assert engine.quarter_of("2026-08") == "2026-Q3"
    assert engine.quarter_months("2027-Q1") == ["2027-01", "2027-02", "2027-03"]


def test_settlement_is_the_plain_average_of_publication_days():
    assert engine.settlement_average([30000, 31000, 35000]) == 32000.0
    with pytest.raises(ValueError):
        engine.settlement_average([])


def test_quarter_settles_on_its_three_months():
    months = {"2026-07": 30000.0, "2026-08": 33000.0, "2026-09": 36000.0}
    assert engine.period_average(months, engine.quarter_months("2026-Q3")) == 33000.0


def test_td3c_december_stops_on_the_24th_and_5tc_does_not():
    assert engine.settles_on("2025-12-24", "2025-12", "td3c")
    assert not engine.settles_on("2025-12-29", "2025-12", "td3c")
    assert engine.settles_on("2025-12-29", "2025-12", "5tc")
    assert engine.settles_on("2025-11-28", "2025-11", "td3c")
    assert not engine.settles_on("2025-11-28", "2025-12", "5tc")


def test_the_2026_basket_boundary_and_the_fixed_differential():
    assert engine.basket_of("2025-12-24") == 180000
    assert engine.basket_of("2026-01-02") == 182000
    # 3 July 2026: handybulk 37,181 (182,000 t) against Signal Group about 33,678 (180,000 t).
    assert engine.convert_basket(37181, 182000, 180000, "2026-07-03") == 33678.0
    # 29 July 2026: handybulk 36,887 against Reuters 33,384.
    assert engine.convert_basket(33384, 180000, 182000, "2026-07-29") == 36887.0
    with pytest.raises(ValueError):
        engine.convert_basket(20000, 180000, 182000, "2025-12-24")
    assert engine.convert_basket(20000, 180000, 180000, "2024-05-01") == 20000.0


def test_strip_price_is_day_weighted():
    weights = [
        {"month": "2026-07", "days": 29.0},
        {"month": "2026-08", "days": 31.0},
        {"month": "2026-09", "days": 10.0},
    ]
    prices = {"2026-07": 36000.0, "2026-08": 37000.0, "2026-09": 38000.0}
    expected = (29 * 36000 + 31 * 37000 + 10 * 38000) / 70
    assert engine.strip_price(weights, prices) == pytest.approx(expected, rel=1e-15)


def test_shape_and_basis():
    assert engine.shape(30000, 31000) == "contango"
    assert engine.shape(31000, 30000) == "backwardation"
    assert engine.shape(30000, 30000) == "flat"
    assert engine.basis(38360, 35357) == 3003.0


def test_gross_up_matches_the_upstream_paper_view():
    # voyage-tce-model data/paper.json: C3 in the week to 3 July 2026, 35,429.099952 net, 37,293.789423 gross.
    assert round(engine.gross_up(35429.099952, 5.0), 6) == 37293.789423


def test_hedge_lots_at_the_net_share():
    weights = engine.month_days("2026-07-03", 76.522292)
    lots = engine.hedge_lots(weights, 5.0, 1.0)
    assert sum(lot["days"] for lot in lots) == pytest.approx(76.522292 * 0.95, rel=1e-12)
    # voyage-tce-model prints 72.696177 net hedge days for this voyage
    assert round(sum(lot["days"] for lot in lots), 6) == 72.696177


def test_owner_is_short_and_charterer_long():
    assert engine.paper_pnl("owner", 20000, 18000, 10) == 20000.0
    assert engine.paper_pnl("charterer", 20000, 18000, 10) == -20000.0
    with pytest.raises(ValueError):
        engine.paper_pnl("broker", 1, 1, 1)


def test_hedged_surprise():
    # TCE 25,000, F0 20,000, S 24,000: unhedged +5,000; at k = 1 the residual is TCE - S = 1,000.
    assert engine.surprise(25000, 20000) == 5000.0
    assert engine.hedged_surprise(25000, 20000, 24000, 1.0) == 1000.0
    assert engine.hedged_surprise(25000, 20000, 24000, 0.5) == 3000.0


def test_outcome_locks_the_forward_when_basis_is_nil():
    # Physical earns exactly the settlement: a full hedge returns the forward.
    result = engine.outcome("owner", 24000, 20000, 24000, 30, 5.0, 1.0)
    assert result["total_usd"] == pytest.approx(20000 * 30 * 0.95, rel=1e-15)
    assert result["versus_locked_usd"] == pytest.approx(0.0, abs=1e-9)
    mirror = engine.outcome("charterer", 24000, 20000, 24000, 30, 5.0, 1.0)
    assert mirror["total_usd"] == pytest.approx(-20000 * 30 * 0.95, rel=1e-15)


def test_td3c_outcome_in_tonnes_and_lots():
    result = engine.td3c_outcome("owner", 30.0, 25.0, 28.0, 270000, 1.0)
    assert result["lots"] == 270.0
    assert result["paper_usd"] == pytest.approx(-3.0 * 270000)
    assert result["total_usd"] == pytest.approx(25.0 * 270000 + 2.0 * 270000)


def test_sec_divisions_are_exact_at_one_day_and_1000_tonnes_a_lot():
    # Amplify Commodity Trust 10-Q, quarter ended 30 September 2025: BDRY Capesize and BWET TD3C.
    for notional, contracts, price in ((6837600, 275, 24864), (6794425, 275, 24707), (6358275, 275, 23121)):
        assert notional / (contracts * engine.DAYS_PER_LOT_5TC) == price
    for notional, contracts, price in ((609420, 35, 17.412), (569975, 35, 16.285), (561645, 35, 16.047)):
        assert round(notional / (contracts * engine.TONNES_PER_LOT_TD3C), 4) == price
        assert notional % 35 == 0


def test_worldscale_and_implied_flat_rate():
    assert engine.ws_to_usd_t(125.78, 20.0) == pytest.approx(25.156)
    assert engine.implied_flat_rate(25.156, 125.78) == pytest.approx(20.0)
