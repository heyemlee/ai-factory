
-- ════════════════════════════════════════════════
-- AI Factory — Supabase Schema
-- ════════════════════════════════════════════════

-- 1. Inventory table (replaces data/t1_inventory.xlsx)
CREATE TABLE IF NOT EXISTS inventory (
  id serial PRIMARY KEY,
  board_type text UNIQUE NOT NULL,
  name text NOT NULL,
  material text DEFAULT 'MDF',
  category text DEFAULT 'main' CHECK (category IN ('main', 'sub', 'aux')),
  height float NOT NULL DEFAULT 2438.4,   -- length / board height (mm)
  width float NOT NULL DEFAULT 0,          -- board width (mm)
  thickness float DEFAULT 18,              -- material thickness (mm)
  stock int NOT NULL DEFAULT 0,
  threshold int NOT NULL DEFAULT 10,
  unit text DEFAULT 'pcs',
  updated_at timestamptz DEFAULT now()
);

-- 2. Orders table (task queue)
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text UNIQUE NOT NULL,
  filename text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'cut_done', 'failed')),
  cabinets_summary text,
  utilization float,
  boards_used int,
  total_parts int,
  cut_result_json jsonb,
  file_url text,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  cut_confirmed_at timestamptz,
  extra_boards_used jsonb DEFAULT '[]'
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

-- 4. Cutting Stats table (tracks cut frequency per dimension)
CREATE TABLE IF NOT EXISTS cutting_stats (
  id serial PRIMARY KEY,
  job_id text,
  board_type text NOT NULL,
  t2_height float NOT NULL,
  t2_width float NOT NULL,
  component text,
  cab_id text,
  quantity int DEFAULT 1,
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

-- Enable RLS but allow all for now (will tighten later with auth)
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE cutting_stats ENABLE ROW LEVEL SECURITY;

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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_cutting_stats') THEN
    CREATE POLICY allow_all_cutting_stats ON cutting_stats FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
