import { supabase } from "@/lib/supabase";
import { DEFAULT_BOX_COLOR } from "@/lib/box_colors";

export type InventoryAction =
  | "consume_stock"
  | "recover_stock"
  | "revert_consume"
  | "revert_recover"
  | "manual_adjust";

export interface BoardUsageRow {
  key: string;
  board_type: string;
  color: string;
  planned: number;
}

export interface InventoryMoveContext {
  order_id?: string;
  job_id?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

interface T0SheetLike {
  sheet_id?: string;
  color?: string;
  strips?: Array<{ board_type?: string; strip_label?: string }>;
  /** Number of physical T0 raw sheets stacked together (叠切). */
  t0_sheet_stack?: number;
}

interface BoardLike {
  board?: string;
  board_type?: string;
  color?: string;
  source?: string;
  t0_sheet_id?: string;
  source_stock_group_id?: string;
  source_stock_board_type?: string;
}

interface RecoveredLike {
  board_type: string;
  color?: string;
  width?: number;
}

interface CutResultLike {
  t0_plan?: { t0_sheets?: T0SheetLike[] };
  boards?: BoardLike[];
  recovered_inventory?: RecoveredLike[];
}

function usageKey(boardType: string, color: string) {
  return `${boardType}|${color}`;
}

function addUsage(map: Record<string, BoardUsageRow>, boardType?: string, color?: string, count = 1) {
  if (!boardType || count <= 0) return;
  const safeColor = color || DEFAULT_BOX_COLOR;
  const key = usageKey(boardType, safeColor);
  if (!map[key]) {
    map[key] = { key, board_type: boardType, color: safeColor, planned: 0 };
  }
  map[key].planned += count;
}

export function calculatePlannedBoardUsage(cutResult: CutResultLike | null | undefined): BoardUsageRow[] {
  const usage: Record<string, BoardUsageRow> = {};
  const t0Sheets = cutResult?.t0_plan?.t0_sheets || [];
  const plannedT0SheetIds = new Set<string>();

  for (const sheet of t0Sheets) {
    if (sheet?.sheet_id) plannedT0SheetIds.add(sheet.sheet_id);
    const firstStrip = Array.isArray(sheet?.strips) ? sheet.strips[0] : null;
    const boardType = firstStrip?.board_type || firstStrip?.strip_label || "T0-RAW";
    const color = sheet?.color || DEFAULT_BOX_COLOR;
    // Stacked T0 sheets consume multiple physical raw sheets
    addUsage(usage, boardType, color, sheet?.t0_sheet_stack || 1);
  }

  for (const board of cutResult?.boards || []) {
    const boardType = board?.board || board?.board_type;
    const color = board?.color || DEFAULT_BOX_COLOR;
    const sourceBoardType = board?.source_stock_board_type;
    const sourceGroupId = board?.source_stock_group_id;
    const sourceIsT0 = String(sourceBoardType || "").toUpperCase().startsWith("T0");
    if (sourceGroupId && sourceBoardType && !sourceIsT0) {
      const groupKey = `${sourceGroupId}|${sourceBoardType}|${color}`;
      if (!plannedT0SheetIds.has(groupKey)) {
        plannedT0SheetIds.add(groupKey);
        addUsage(usage, sourceBoardType, color, 1);
      }
      continue;
    }
    const isT0 = board?.source === "T0" || String(boardType || "").toUpperCase().startsWith("T0");
    if (isT0 && t0Sheets.length > 0) {
      if (!board?.t0_sheet_id || plannedT0SheetIds.has(board.t0_sheet_id)) continue;
    }
    addUsage(usage, boardType, color, 1);
  }

  return Object.values(usage);
}

export function summarizeRecoveredInventory(cutResult: CutResultLike | null | undefined): Array<{ key: string; board_type: string; color: string; count: number; width?: number }> {
  const counts: Record<string, { key: string; board_type: string; color: string; count: number; width?: number }> = {};
  for (const r of cutResult?.recovered_inventory || []) {
    const color = r.color || DEFAULT_BOX_COLOR;
    const key = usageKey(r.board_type, color);
    if (!counts[key]) counts[key] = { key, board_type: r.board_type, color, count: 0, width: r.width };
    counts[key].count += 1;
  }
  return Object.values(counts);
}

function parseWidthFromBoardType(boardType: string) {
  const match = boardType.match(/T[01]-(\d+(?:\.\d+)?)x/i);
  return match ? Number(match[1]) : 0;
}

async function loadBoardSpec(boardType: string) {
  const { data } = await supabase
    .from("board_specs")
    .select("board_type,name,width,height,thickness")
    .eq("board_type", boardType)
    .maybeSingle();
  return data;
}

async function createInventoryRow(boardType: string, color: string, stock: number, width?: number) {
  const spec = await loadBoardSpec(boardType);
  const safeWidth = Number(spec?.width || width || parseWidthFromBoardType(boardType) || (boardType.toUpperCase().startsWith("T0") ? 1219.2 : 0));
  const isT0 = boardType.toUpperCase().startsWith("T0");
  const { error } = await supabase.from("inventory").insert({
    board_type: boardType,
    color,
    name: spec?.name || (isT0 ? "T0 Full Sheet" : `T1 Recovered ${safeWidth || ""}mm`.trim()),
    material: "MDF",
    category: "main",
    height: Number(spec?.height || 2438.4),
    width: safeWidth,
    thickness: Number(spec?.thickness || 18),
    stock,
    threshold: isT0 ? 10 : 5,
    unit: "pcs",
  });
  if (error) throw error;
}

export async function adjustInventoryStock(
  boardType: string,
  color: string,
  delta: number,
  options: { width?: number; createIfMissing?: boolean } = {}
) {
  const safeColor = color || DEFAULT_BOX_COLOR;
  const { data } = await supabase
    .from("inventory")
    .select("stock")
    .eq("board_type", boardType)
    .eq("color", safeColor)
    .maybeSingle();

  if (data) {
    const nextStock = Math.max(0, Number(data.stock || 0) + delta);
    const { error } = await supabase
      .from("inventory")
      .update({ stock: nextStock })
      .eq("board_type", boardType)
      .eq("color", safeColor);
    if (error) throw error;
    return { before: Number(data.stock || 0), after: nextStock };
  }

  if (options.createIfMissing || delta > 0) {
    await createInventoryRow(boardType, safeColor, Math.max(0, delta), options.width);
    return { before: 0, after: Math.max(0, delta) };
  }

  await createInventoryRow(boardType, safeColor, 0, options.width);
  return { before: 0, after: 0 };
}

export async function logInventoryTransaction(
  action: InventoryAction,
  boardType: string,
  color: string,
  quantityDelta: number,
  ctx: InventoryMoveContext = {}
) {
  const { error } = await supabase.from("inventory_transactions").insert({
    order_id: ctx.order_id,
    job_id: ctx.job_id,
    board_type: boardType,
    color: color || DEFAULT_BOX_COLOR,
    quantity_delta: quantityDelta,
    action,
    notes: ctx.notes,
    metadata: ctx.metadata || {},
  });
  if (error) {
    console.warn("inventory transaction log skipped:", error.message);
  }
}
