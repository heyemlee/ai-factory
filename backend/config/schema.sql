
-- ════════════════════════════════════════════════
-- AI Factory — Supabase Schema
-- ════════════════════════════════════════════════

-- 0. Box Colors registry (drives non-hard-coded color options)
CREATE TABLE IF NOT EXISTS box_colors (
  key text PRIMARY KEY,
  name_en text NOT NULL,
  name_zh text NOT NULL,
  name_es text NOT NULL,
  hex_color text NOT NULL DEFAULT '#FFFFFF',
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_options (
  key text PRIMARY KEY,
  name_en text NOT NULL,
  name_zh text NOT NULL,
  name_es text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

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

-- 1. Inventory table (replaces data/t1_inventory.xlsx)
CREATE TABLE IF NOT EXISTS inventory (
  id serial PRIMARY KEY,
  board_type text NOT NULL,
  color text NOT NULL DEFAULT 'WhiteBirch' REFERENCES box_colors(key) ON UPDATE CASCADE,
  name text NOT NULL,
  material text DEFAULT 'MDF',
  category text DEFAULT 'main' CHECK (category IN ('main', 'sub', 'aux')),
  height float NOT NULL,
  width float NOT NULL,
  thickness float DEFAULT 18,
  stock int NOT NULL DEFAULT 0,
  threshold int NOT NULL DEFAULT 10,
  unit text DEFAULT 'pcs',
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT inventory_board_type_color_uk UNIQUE (board_type, color)
);

-- 2. Orders table (task queue)
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text UNIQUE NOT NULL,
  filename text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cut_done', 'failed')),
  cut_mode text NOT NULL DEFAULT 'inventory_first' CHECK (cut_mode IN ('inventory_first', 't0_start')),
  cabinets_summary text,
  utilization float,
  boards_used int,
  total_parts int,
  cut_result_json jsonb,
  cut_confirmed_at timestamptz,
  t0_start_requested_at timestamptz,
  extra_boards_used jsonb DEFAULT '[]',
  file_url text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- 3. BOM History table
CREATE TABLE IF NOT EXISTS bom_history (
  id serial PRIMARY KEY,
  job_id text REFERENCES orders(job_id),
  boards_used int,
  total_parts int,
  overall_utilization float,
  total_waste_mm float,
  total_cost float DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 4. Inventory transaction history
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

-- Auto-update updated_at on inventory changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_updated ON inventory;
CREATE TRIGGER trg_inventory_updated
  BEFORE UPDATE ON inventory
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_box_colors_updated ON box_colors;
CREATE TRIGGER trg_box_colors_updated
  BEFORE UPDATE ON box_colors
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_material_options_updated ON material_options;
CREATE TRIGGER trg_material_options_updated
  BEFORE UPDATE ON material_options
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_board_specs_updated ON board_specs;
CREATE TRIGGER trg_board_specs_updated
  BEFORE UPDATE ON board_specs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Enable RLS but allow all for now (will tighten later with auth)
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE box_colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_specs ENABLE ROW LEVEL SECURITY;

-- Permissive policies (open for development)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_inventory') THEN
    CREATE POLICY allow_all_inventory ON inventory FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_orders') THEN
    CREATE POLICY allow_all_orders ON orders FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_bom') THEN
    CREATE POLICY allow_all_bom ON bom_history FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_inventory_transactions') THEN
    CREATE POLICY allow_all_inventory_transactions ON inventory_transactions FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_box_colors') THEN
    CREATE POLICY allow_all_box_colors ON box_colors FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_material_options') THEN
    CREATE POLICY allow_all_material_options ON material_options FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_board_specs') THEN
    CREATE POLICY allow_all_board_specs ON board_specs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
