import { supabase } from "@/lib/supabase";

export async function revertCut(order: any) {
  if (order.status !== "cut_done") return;

  const cutResult = order.cut_result_json;
  if (!cutResult) return;

  // 1. Calculate how many boards to restore
  const boardUsage: Record<string, number> = {};
  for (const b of cutResult.boards || []) {
    boardUsage[b.board] = (boardUsage[b.board] || 0) + 1;
  }

  // Add extra boards used
  const extras = order.extra_boards_used || [];
  for (const ex of extras) {
    boardUsage[ex.board_type] = (boardUsage[ex.board_type] || 0) + ex.count;
  }

  // 2. Restore inventory
  for (const [board_type, totalUsed] of Object.entries(boardUsage)) {
    if (totalUsed <= 0) continue;
    const { data: invData } = await supabase
      .from("inventory")
      .select("stock")
      .eq("board_type", board_type)
      .single();

    if (invData) {
      await supabase
        .from("inventory")
        .update({ stock: invData.stock + totalUsed })
        .eq("board_type", board_type);
    }
  }

  // 3. Delete from cutting_stats
  await supabase.from("cutting_stats").delete().eq("job_id", order.job_id);

  // 4. Revert order status
  await supabase
    .from("orders")
    .update({
      status: "completed",
      cut_confirmed_at: null,
      extra_boards_used: null
    })
    .eq("id", order.id);
}
