"""
Compatibility facade for the stack-efficiency cutting engine.

The implementation lives under ``cutting.stack``. This file preserves the old
module path for imports while keeping the backend folder free of 1k+ line
algorithm files.
"""

from cutting.stack.allocation import (
    _allocate_stretcher_from_inventory_width,
    _allocate_stretcher_from_t0_residual,
    _allocate_stretcher_from_t0_standard,
    _allocate_stretcher_sources,
    _allocate_strip_sources,
    _rip_recovery_entry,
    _source_board_waste,
    _stamp_rip_meta,
    _stamp_stretcher_source,
    _wider_inventory_widths,
)
from cutting.stack.engine import _run_color, run_engine
from cutting.stack.primitives import (
    _cut_length,
    _cut_width,
    _inventory_stock_for_width,
    _is_standard_width,
    _is_stretcher_width,
    _normalize_part,
    _r1,
    _standard_board_type,
    _t0_board_type,
    _t0_stock,
)
from cutting.stack.recovery import (
    _choose_recovery_combo,
    _recovery_cost,
    _recovery_options_for_inventory,
    _t0_strip_consumed_width,
    _t0_strip_source_width,
)
from cutting.stack.strips import (
    _append_part_to_strip,
    _board_from_strip,
    _build_stack_first_strips,
    _build_stretcher_strips,
    _can_append_part,
    _new_lane_strip,
    _part_needs_no_trim,
    _parts_fit_or_rotate,
    _refresh_strip_pattern,
    _repack_t0_strips_by_width,
    _strip_capacity,
    _strip_effective_usable,
    _strip_used_length,
)
from cutting.stack.t0_packer import (
    _append_strip_to_t0_sheet,
    _build_color_inventory,
    _build_t0_sheet_pack,
    _bundle_into_stacks,
    _finalize_t0_sheets,
    _pack_t0_sheets,
    _place_stretcher_source_group_on_t0,
)

__all__ = [
    "_allocate_stretcher_from_inventory_width",
    "_allocate_stretcher_from_t0_residual",
    "_allocate_stretcher_from_t0_standard",
    "_allocate_stretcher_sources",
    "_allocate_strip_sources",
    "_append_part_to_strip",
    "_append_strip_to_t0_sheet",
    "_board_from_strip",
    "_build_color_inventory",
    "_build_stack_first_strips",
    "_build_stretcher_strips",
    "_build_t0_sheet_pack",
    "_bundle_into_stacks",
    "_can_append_part",
    "_choose_recovery_combo",
    "_cut_length",
    "_cut_width",
    "_finalize_t0_sheets",
    "_inventory_stock_for_width",
    "_is_standard_width",
    "_is_stretcher_width",
    "_new_lane_strip",
    "_normalize_part",
    "_pack_t0_sheets",
    "_part_needs_no_trim",
    "_parts_fit_or_rotate",
    "_place_stretcher_source_group_on_t0",
    "_r1",
    "_recovery_cost",
    "_recovery_options_for_inventory",
    "_refresh_strip_pattern",
    "_repack_t0_strips_by_width",
    "_rip_recovery_entry",
    "_run_color",
    "_source_board_waste",
    "_stamp_rip_meta",
    "_stamp_stretcher_source",
    "_standard_board_type",
    "_strip_capacity",
    "_strip_effective_usable",
    "_strip_used_length",
    "_t0_board_type",
    "_t0_stock",
    "_t0_strip_consumed_width",
    "_t0_strip_source_width",
    "_wider_inventory_widths",
    "run_engine",
]
