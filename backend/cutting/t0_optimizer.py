"""
Compatibility facade for T0 mixed-strip optimization.

The implementation was split into ``cutting.t0.packer``,
``cutting.t0.recovery``, and ``cutting.t0.planner``. Keep this module so old
imports such as ``from cutting.t0_optimizer import optimize_t0_from_strips``
continue to resolve.
"""

from cutting.t0 import (
    _best_recovery_combo,
    _legacy_recover,
    compute_t0_plan,
    optimize_t0_cutting,
    optimize_t0_from_strips,
    recover_leftover,
)

__all__ = [
    "optimize_t0_from_strips",
    "_best_recovery_combo",
    "_legacy_recover",
    "recover_leftover",
    "compute_t0_plan",
    "optimize_t0_cutting",
]
