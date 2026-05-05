"""
Deploy Supabase schema — run once to create tables.
Usage: python3 scripts/setup_schema.py
"""

import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from config.supabase_client import supabase, SUPABASE_URL

# We'll use the REST API to execute SQL via the Supabase Management API
# But for simplicity, let's just create tables via the postgrest client
# by inserting seed data — the tables must be created via SQL first.

# Instead, we use httpx to call the SQL endpoint directly.
import httpx

SQL_SCHEMA = """
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
  cut_algorithm text NOT NULL DEFAULT 'stack_efficiency' CHECK (cut_algorithm IN ('efficient', 'stack_efficiency')),
  trim_loss_mm float DEFAULT 2,
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

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cut_algorithm text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trim_loss_mm float;
UPDATE orders SET cut_algorithm = 'efficient' WHERE cut_algorithm IS NULL;
UPDATE orders SET trim_loss_mm = 5 WHERE trim_loss_mm IS NULL AND cut_algorithm = 'efficient';
UPDATE orders SET trim_loss_mm = 2 WHERE trim_loss_mm IS NULL;
ALTER TABLE orders ALTER COLUMN cut_algorithm SET DEFAULT 'stack_efficiency';
ALTER TABLE orders ALTER COLUMN cut_algorithm SET NOT NULL;
ALTER TABLE orders ALTER COLUMN trim_loss_mm SET DEFAULT 2;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_cut_algorithm_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_cut_algorithm_check
      CHECK (cut_algorithm IN ('efficient', 'stack_efficiency'));
  END IF;
END $$;

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
"""

SEED_BOX_COLORS = [
    {"key": "WhiteBirch",    "name_en": "White Birch Plywood",    "name_zh": "白桦木胶合板",     "name_es": "Contrachapado de Abedul Blanco", "hex_color": "#F5DEB3", "sort_order": 1},
    {"key": "WhiteMelamine", "name_en": "White Melamine Plywood", "name_zh": "白色三聚氰胺板",   "name_es": "Melamina Blanca",                 "hex_color": "#FAFAFA", "sort_order": 2},
]

SEED_MATERIAL_OPTIONS = [
    {"key": "MDF",       "name_en": "MDF",        "name_zh": "中密度纤维板", "name_es": "MDF",           "sort_order": 1},
    {"key": "Plywood",   "name_en": "Plywood",    "name_zh": "胶合板",       "name_es": "Contrachapado", "sort_order": 2},
    {"key": "SolidWood", "name_en": "Solid Wood", "name_zh": "实木",         "name_es": "Madera Maciza", "sort_order": 3},
]

SEED_BOARD_SPECS = [
    {"board_type": "T0-1219.2x2438.4", "level": "T0", "name": "T0 Full Sheet", "width": 1219.2, "height": 2438.4, "thickness": 18, "is_raw": True, "is_recoverable": False, "sort_order": 0},
    {"board_type": "T1-303.8x2438.4", "level": "T1", "name": "T1 Recovered 303.8mm", "width": 303.8, "height": 2438.4, "thickness": 18, "is_raw": False, "is_recoverable": True, "sort_order": 10},
    {"board_type": "T1-608.6x2438.4", "level": "T1", "name": "T1 Recovered 608.6mm", "width": 608.6, "height": 2438.4, "thickness": 18, "is_raw": False, "is_recoverable": True, "sort_order": 20},
    {"board_type": "T1-285.8x2438.4", "level": "T1", "name": "T1 Recovered 285.8mm", "width": 285.8, "height": 2438.4, "thickness": 18, "is_raw": False, "is_recoverable": True, "sort_order": 40},
    {"board_type": "T1-264.8x2438.4", "level": "T1", "name": "T1 Recovered 264.8mm", "width": 264.8, "height": 2438.4, "thickness": 18, "is_raw": False, "is_recoverable": True, "sort_order": 50},
    {"board_type": "T1-590.6x2438.4", "level": "T1", "name": "T1 Recovered 590.6mm", "width": 590.6, "height": 2438.4, "thickness": 18, "is_raw": False, "is_recoverable": True, "sort_order": 60},
    {"board_type": "T1-569.6x2438.4", "level": "T1", "name": "T1 Recovered 569.6mm", "width": 569.6, "height": 2438.4, "thickness": 18, "is_raw": False, "is_recoverable": True, "sort_order": 70},
    {"board_type": "T1-762x2438.4", "level": "T1", "name": "T1 Recovered 762mm", "width": 762.0, "height": 2438.4, "thickness": 18, "is_raw": False, "is_recoverable": True, "sort_order": 80},
    {"board_type": "T1-838.2x2438.4", "level": "T1", "name": "T1 Recovered 838.2mm", "width": 838.2, "height": 2438.4, "thickness": 18, "is_raw": False, "is_recoverable": True, "sort_order": 90},
]

SEED_INVENTORY = [
    {
        "board_type": "T0-1219x2438",
        "color": "WhiteBirch",
        "name": "T0 Full Sheet",
        "material": "MDF",
        "category": "main",
        "height": 2438.4,
        "width": 1219.2,
        "thickness": 18,
        "stock": 50,
        "threshold": 10,
        "unit": "pcs",
    },
    {
        "board_type": "T1-303.8x2438",
        "color": "WhiteBirch",
        "name": "T1 Wall Stock (12\" - 1mm)",
        "material": "MDF",
        "category": "main",
        "height": 2438.4,
        "width": 303.8,
        "thickness": 18,
        "stock": 100,
        "threshold": 30,
        "unit": "pcs",
    },
    {
        "board_type": "T1-608.6x2438",
        "color": "WhiteBirch",
        "name": "T1 Base/Tall Stock (24\" - 1mm)",
        "material": "MDF",
        "category": "main",
        "height": 2438.4,
        "width": 608.6,
        "thickness": 18,
        "stock": 100,
        "threshold": 30,
        "unit": "pcs",
    },
    {
        "board_type": "S001-EdgeBand",
        "color": "WhiteBirch",
        "name": "Edge Banding 1mm White",
        "material": "PVC",
        "category": "sub",
        "height": 100000,
        "width": 22,
        "thickness": 1,
        "stock": 12,
        "threshold": 20,
        "unit": "rolls",
    },
    {
        "board_type": "A001-Hinge",
        "color": "WhiteBirch",
        "name": "Soft Close Hinge",
        "material": "Steel",
        "category": "aux",
        "height": 0,
        "width": 0,
        "thickness": 0,
        "stock": 1250,
        "threshold": 500,
        "unit": "pcs",
    },
]

COMMON_RECOVERY_WIDTHS = [303.8, 608.6, 285.8, 264.8, 590.6, 569.6, 762.0, 838.2]


def _width_code(width: float) -> str:
    text = f"{float(width):.1f}"
    return text[:-2] if text.endswith(".0") else text


for seed_color in ("WhiteBirch", "WhiteMelamine"):
    SEED_INVENTORY.append({
        "board_type": "T0-1219.2x2438.4",
        "color": seed_color,
        "name": "T0 Full Sheet",
        "material": "MDF",
        "category": "main",
        "height": 2438.4,
        "width": 1219.2,
        "thickness": 18,
        "stock": 0,
        "threshold": 10,
        "unit": "pcs",
    })
    for seed_width in COMMON_RECOVERY_WIDTHS:
        SEED_INVENTORY.append({
            "board_type": f"T1-{_width_code(seed_width)}x2438.4",
            "color": seed_color,
            "name": f"T1 Recovered {_width_code(seed_width)}mm",
            "material": "MDF",
            "category": "main",
            "height": 2438.4,
            "width": seed_width,
            "thickness": 18,
            "stock": 0,
            "threshold": 5,
            "unit": "pcs",
        })


def run():
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    
    # Execute SQL schema via Supabase's REST SQL endpoint
    print("📦 Deploying schema to Supabase...")
    
    resp = httpx.post(
        f"{SUPABASE_URL}/rest/v1/rpc/",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        },
        json={},
        timeout=30,
    )
    
    # The RPC endpoint won't work for raw SQL. Use the pg endpoint instead.
    # Let's use the supabase-py client's postgrest to check connectivity,
    # and run SQL via the SQL HTTP API.
    
    sql_url = f"{SUPABASE_URL}/rest/v1/"
    
    # Actually, Supabase doesn't expose raw SQL via REST for security.
    # We need to use the Management API or execute SQL through the dashboard.
    # Let's write the SQL to a file and give instructions.
    
    sql_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(sql_path, "w") as f:
        f.write(SQL_SCHEMA)
    print(f"✅ Schema SQL written to: {sql_path}")
    print()
    print("⚡ To deploy, either:")
    print("   1. Copy/paste the SQL into Supabase Dashboard → SQL Editor → Run")
    print(f"   2. Or use: supabase db push (if using Supabase CLI)")
    print()
    
    # Test connectivity
    print("🔗 Testing Supabase connection...")
    try:
        # Seed box_colors first (idempotent upsert)
        print("📝 Seeding box_colors registry...")
        try:
            supabase.table("box_colors").upsert(SEED_BOX_COLORS, on_conflict="key").execute()
            print(f"✅ Box colors registry ready ({len(SEED_BOX_COLORS)} default colors)")
        except Exception as bc_err:
            print(f"⚠️  Box colors upsert failed (table may not exist yet): {bc_err}")

        print("📝 Seeding material options...")
        try:
            supabase.table("material_options").upsert(SEED_MATERIAL_OPTIONS, on_conflict="key").execute()
            print(f"✅ Material options ready ({len(SEED_MATERIAL_OPTIONS)} default materials)")
        except Exception as mat_err:
            print(f"⚠️  Material options upsert failed (table may not exist yet): {mat_err}")

        print("📝 Seeding board specs...")
        try:
            supabase.table("board_specs").upsert(SEED_BOARD_SPECS, on_conflict="board_type").execute()
            print(f"✅ Board specs ready ({len(SEED_BOARD_SPECS)} default specs)")
        except Exception as spec_err:
            print(f"⚠️  Board specs upsert failed (table may not exist yet): {spec_err}")

        result = supabase.table("inventory").select("*").execute()
        print(f"✅ Connected! inventory table has {len(result.data)} rows")

        if len(result.data) == 0:
            print("📝 Seeding initial inventory data...")
            result = supabase.table("inventory").insert(SEED_INVENTORY).execute()
            print(f"✅ Seeded {len(result.data)} inventory items")
        else:
            print("ℹ️  Inventory already has data, skipping seed")

    except Exception as e:
        err_msg = str(e)
        if "relation" in err_msg and "does not exist" in err_msg:
            print(f"⚠️  Table doesn't exist yet. Please run the SQL schema first:")
            print(f"   Open: {SUPABASE_URL.replace('.co', '.co')}/project/default/sql")
            print(f"   Paste contents of: {sql_path}")
        else:
            print(f"❌ Error: {e}")

    # Create storage bucket for order files
    print("\n📦 Ensuring 'order-files' storage bucket exists...")
    try:
        supabase.storage.create_bucket(
            "order-files",
            options={"public": True, "allowed_mime_types": [
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-excel",
            ]},
        )
        print("✅ Created 'order-files' bucket")
    except Exception as e:
        if "already exists" in str(e).lower() or "Duplicate" in str(e):
            print("ℹ️  'order-files' bucket already exists")
        else:
            print(f"⚠️  Could not create bucket: {e}")
            print("   Please create it manually in Supabase Dashboard → Storage")


if __name__ == "__main__":
    run()
