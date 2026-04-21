"""
Deploy Supabase schema — run once to create tables.
Usage: python3 backend/config/setup_schema.py
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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

-- 1. Inventory table (replaces data/t1_inventory.xlsx)
CREATE TABLE IF NOT EXISTS inventory (
  id serial PRIMARY KEY,
  board_type text UNIQUE NOT NULL,
  name text NOT NULL,
  material text DEFAULT 'MDF',
  category text DEFAULT 'main' CHECK (category IN ('main', 'sub', 'aux')),
  height float NOT NULL,
  width float NOT NULL,
  thickness float DEFAULT 18,
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
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  cabinets_summary text,
  utilization float,
  boards_used int,
  total_parts int,
  cut_result_json jsonb,
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
END $$;
"""

SEED_INVENTORY = [
    {
        "board_type": "T0-1219x2438",
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
        "board_type": "T1-305x2438",
        "name": "T1 Wall Stock (12\")",
        "material": "MDF",
        "category": "main",
        "height": 2438.4,
        "width": 304.8,
        "thickness": 18,
        "stock": 100,
        "threshold": 30,
        "unit": "pcs",
    },
    {
        "board_type": "T1-610x2438",
        "name": "T1 Base/Tall Stock (24\")",
        "material": "MDF",
        "category": "main",
        "height": 2438.4,
        "width": 609.6,
        "thickness": 18,
        "stock": 100,
        "threshold": 30,
        "unit": "pcs",
    },
    {
        "board_type": "S001-EdgeBand",
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
