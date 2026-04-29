-- Drop 101.6mm recovered strip from the recoverable spec list.
-- Inventory rows that reference this board_type are preserved; the optimizer
-- simply will not produce new 101.6mm strips during recovery.
-- 101.6mm cabinet stretcher PARTS are unaffected (cut from larger boards via
-- STRETCHER_DEPTH in cabinet_calculator.py).

UPDATE board_specs
SET is_recoverable = false
WHERE board_type = 'T1-101.6x2438.4';
