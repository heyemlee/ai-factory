import { supabase } from "@/lib/supabase";
import { DEFAULT_BOX_COLOR } from "@/lib/box_colors";
import {
  adjustInventoryStock,
  calculatePlannedBoardUsage,
  logInventoryTransaction,
  summarizeRecoveredInventory,
} from "@/lib/inventory_movements";

interface RevertOrder {
  id: string;
  job_id: string;
  status: string;
  cut_result_json: Parameters<typeof calculatePlannedBoardUsage>[0];
  extra_boards_used?: Array<{ board_type: string; color?: string; count: number }>;
}

export async function revertCut(order: RevertOrder) {
  if (order.status !== "cut_done") return;

  const cutResult = order.cut_result_json;
  if (!cutResult) return;

  // 1. Calculate how many boards/sheets to restore.
  const boardUsage: Record<string, { board_type: string; color: string; count: number }> = {};
  for (const usage of calculatePlannedBoardUsage(cutResult)) {
    boardUsage[usage.key] = {
      board_type: usage.board_type,
      color: usage.color || DEFAULT_BOX_COLOR,
      count: usage.planned,
    };
  }

  // Add extra boards used.
  const extras = order.extra_boards_used || [];
  for (const ex of extras) {
    const color = ex.color || DEFAULT_BOX_COLOR;
    const key = `${ex.board_type}|${color}`;
    if (!boardUsage[key]) boardUsage[key] = { board_type: ex.board_type, color, count: 0 };
    boardUsage[key].count += ex.count;
  }

  const recoveredRows = summarizeRecoveredInventory(cutResult);
  const usageColors = Array.from(new Set([
    ...Object.values(boardUsage).map((row) => row.color || DEFAULT_BOX_COLOR),
    ...recoveredRows.map((row) => row.color || DEFAULT_BOX_COLOR),
  ]));
  const stockManagedColors = new Set<string>();
  if (usageColors.length > 0) {
    const { data: colorRows } = await supabase
      .from("inventory")
      .select("color")
      .eq("category", "main")
      .in("color", usageColors);
    for (const row of colorRows || []) {
      stockManagedColors.add(row.color as string);
    }
  }

  // 2. Restore consumed inventory
  for (const row of Object.values(boardUsage)) {
    if (!stockManagedColors.has(row.color || DEFAULT_BOX_COLOR)) continue;
    if (row.count <= 0) continue;
    await adjustInventoryStock(row.board_type, row.color, row.count, { createIfMissing: true });
    await logInventoryTransaction("revert_consume", row.board_type, row.color, row.count, {
      order_id: order.id,
      job_id: order.job_id,
      notes: "Reverted cut confirmation",
    });
  }

  // 3. Decrement inventory for previously-added recovered scrap (symmetric to ConfirmCutModal)
  // Filter out non-recoverable board types (e.g. T1-101.6x2438.4) that were never
  // added to inventory in the first place (matching ConfirmCutModal's filter).
  const { data: nonRecRows } = await supabase
    .from("board_specs")
    .select("board_type")
    .eq("is_active", true)
    .eq("is_recoverable", false);
  const nonRecoverableBTs = new Set((nonRecRows || []).map((r) => r.board_type as string));

  for (const row of recoveredRows) {
    if (!stockManagedColors.has(row.color || DEFAULT_BOX_COLOR)) continue;
    if (nonRecoverableBTs.has(row.board_type)) continue;
    await adjustInventoryStock(row.board_type, row.color, -row.count, { width: row.width, createIfMissing: true });
    await logInventoryTransaction("revert_recover", row.board_type, row.color, -row.count, {
      order_id: order.id,
      job_id: order.job_id,
      notes: "Removed recovered stock after revert",
      metadata: { width: row.width },
    });
  }

  // 4. Delete from cutting_stats
  await supabase.from("cutting_stats").delete().eq("job_id", order.job_id);

  // 5. Revert order status
  await supabase
    .from("orders")
    .update({
      status: "completed",
      cut_confirmed_at: null,
      extra_boards_used: null
    })
    .eq("id", order.id);
}
