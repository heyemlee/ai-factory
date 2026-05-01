-- ════════════════════════════════════════════════
-- Migration: T0 Start production mode + inventory transactions
-- Run this in Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════

-- 1. Orders: support cut_done and production mode.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'cut_done', 'failed'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cut_mode text NOT NULL DEFAULT 'inventory_first';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_cut_mode_check;
ALTER TABLE orders ADD CONSTRAINT orders_cut_mode_check
  CHECK (cut_mode IN ('inventory_first', 't0_start'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cut_confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS t0_start_requested_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS extra_boards_used jsonb DEFAULT '[]';

-- 2. Inventory transaction history.
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id bigserial PRIMARY KEY,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  job_id text,
  board_type text NOT NULL,
  color text NOT NULL DEFAULT 'WhiteBirch' REFERENCES box_colors(key) ON UPDATE CASCADE,
  quantity_delta int NOT NULL,
  action text NOT NULL CHECK (
    action IN (
      'consume_stock',
      'recover_stock',
      'revert_consume',
      'revert_recover',
      'manual_adjust'
    )
  ),
  notes text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_inventory_transactions') THEN
    CREATE POLICY allow_all_inventory_transactions ON inventory_transactions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 3. Board specification catalog. Inventory stores quantity; this table stores reusable factory sizes.
CREATE TABLE IF NOT EXISTS board_specs (
  id bigserial PRIMARY KEY,
  board_type text UNIQUE NOT NULL,
  level text NOT NULL CHECK (level IN ('T0', 'T1')),
  name text NOT NULL,
  width float NOT NULL,
  height float NOT NULL,
  thickness float NOT NULL DEFAULT 18,
  is_raw boolean NOT NULL DEFAULT false,
  is_recoverable boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_board_specs_updated ON board_specs;
CREATE TRIGGER trg_board_specs_updated
  BEFORE UPDATE ON board_specs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE board_specs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_board_specs') THEN
    CREATE POLICY allow_all_board_specs ON board_specs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO board_specs (board_type, level, name, width, height, thickness, is_raw, is_recoverable, sort_order)
VALUES
  ('T0-1219.2x2438.4', 'T0', 'T0 Full Sheet', 1219.2, 2438.4, 18, true, false, 0),
  ('T1-303.8x2438.4', 'T1', 'T1 Recovered 303.8mm', 303.8, 2438.4, 18, false, true, 10),
  ('T1-608.6x2438.4', 'T1', 'T1 Recovered 608.6mm', 608.6, 2438.4, 18, false, true, 20),
  ('T1-101.6x2438.4', 'T1', 'T1 Recovered 101.6mm', 101.6, 2438.4, 18, false, true, 30),
  ('T1-285.8x2438.4', 'T1', 'T1 Recovered 285.8mm', 285.8, 2438.4, 18, false, true, 40),
  ('T1-264.8x2438.4', 'T1', 'T1 Recovered 264.8mm', 264.8, 2438.4, 18, false, true, 50),
  ('T1-590.6x2438.4', 'T1', 'T1 Recovered 590.6mm', 590.6, 2438.4, 18, false, true, 60),
  ('T1-569.6x2438.4', 'T1', 'T1 Recovered 569.6mm', 569.6, 2438.4, 18, false, true, 70),
  ('T1-762x2438.4', 'T1', 'T1 Recovered 762mm', 762, 2438.4, 18, false, true, 80),
  ('T1-838.2x2438.4', 'T1', 'T1 Recovered 838.2mm', 838.2, 2438.4, 18, false, true, 90)
ON CONFLICT (board_type) DO UPDATE SET
  name = EXCLUDED.name,
  width = EXCLUDED.width,
  height = EXCLUDED.height,
  thickness = EXCLUDED.thickness,
  is_raw = EXCLUDED.is_raw,
  is_recoverable = EXCLUDED.is_recoverable,
  is_active = true,
  sort_order = EXCLUDED.sort_order;

-- 4. Seed T0 and common recoverable T1 sizes for the two production material colors.
WITH production_colors AS (
  SELECT key AS color FROM box_colors WHERE key IN ('WhiteBirch', 'WhiteMelamine')
),
sizes AS (
  SELECT board_type, width, height, name
  FROM board_specs
  WHERE is_active = true
)
INSERT INTO inventory (
  board_type,
  color,
  name,
  material,
  category,
  height,
  width,
  thickness,
  stock,
  threshold,
  unit
)
SELECT
  sizes.board_type,
  production_colors.color,
  sizes.name,
  'MDF',
  'main',
  sizes.height,
  sizes.width,
  18,
  0,
  CASE WHEN sizes.board_type LIKE 'T0-%' THEN 10 ELSE 5 END,
  'pcs'
FROM production_colors
CROSS JOIN sizes
ON CONFLICT (board_type, color) DO NOTHING;
