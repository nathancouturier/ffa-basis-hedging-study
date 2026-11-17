"""Statistics the analysis reports: moments, effectiveness, the minimum variance ratio, CVaR, the bootstrap.

All pure functions on lists of floats. The bootstrap is a moving block
bootstrap (Kunsch 1989) with a fixed seed, so every interval the site prints
is reproduced exactly by `make analysis`.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

import numpy as np

SEED = 20261117
RESAMPLES = 2000
INTERVAL = 0.90


def mean(values: Sequence[float]) -> float:
    return float(np.mean(values))


def median(values: Sequence[float]) -> float:
    return float(np.median(values))


def variance(values: Sequence[float]) -> float:
    """Sample variance (n - 1)."""
    return float(np.var(values, ddof=1))


def rmse(errors: Sequence[float]) -> float:
    return math.sqrt(float(np.mean(np.square(errors))))


def share_positive(values: Sequence[float]) -> float:
    return float(np.mean(np.asarray(values) > 0))


def effectiveness(unhedged: Sequence[float], hedged: Sequence[float]) -> float:
    """1 - Var(hedged) / Var(unhedged): the share of the variance the hedge removes."""
    return 1.0 - variance(hedged) / variance(unhedged)


def min_variance_ratio(unhedged: Sequence[float], paper_move: Sequence[float]) -> float:
    """k* = Cov(U, S - F0) / Var(S - F0): the ratio that minimises Var(U - k (S - F0))."""
    u = np.asarray(unhedged, dtype=float)
    x = np.asarray(paper_move, dtype=float)
    return float(np.cov(u, x, ddof=1)[0, 1] / np.var(x, ddof=1))


def cvar(values: Sequence[float], alpha: float = 0.05) -> float:
    """Expected shortfall: the mean of the worst alpha share of outcomes (lowest), as a positive loss."""
    ordered = np.sort(np.asarray(values, dtype=float))
    count = max(1, math.ceil(alpha * len(ordered)))
    return float(-np.mean(ordered[:count]))


def ederington(spot_changes: Sequence[float], futures_changes: Sequence[float]) -> dict[str, float]:
    """Ederington (1979): regress spot changes on futures changes; R squared is the hedge's effectiveness."""
    s = np.asarray(spot_changes, dtype=float)
    f = np.asarray(futures_changes, dtype=float)
    beta = float(np.cov(s, f, ddof=1)[0, 1] / np.var(f, ddof=1))
    corr = float(np.corrcoef(s, f)[0, 1])
    return {"hedge_ratio": beta, "r_squared": corr * corr, "n": float(len(s))}


def block_bootstrap(
    series: Sequence[Sequence[float]] | Sequence[float],
    statistic: Callable[..., float],
    block: int,
    resamples: int = RESAMPLES,
    seed: int = SEED,
    level: float = INTERVAL,
) -> dict[str, float]:
    """A moving block bootstrap interval for a statistic of one or more aligned series.

    series: one list, or a tuple of aligned lists (resampled together, row by
    row). Blocks of `block` consecutive rows start at uniformly drawn rows and
    are joined until the sample is as long as the original. Returns the
    statistic on the original data and the (1 - level) / 2 and (1 + level) / 2
    percentiles of the resampled statistics.
    """
    columns = (
        [np.asarray(series, dtype=float)] if np.ndim(series[0]) == 0 else [np.asarray(c, dtype=float) for c in series]
    )
    n = len(columns[0])
    block = max(1, min(block, n))
    rng = np.random.default_rng(seed)
    starts_count = n - block + 1
    draws = math.ceil(n / block)
    estimates = np.empty(resamples)
    for r in range(resamples):
        starts = rng.integers(0, starts_count, size=draws)
        index = (starts[:, None] + np.arange(block)[None, :]).ravel()[:n]
        estimates[r] = statistic(*[c[index] for c in columns])
    low, high = np.percentile(estimates, [100 * (1 - level) / 2, 100 * (1 + level) / 2])
    return {
        "estimate": float(statistic(*columns)),
        "low": float(low),
        "high": float(high),
        "block": block,
        "resamples": resamples,
        "seed": seed,
    }
