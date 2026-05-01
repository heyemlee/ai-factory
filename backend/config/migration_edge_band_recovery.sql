-- Migration: Update recovery board widths to account for -1mm edge banding
-- Back panel widths (762.0, 838.2) are NOT changed — they have no banding.
--
BEGIN;

-- ─── 1. Update board_specs table ───
UPDATE board_specs SET board_type = 'T1-303.8x2438.4', name = 'T1 Recovered 303.8mm', width = 303.8
  WHERE board_type = 'T1-304.8x2438.4';

UPDATE board_specs SET board_type = 'T1-608.6x2438.4', name = 'T1 Recovered 608.6mm', width = 608.6
  WHERE board_type = 'T1-609.6x2438.4';

UPDATE board_specs SET board_type = 'T1-285.8x2438.4', name = 'T1 Recovered 285.8mm', width = 285.8
  WHERE board_type = 'T1-286.8x2438.4';

UPDATE board_specs SET board_type = 'T1-264.8x2438.4', name = 'T1 Recovered 264.8mm', width = 264.8
  WHERE board_type = 'T1-266.8x2438.4';

UPDATE board_specs SET board_type = 'T1-590.6x2438.4', name = 'T1 Recovered 590.6mm', width = 590.6
  WHERE board_type = 'T1-591.6x2438.4';

UPDATE board_specs SET board_type = 'T1-569.6x2438.4', name = 'T1 Recovered 569.6mm', width = 569.6
  WHERE board_type = 'T1-571.6x2438.4';

-- ─── 2. Update inventory table ───
UPDATE inventory SET board_type = 'T1-303.8x2438.4', name = 'T1 Recovered 303.8mm', width = 303.8
  WHERE board_type = 'T1-304.8x2438.4';

UPDATE inventory SET board_type = 'T1-608.6x2438.4', name = 'T1 Recovered 608.6mm', width = 608.6
  WHERE board_type = 'T1-609.6x2438.4';

UPDATE inventory SET board_type = 'T1-285.8x2438.4', name = 'T1 Recovered 285.8mm', width = 285.8
  WHERE board_type = 'T1-286.8x2438.4';

UPDATE inventory SET board_type = 'T1-264.8x2438.4', name = 'T1 Recovered 264.8mm', width = 264.8
  WHERE board_type = 'T1-266.8x2438.4';

UPDATE inventory SET board_type = 'T1-590.6x2438.4', name = 'T1 Recovered 590.6mm', width = 590.6
  WHERE board_type = 'T1-591.6x2438.4';

UPDATE inventory SET board_type = 'T1-569.6x2438.4', name = 'T1 Recovered 569.6mm', width = 569.6
  WHERE board_type = 'T1-571.6x2438.4';

-- Also update the main stock entries
UPDATE inventory SET board_type = 'T1-303.8x2438', name = 'T1 Wall Stock (12" - 1mm)', width = 303.8
  WHERE board_type = 'T1-305x2438';

UPDATE inventory SET board_type = 'T1-608.6x2438', name = 'T1 Base/Tall Stock (24" - 1mm)', width = 608.6
  WHERE board_type = 'T1-610x2438';

-- ─── 3. Update any existing inventory_transactions referencing old board_types ───
UPDATE inventory_transactions SET board_type = 'T1-303.8x2438.4' WHERE board_type = 'T1-304.8x2438.4';
UPDATE inventory_transactions SET board_type = 'T1-608.6x2438.4' WHERE board_type = 'T1-609.6x2438.4';
UPDATE inventory_transactions SET board_type = 'T1-285.8x2438.4' WHERE board_type = 'T1-286.8x2438.4';
UPDATE inventory_transactions SET board_type = 'T1-264.8x2438.4' WHERE board_type = 'T1-266.8x2438.4';
UPDATE inventory_transactions SET board_type = 'T1-590.6x2438.4' WHERE board_type = 'T1-591.6x2438.4';
UPDATE inventory_transactions SET board_type = 'T1-569.6x2438.4' WHERE board_type = 'T1-571.6x2438.4';

-- Also update main stock board_type references in transactions
UPDATE inventory_transactions SET board_type = 'T1-303.8x2438' WHERE board_type = 'T1-305x2438';
UPDATE inventory_transactions SET board_type = 'T1-608.6x2438' WHERE board_type = 'T1-610x2438';

COMMIT;
