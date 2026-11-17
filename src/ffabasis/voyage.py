"""The physical voyage: voyage-tce-model's engine, vendored unmodified, wrapped.

vendor/voyage_tce/ holds src/voyage/engine.py, src/voyage/baltic.py,
src/engine.js and data/paper.json from voyage-tce-model at commit
0be3b7eb0c1bfda63135ce717b5cb4b335426532, byte for byte (tests/test_vendor.py
checks their sha256). This module loads them by path and builds the inputs of
a weekly C3 or C5 voyage from the upstream Paper view's own voyage of the same
route, changing only what the week changes:

* the freight, USD a tonne, from that week's report;
* the bunker prices at the route's hub (Singapore for both, as upstream);
* the vessel of the date: the Baltic's BCI182 from 2 January 2026, with the
  speeds and consumptions of GMB v8.8 page 78 (as upstream); before that date
  the BCI180, whose description GMB v8.8 no longer prints, from the dated
  source recorded in data/seed/conventions.json;
* C3's cargo of the date: 170,000 t from 2 January 2025 (Baltic circular
  44/24, recorded upstream), the earlier cargo before it, with its discharge
  days at the route's 30,000 t a day plus 24 hours turn time.

Everything else (distances, port days, commission, the 5 percent weather
margin, no ECA or ETS exposure, no war risk) is the upstream input unchanged.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
from functools import cache
from pathlib import Path
from types import ModuleType
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
VENDOR = ROOT / "vendor" / "voyage_tce"
PINNED_COMMIT = "0be3b7eb0c1bfda63135ce717b5cb4b335426532"

#: The upstream Paper view's anchor rows: C3 and C5 in the week to 3 July 2026 are the route templates.
TEMPLATE_DATE = "2026-07-03"


def _load(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@cache
def engine() -> ModuleType:
    """The vendored voyage engine (voyage-tce-model src/voyage/engine.py)."""
    return _load("voyage_tce_engine", VENDOR / "src" / "voyage" / "engine.py")


@cache
def baltic() -> ModuleType:
    """The vendored route and vessel definitions (voyage-tce-model src/voyage/baltic.py)."""
    return _load("voyage_tce_baltic", VENDOR / "src" / "voyage" / "baltic.py")


@cache
def paper() -> dict[str, Any]:
    """The vendored data/paper.json of voyage-tce-model."""
    return json.loads((VENDOR / "data" / "paper.json").read_text(encoding="utf-8"))


def template(route: str) -> dict[str, Any]:
    """The upstream inputs of a route's voyage in the week to 3 July 2026, copied."""
    for row in paper()["capesize"]:
        if row["route"] == route and row["date"] == TEMPLATE_DATE:
            return copy.deepcopy(row["inputs"])
    raise KeyError(route)


def tce(inputs: dict[str, Any]) -> float:
    return float(engine().evaluate(inputs)["tce_usd_day"])


def total_days(inputs: dict[str, Any]) -> float:
    return float(engine().days(inputs)["total"])


def build(
    route: str,
    freight_usd_t: float,
    prices: dict[str, float],
    vessel: dict[str, Any],
    cargo_t: float,
) -> dict[str, Any]:
    """A C3 or C5 voyage's engine inputs for one week.

    vessel: {"laden_kn", "ballast_kn", "laden_curve", "ballast_curve"} with
    curves as [[knots, tonnes a day], ...]. prices: vlsfo_usd_t, hsfo_usd_t,
    mgo_usd_t at the route's hub.
    """
    if route not in ("C3", "C5"):
        raise ValueError("the study prices C3 and C5")
    inputs = template(route)
    inputs["freight_basis"] = "usd_t"
    inputs["freight_value"] = float(freight_usd_t)
    inputs["prices"] = {
        "vlsfo_usd_t": float(prices["vlsfo_usd_t"]),
        "hsfo_usd_t": float(prices["hsfo_usd_t"]),
        "mgo_usd_t": float(prices["mgo_usd_t"]),
    }
    inputs["laden"]["speed_kn"] = vessel["laden_kn"]
    inputs["ballast"]["speed_kn"] = vessel["ballast_kn"]
    inputs["laden_curve"] = [list(p) for p in vessel["laden_curve"]]
    inputs["ballast_curve"] = [list(p) for p in vessel["ballast_curve"]]
    inputs["cargo_t"] = cargo_t
    inputs["port"]["discharge_days"] = discharge_days(cargo_t)
    return inputs


#: GMB v8.8 page 77, C3 and C5: discharge at 30,000 t a day Sundays and holidays included, 24 hours turn time.
DISCHARGE_RATE_TPD = 30000.0
DISCHARGE_TURN_H = 24.0


def discharge_days(cargo_t: float) -> float:
    """Days at the discharge port by the route's terms, at full precision.

    The upstream paper.json prints its inputs to six decimals (6.666667 for
    170,000 t); its TCEs were computed with the exact value, which this rule
    gives, and with which the vendored engine reproduces them within 1e-11.
    """
    return float(cargo_t) / DISCHARGE_RATE_TPD + DISCHARGE_TURN_H / 24.0


def anchor_inputs(route: str, date: str, freight_usd_t: float | None = None) -> dict[str, Any]:
    """The upstream Paper inputs of a route and week, discharge days by the rule, freight optionally replaced."""
    for row in paper()["capesize"]:
        if row["route"] == route and row["date"] == date:
            inputs = copy.deepcopy(row["inputs"])
            inputs["port"]["discharge_days"] = discharge_days(inputs["cargo_t"])
            if freight_usd_t is not None:
                inputs["freight_value"] = float(freight_usd_t)
            return inputs
    raise KeyError((route, date))
