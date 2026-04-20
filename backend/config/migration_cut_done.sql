-- ════════════════════════════════════════════════
-- Migration: Add cut_done workflow to orders
-- Run this in Supabase SQL Editor
-- ════════════════════════════════════════════════

-- 1. Drop old constraint and add new one with 'cut_done'
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('pending', 'processing', 'completed', 'cut_done', 'failed'));

-- 2. Add new columns for cut confirmation
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cut_confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS extra_boards_used jsonb DEFAULT '[]';
