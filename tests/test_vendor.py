"""The vendored voyage engine: unmodified, and reproducing its own anchors."""

import hashlib
from pathlib import Path

import pytest

from ffabasis import voyage

VENDOR = Path(__file__).resolve().parents[1] / "vendor" / "voyage_tce"


def test_vendored_files_are_byte_for_byte_the_pinned_commit():
    lines = (VENDOR / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 6
    for line in lines:
        digest, name = line.split(maxsplit=1)
        assert hashlib.sha256((VENDOR / name).read_bytes()).hexdigest() == digest, name


@pytest.mark.parametrize(
    ("route", "date"),
    [("C3", "2026-07-03"), ("C5", "2026-07-03"), ("C3", "2026-10-23"), ("C5", "2026-10-23")],
)
def test_paper_tces_reproduce_to_1e_9(route, date):
    row = next(r for r in voyage.paper()["capesize"] if r["route"] == route and r["date"] == date)
    value = voyage.tce(voyage.anchor_inputs(route, date))
    assert abs(value / row["physical_tce_usd_day"] - 1.0) < 1e-9
    assert round(value, 6) == row["physical_tce_usd_day"]


def test_c3_week_27_anchor_named_in_the_brief():
    value = voyage.tce(voyage.anchor_inputs("C3", "2026-07-03"))
    assert voyage.anchor_inputs("C3", "2026-07-03")["freight_value"] == 30.11
    assert abs(value / 35429.099952 - 1.0) < 1e-9


def test_c5_fixture_of_22_october_2026():
    fixture = voyage.paper()["c5_fixture"]
    assert fixture["fixture_usd_t"] == 14.15
    value = voyage.tce(voyage.anchor_inputs("C5", "2026-10-23", freight_usd_t=14.15))
    assert abs(value / 43669.795671 - 1.0) < 1e-9
    assert round(value, 6) == fixture["fixture_tce_usd_day"]


def test_voyage_days_match_upstream_hedge_days():
    for row in voyage.paper()["capesize"]:
        days = voyage.total_days(voyage.anchor_inputs(row["route"], row["date"]))
        assert round(days, 6) == row["hedge_days"]


def test_build_keeps_upstream_inputs_but_the_week():
    template = voyage.anchor_inputs("C3", "2026-07-03")
    vessel = {
        "laden_kn": template["laden"]["speed_kn"],
        "ballast_kn": template["ballast"]["speed_kn"],
        "laden_curve": template["laden_curve"],
        "ballast_curve": template["ballast_curve"],
    }
    built = voyage.build("C3", 30.11, template["prices"], vessel, 170000)
    assert built == template
