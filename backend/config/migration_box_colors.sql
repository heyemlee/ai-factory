-- ════════════════════════════════════════════════
-- AI Factory — Box Color Migration
-- Run this in Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════

-- 1. Create box_colors registry table
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

DROP TRIGGER IF EXISTS trg_box_colors_updated ON box_colors;
CREATE TRIGGER trg_box_colors_updated
  BEFORE UPDATE ON box_colors
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE box_colors ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_box_colors') THEN
    CREATE POLICY allow_all_box_colors ON box_colors FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 2. Seed default colors (idempotent)
INSERT INTO box_colors (key, name_en, name_zh, name_es, hex_color, sort_order)
VALUES
  ('WhiteBirch',    'White Birch Plywood',    '白桦木胶合板',     'Contrachapado de Abedul Blanco', '#F5DEB3', 1),
  ('WhiteMelamine', 'White Melamine Plywood', '白色三聚氰胺板',   'Melamina Blanca',                 '#FAFAFA', 2)
ON CONFLICT (key) DO NOTHING;

-- 3. Add color column to inventory (default to WhiteBirch for existing rows)
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS color text;
UPDATE inventory SET color = 'WhiteBirch' WHERE color IS NULL;
ALTER TABLE inventory ALTER COLUMN color SET NOT NULL;
ALTER TABLE inventory ALTER COLUMN color SET DEFAULT 'WhiteBirch';

-- 4. Replace board_type unique constraint with composite (board_type, color)
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'inventory'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%(board_type)%'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE inventory DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'inventory'::regclass
      AND conname = 'inventory_board_type_color_uk'
  ) THEN
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_board_type_color_uk UNIQUE (board_type, color);
  END IF;
END $$;

-- 5. FK from inventory.color → box_colors.key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'inventory'::regclass
      AND conname = 'inventory_color_fk'
  ) THEN
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_color_fk
      FOREIGN KEY (color) REFERENCES box_colors(key) ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. Configurable material options
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

DROP TRIGGER IF EXISTS trg_material_options_updated ON material_options;
CREATE TRIGGER trg_material_options_updated
  BEFORE UPDATE ON material_options
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE material_options ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_material_options') THEN
    CREATE POLICY allow_all_material_options ON material_options FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO material_options (key, name_en, name_zh, name_es, sort_order)
VALUES
  ('MDF',       'MDF',        '中密度纤维板', 'MDF',             1),
  ('Plywood',   'Plywood',    '胶合板',       'Contrachapado',   2),
  ('SolidWood', 'Solid Wood', '实木',         'Madera Maciza',   3)
ON CONFLICT (key) DO NOTHING;
