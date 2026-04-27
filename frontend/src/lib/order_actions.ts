import { supabase } from "@/lib/supabase";
import { DEFAULT_BOX_COLOR } from "@/lib/box_colors";

export async function revertCut(order: any) {
  if (order.status !== "cut_done") return;

  const cutResult = order.cut_result_json;
  if (!cutResult) return;

  // 1. Calculate how many boards to restore
  const boardUsage: Record<string, { board_type: string; color: string; count: number }> = {};
  for (const b of cutResult.boards || []) {
    const color = b.color || DEFAULT_BOX_COLOR;
    const key = `${b.board}|${color}`;
    if (!boardUsage[key]) boardUsage[key] = { board_type: b.board, color, count: 0 };
    boardUsage[key].count += 1;
  }

  // Add extra boards used
  const extras = order.extra_boards_used || [];
  for (const ex of extras) {
    const color = ex.color || DEFAULT_BOX_COLOR;
    const key = `${ex.board_type}|${color}`;
    if (!boardUsage[key]) boardUsage[key] = { board_type: ex.board_type, color, count: 0 };
    boardUsage[key].count += ex.count;
  }

  // 2. Restore inventory
  for (const row of Object.values(boardUsage)) {
    if (row.count <= 0) continue;
    const { data: invData } = await supabase
      .from("inventory")
      .select("stock")
      .eq("board_type", row.board_type)
      .eq("color", row.color)
      .single();

    if (invData) {
      await supabase
        .from("inventory")
        .update({ stock: invData.stock + row.count })
        .eq("board_type", row.board_type)
        .eq("color", row.color);
    }
  }

  // 3. Decrement inventory for previously-added recovered scrap (symmetric to ConfirmCutModal)
  const recovered = cutResult.recovered_inventory || [];
  if (recovered.length > 0) {
    const recoveredCounts: Record<string, { board_type: string; color: string; count: number }> = {};
    for (const r of recovered) {
      const color = r.color || DEFAULT_BOX_COLOR;
      const key = `${r.board_type}|${color}`;
      if (!recoveredCounts[key]) recoveredCounts[key] = { board_type: r.board_type, color, count: 0 };
      recoveredCounts[key].count += 1;
    }
    for (const row of Object.values(recoveredCounts)) {
      const { data: invData } = await supabase
        .from("inventory")
        .select("stock")
        .eq("board_type", row.board_type)
        .eq("color", row.color)
        .single();
      if (invData) {
        await supabase
          .from("inventory")
          .update({ stock: Math.max(0, invData.stock - row.count) })
          .eq("board_type", row.board_type)
          .eq("color", row.color);
      }
    }
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
