"""
T0 unified mixed-strip optimization.

T0 raw sheet: 1219.2 × 2438.4 mm (48″ × 96″)
裁切方向：沿 1219.2mm (48″) 宽度方向切条料

⚠️ 命名规则:
  - T0 板统一叫 T0-RAW (不允许 CUSTOM-xxx-T0)
  - 回收的条料使用库存命名:
    - T1-608.6-INV  (回收的宽条料, 24″-1mm封边)
    - T1-303.8-INV  (回收的窄条料, 12″-1mm封边)
    - STRIP-RECOVERED (拉条回收)
"""

from .packer import optimize_t0_from_strips
from .recovery import recover_leftover, _best_recovery_combo, _legacy_recover
from .planner import compute_t0_plan, optimize_t0_cutting

__all__ = [
    "optimize_t0_from_strips",
    "recover_leftover",
    "compute_t0_plan",
    "optimize_t0_cutting",
    "_best_recovery_combo",
    "_legacy_recover",
]
