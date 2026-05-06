import { supabase } from "@/lib/supabase";
import { DEFAULT_BOX_COLOR } from "@/lib/box_colors";
import {
  adjustInventoryStock,
  calculatePlannedBoardUsage,
  logInventoryTransaction,
  summarizeRecoveredInventory,
} from "@/lib/inventory_movements";

export type CutMode = "inventory_first" | "t0_start";
export type CutAlgorithm = "efficient" | "stack_efficiency";

export interface UploadSettings {
  cutAlgorithm: CutAlgorithm;
  cutMode: CutMode;
  trimLossMm: number;
}

export const DEFAULT_UPLOAD_SETTINGS: UploadSettings = {
  cutAlgorithm: "stack_efficiency",
  cutMode: "inventory_first",
  trimLossMm: 2,
};

export interface SubmitOrderInput {
  blob: Blob;
  filename: string;
  settings: UploadSettings;
}

export interface SubmitOrderResult {
  jobId: string;
  fileUrl: string;
}

export async function submitOrder({ blob, filename, settings }: SubmitOrderInput): Promise<SubmitOrderResult> {
  const now = new Date();
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  const jobId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}_${randomSuffix}`;
  const uniqueSuffix = Date.now();

  const ext = filename.replace(/^.*\./, ".") || ".xlsx";
  const safeName = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 60) || "order";
  const storagePath = `orders/${jobId}_${uniqueSuffix}_${safeName}${ext}`;

  const { error: storageError } = await supabase.storage
    .from("order-files")
    .upload(storagePath, blob, { upsert: true });

  if (storageError) {
    const friendly = storageError.message.includes("Bucket not found")
      ? `文件上传失败: Supabase Storage 中 "order-files" bucket 不存在。请在 Supabase Dashboard → Storage 中创建名为 "order-files" 的 bucket。`
      : `文件上传失败: ${storageError.message}`;
    throw new Error(friendly);
  }

  const fileUrl = supabase.storage.from("order-files").getPublicUrl(storagePath).data.publicUrl;

  const settingsPayload = {
    cut_algorithm: settings.cutAlgorithm,
    trim_loss_mm: settings.trimLossMm,
  };
  const orderPayload = {
    job_id: jobId,
    filename,
    status: "pending",
    file_url: fileUrl,
    cut_mode: settings.cutMode,
  };

  const { error: insertError } = await supabase
    .from("orders")
    .insert({ ...orderPayload, ...settingsPayload });

  if (insertError) {
    const missingSettingsColumn = insertError.message.includes("cut_algorithm")
      || insertError.message.includes("trim_loss_mm");
    if (!missingSettingsColumn) {
      throw new Error(`订单创建失败: ${insertError.message}`);
    }
    const { error: fallbackError } = await supabase
      .from("orders")
      .insert({
        ...orderPayload,
        cut_result_json: {
          upload_settings: { ...settingsPayload, cut_mode: settings.cutMode },
        },
      });
    if (fallbackError) {
      throw new Error(`订单创建失败: ${fallbackError.message}`);
    }
  }

  return { jobId, fileUrl };
}

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
    if (row.width !== 101.6 && nonRecoverableBTs.has(row.board_type)) continue;
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
