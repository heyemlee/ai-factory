"use client";
import React, { useState, useMemo } from "react";
import { CheckCircle2, Plus, Minus, Loader2 } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import type { Board, Order } from "./types";

export function ConfirmCutModal({ order, boards, onConfirmed, onClose }: {
  order: Order;
  boards: Board[];
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  /* Compute board usage by board_type */
  const boardUsage = useMemo(() => {
    const usage: Record<string, number> = {};
    for (const b of boards) {
      const bt = b.board;
      usage[bt] = (usage[bt] || 0) + 1;
    }
    return Object.entries(usage).map(([board_type, count]) => ({
      board_type,
      planned: count,
    }));
  }, [boards]);

  const [extras, setExtras] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    boardUsage.forEach((u) => { init[u.board_type] = 0; });
    return init;
  });
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adjustExtra = (bt: string, delta: number) => {
    setExtras((prev) => ({
      ...prev,
      [bt]: Math.max(0, (prev[bt] || 0) + delta),
    }));
  };

  const recoveredCounts = useMemo(() => {
    const recovered = order.cut_result_json?.recovered_inventory ?? [];
    const counts: Record<string, number> = {};
    for (const r of recovered) {
      counts[r.board_type] = (counts[r.board_type] || 0) + 1;
    }
    return Object.entries(counts).map(([board_type, count]) => ({
      board_type,
      count,
    }));
  }, [order.cut_result_json]);

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);

    try {
      // 1. Deduct inventory for each board_type (planned + extra)
      for (const u of boardUsage) {
        const totalUsed = u.planned + (extras[u.board_type] || 0);
        if (totalUsed <= 0) continue;

        // Get current stock
        const { data: invData } = await supabase
          .from("inventory")
          .select("stock")
          .eq("board_type", u.board_type)
          .single();

        if (invData) {
          const newStock = Math.max(0, invData.stock - totalUsed);
          await supabase
            .from("inventory")
            .update({ stock: newStock })
            .eq("board_type", u.board_type);
        }
      }

      // 2. Increment inventory for recovered scrap pieces (T0 leftover → T1 stock)
      const recovered = order.cut_result_json?.recovered_inventory ?? [];
      if (recovered.length > 0) {
        const recoveredCounts: Record<string, number> = {};
        for (const r of recovered) {
          recoveredCounts[r.board_type] = (recoveredCounts[r.board_type] || 0) + 1;
        }
        for (const [bt, count] of Object.entries(recoveredCounts)) {
          const { data: invData } = await supabase
            .from("inventory")
            .select("stock")
            .eq("board_type", bt)
            .single();
          if (invData) {
            await supabase
              .from("inventory")
              .update({ stock: invData.stock + count })
              .eq("board_type", bt);
          } else {
            console.warn(`Recovered board_type "${bt}" not found in inventory; skipping increment.`);
          }
        }
      }

      // 3. Insert cutting_stats
      const cutResult = order.cut_result_json;
      if (cutResult) {
        const statsRows: Array<{
          job_id: string;
          board_type: string;
          t2_height: number;
          t2_width: number;
          component: string;
          cab_id: string;
          quantity: number;
        }> = [];
        for (const board of cutResult.boards) {
          for (const part of board.parts) {
            statsRows.push({
              job_id: order.job_id,
              board_type: board.board,
              t2_height: part.Height,
              t2_width: part.Width,
              component: part.component || "",
              cab_id: part.cab_id || "",
              quantity: 1,
            });
          }
        }
        if (statsRows.length > 0) {
          await supabase.from("cutting_stats").insert(statsRows);
        }
      }

      // 4. Build extra_boards_used array
      const extraBoardsUsed = Object.entries(extras)
        .filter(([, count]) => count > 0)
        .map(([board_type, count]) => ({ board_type, count }));

      // 5. Update order status → cut_done
      await supabase
        .from("orders")
        .update({
          status: "cut_done",
          cut_confirmed_at: new Date().toISOString(),
          extra_boards_used: extraBoardsUsed,
        })
        .eq("id", order.id);

      onConfirmed();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("orderDetail.modalConfirmFailed"));
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />
      <div
        className="relative bg-white w-full max-w-lg rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.15)] border border-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <style>{`@keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>

        {/* Header */}
        <div className="p-6 border-b border-border/40">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-apple-blue/10 text-apple-blue flex items-center justify-center">
              <CheckCircle2 size={22} />
            </div>
            <h3 className="text-[20px] font-semibold tracking-tight">{t("orderDetail.modalConfirmTitle")}</h3>
          </div>
          <p className="text-[13px] text-apple-gray leading-relaxed">
            {t("orderDetail.modalConfirmDesc")}
          </p>
        </div>

        {/* Board usage table */}
        <div className="p-6">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border/40">
                <th className="text-left py-2 font-semibold text-apple-gray">{t("orderDetail.modalThBoardType")}</th>
                <th className="text-center py-2 font-semibold text-apple-gray">{t("orderDetail.modalThPlanned")}</th>
                <th className="text-center py-2 font-semibold text-apple-gray">{t("orderDetail.modalThExtra")}</th>
                <th className="text-center py-2 font-semibold text-apple-gray">{t("orderDetail.modalThTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {boardUsage.map((u) => {
                const extra = extras[u.board_type] || 0;
                return (
                  <tr key={u.board_type} className="border-b border-border/20">
                    <td className="py-3 font-medium">{u.board_type}</td>
                    <td className="py-3 text-center text-apple-gray">{u.planned}</td>
                    <td className="py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => adjustExtra(u.board_type, -1)}
                          disabled={extra <= 0}
                          className="w-6 h-6 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-apple-gray disabled:opacity-30 transition-colors"
                        >
                          <Minus size={12} />
                        </button>
                        <span className={`w-6 text-center font-bold ${extra > 0 ? "text-amber-600" : "text-apple-gray"}`}>
                          {extra}
                        </span>
                        <button
                          onClick={() => adjustExtra(u.board_type, 1)}
                          className="w-6 h-6 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-apple-gray transition-colors"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>
                    <td className="py-3 text-center font-bold text-foreground">{u.planned + extra}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Recovered Inventory section */}
        {recoveredCounts.length > 0 && (
          <div className="px-6 pb-6">
            <div className="rounded-xl border border-apple-green/20 bg-apple-green/5 overflow-hidden">
              <div className="p-3 border-b border-apple-green/10 flex items-center gap-2">
                <Plus size={16} className="text-apple-green" />
                <h4 className="text-[14px] font-semibold text-apple-green">
                  {t("orderDetail.modalRecoveredTitle" as any)}
                </h4>
              </div>
              <div className="p-1">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-apple-green/10">
                      <th className="text-left py-2 px-3 font-semibold text-apple-green/80">{t("orderDetail.modalThBoardType" as any)}</th>
                      <th className="text-center py-2 px-3 font-semibold text-apple-green/80">{t("orderDetail.modalThRecovered" as any)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recoveredCounts.map((r) => (
                      <tr key={r.board_type} className="border-b border-apple-green/5 last:border-0">
                        <td className="py-2.5 px-3 font-medium text-apple-green/90">{r.board_type}</td>
                        <td className="py-2.5 px-3 text-center font-bold text-apple-green">+{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-6 mb-4 p-3 rounded-xl bg-red-50 text-red-600 text-[13px] font-medium">{error}</div>
        )}

        {/* Actions */}
        <div className="p-6 border-t border-border/40 flex gap-3">
          <button
            onClick={onClose}
            disabled={confirming}
            className="flex-1 px-4 py-3 rounded-xl bg-black/5 text-foreground text-[15px] font-semibold hover:bg-black/10 transition-colors disabled:opacity-50"
          >
            {t("orderDetail.modalCancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="flex-1 px-4 py-3 rounded-xl bg-apple-blue text-white text-[15px] font-semibold hover:bg-apple-blue/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {confirming ? (
              <><Loader2 size={16} className="animate-spin" /> {t("orderDetail.processing")}</>
            ) : (
              <><CheckCircle2 size={16} /> {t("orderDetail.modalConfirmBtn")}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
