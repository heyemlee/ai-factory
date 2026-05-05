"""
Guillotine cutting engine — efficient (FFD + T0 mixed-pack) strategy.

Public API:
  - run_engine(...)      main pipeline entry point
  - load_parts(path)     parts loader (re-exported for stack engine reuse)
  - load_inventory(...)  inventory loader (re-exported)
  - DEFAULT_BOX_COLOR    default color constant
  - _validate_cut_result integrity validator (re-exported for stack engine)
"""

from .constants import DEFAULT_BOX_COLOR
from .engine import run_engine
from .loaders import load_inventory, load_parts
from .validator import _validate_cut_result

__all__ = [
    "run_engine",
    "load_parts",
    "load_inventory",
    "DEFAULT_BOX_COLOR",
    "_validate_cut_result",
]
