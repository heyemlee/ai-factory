"""
Compatibility facade for the efficient cutting engine.

The implementation was split into ``cutting.efficient`` modules:
constants, primitives, loaders, demand, packing, validator, and engine.
Keep this file small so older imports such as ``from cutting.cutting_engine
import run_engine`` continue to work.

Deprecated legacy wrappers ``match_parts_to_boards`` and ``ffd_bin_pack`` were
removed during the split because they had no callers.
"""

from cutting.efficient.constants import (
    BOARD_HEIGHT,
    COMMON_RECOVERY_WIDTHS,
    DEFAULT_BOARD_T0,
    DEFAULT_BOARD_T1_NARROW,
    DEFAULT_BOARD_T1_WIDE,
    DEFAULT_BOX_COLOR,
    EDGE_BANDED_RECOVERY_WIDTHS,
    HEIGHT_TRIM_THRESHOLD,
    MIN_RECOVERABLE_WIDTH,
    SAW_KERF,
    STRIP_WIDTH_NARROW,
    STRIP_WIDTH_WIDE,
    TRIM_LOSS,
)
from cutting.efficient.demand import (
    _count_strips_needed,
    _split_parts_for_strips,
    apply_inventory,
    build_strip_demand,
)
from cutting.efficient.engine import _run_pipeline_for_color, main, run_engine
from cutting.efficient.loaders import (
    deduct_inventory_supabase,
    load_inventory,
    load_inventory_from_supabase,
    load_non_recoverable_board_types,
    load_parts,
    load_recovery_specs_from_supabase,
)
from cutting.efficient.packing import ffd_strip_pack
from cutting.efficient.primitives import (
    _cut_length,
    _cut_width,
    _format_width_for_code,
    _width_from_board_type,
    common_recovery_board_type,
    normalize_recovery_spec,
    strip_height_trim,
    strip_usable_height,
)
from cutting.efficient.validator import _validate_cut_result

__all__ = [
    "BOARD_HEIGHT",
    "COMMON_RECOVERY_WIDTHS",
    "DEFAULT_BOARD_T0",
    "DEFAULT_BOARD_T1_NARROW",
    "DEFAULT_BOARD_T1_WIDE",
    "DEFAULT_BOX_COLOR",
    "EDGE_BANDED_RECOVERY_WIDTHS",
    "HEIGHT_TRIM_THRESHOLD",
    "MIN_RECOVERABLE_WIDTH",
    "SAW_KERF",
    "STRIP_WIDTH_NARROW",
    "STRIP_WIDTH_WIDE",
    "TRIM_LOSS",
    "_count_strips_needed",
    "_cut_length",
    "_cut_width",
    "_format_width_for_code",
    "_run_pipeline_for_color",
    "_split_parts_for_strips",
    "_validate_cut_result",
    "_width_from_board_type",
    "apply_inventory",
    "build_strip_demand",
    "common_recovery_board_type",
    "deduct_inventory_supabase",
    "ffd_strip_pack",
    "load_inventory",
    "load_inventory_from_supabase",
    "load_non_recoverable_board_types",
    "load_parts",
    "load_recovery_specs_from_supabase",
    "main",
    "normalize_recovery_spec",
    "run_engine",
    "strip_height_trim",
    "strip_usable_height",
]


if __name__ == "__main__":
    main()
