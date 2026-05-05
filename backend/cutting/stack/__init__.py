"""
Stack-efficiency cutting engine.

Optimizes for repeatable stack cuts before raw material utilization.
See engine.py for full pipeline description.
"""

from .engine import run_engine

__all__ = ["run_engine"]
