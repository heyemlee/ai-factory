"use client";
import React, { useMemo } from "react";
import { X } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import type { Board, SizeColor } from "./types";
import { formatWasteDimensions } from "./utils";

export function BoardDetailModal({ board, color, onClose }: {
  board: Board; color: SizeColor; onClose: () => void;
}) {
  const { t } = useLanguage();
  const boardDims = useMemo(() => {
    if (board.board_size) {
      const p = board.board_size.split("×").map((s) => parseFloat(s.trim()));
      if (p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])) {
        return { width: p[0], height: p[1] };
      }
    }
    const match = board.board.match(/(\d+(?:\.\d+)?)[x×*](\d+(?:\.\d+)?)/i);
    if (match) {
      return { width: parseFloat(match[1]), height: parseFloat(match[2]) };
    }
    return { width: 0, height: 0 };
  }, [board.board_size, board.board]);

  const MODAL_W = 400;
  const heightRatio = boardDims.width / boardDims.height;
  const stretchFactor = heightRatio < 0.3 ? 2.2 : heightRatio < 0.5 ? 1.6 : 1.3;
  const modalVisualH = Math.max(60, Math.round(MODAL_W * heightRatio * stretchFactor));

  const partLayout = useMemo(() => {
    if (!boardDims.height) return [];
    let x = board.trim_loss;
    return board.parts.map((p, idx) => {
      const pH = p.cut_length || p.Height;
      const pW = p.Width;
      const left = (x / boardDims.height) * 100;
      const width = (pH / boardDims.height) * 100;
      const height = Math.min((pW / boardDims.width) * 100, 100);
      x += pH + board.saw_kerf;
      return { ...p, top: 0, left, width, height, idx };
    });
  }, [board, boardDims]);

  const wasteLeft = useMemo(() => {
    if (!partLayout.length) return 100;
    const last = partLayout[partLayout.length - 1];
    return last.left + last.width + 0.2;
  }, [partLayout]);

  const utilPct = (board.utilization * 100).toFixed(1);
  const utilNum = parseFloat(utilPct);
  const utilColor = utilNum > 80 ? "#10b981" : utilNum > 60 ? "#f59e0b" : "#ef4444";

  const wasteDims = formatWasteDimensions(board);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />
      <div className="relative bg-white w-full max-w-3xl rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.15)] border border-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()} style={{ animation: "modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)" }}>
        <style>{`@keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>

        <div className="p-5 border-b border-border/40 flex items-center justify-between" style={{ backgroundColor: color.light }}>
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded" style={{ backgroundColor: color.bg, border: `2px solid ${color.border}` }} />
            <div>
              <h3 className="text-[18px] font-semibold">{board.board_id}</h3>
              <p className="text-[13px] text-apple-gray">{board.board} · {board.board_size}mm · {board.parts.length} {t("orderDetail.thParts")} · {board.cuts} {t("orderDetail.thCuts")}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[18px] font-bold" style={{ color: utilColor }}>{utilPct}%</span>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-black/5 transition-colors"><X size={18} className="text-apple-gray" /></button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-col">
          <div className="p-5 flex flex-col items-center justify-start lg:border-b border-border/30 bg-[#fafafa] shrink-0">
            <div className="flex items-center gap-1 mb-2">
              <div className="h-px bg-apple-gray/20" style={{ width: "16px" }} />
              <span className="text-[10px] text-apple-gray font-mono">{boardDims.height === 2438 ? 2438.4 : boardDims.height}mm</span>
              <div className="h-px bg-apple-gray/20" style={{ width: "16px" }} />
            </div>
            <div className="flex flex-row items-center gap-2">
              <div className="flex items-center justify-center">
                <div className="text-[10px] text-apple-gray font-mono -rotate-90 origin-center whitespace-nowrap">{boardDims.width === 1219 ? 1219.4 : boardDims.width}mm</div>
              </div>
              <div className="relative rounded-sm overflow-hidden" style={{
                width: `${MODAL_W}px`, height: `${modalVisualH}px`,
                backgroundColor: color.light, border: `2px solid ${color.border}`,
              }}>
                {partLayout.map((p) => {
                  const partPxW = (p.width / 100) * MODAL_W;
                  const partPxH = (p.height / 100) * modalVisualH;
                  const showText = partPxW > 35 && partPxH > 14;
                  const showDims = partPxW > 50 && partPxH > 26;
                  return (
                    <div key={`${p.part_id}-${p.idx}-group`} title={`Part: ${p.part_id} | Size: ${p.rotated ? `${p.Width}×${p.Height} 🔄` : `${p.Height}×${p.Width}`} | Cab: ${p.cab_id}`}>
                      <div className="absolute flex items-center justify-center overflow-hidden" style={{
                        left: `${p.left}%`, bottom: `0%`, width: `${p.width}%`, height: `${p.height}%`,
                        backgroundColor: color.bg,
                        borderRight: `1px solid ${color.border}`,
                        borderTop: p.height < 100 ? `1px solid ${color.border}` : undefined,
                      }}>
                        {showText && (
                          <div className="text-center leading-tight select-none px-0.5">
                            <span className="text-[10px] font-bold block truncate" style={{ color: color.text }}>{p.component || p.part_id}</span>
                            {showDims && <span className="text-[9px] font-medium block truncate" style={{ color: color.text }}>{p.Height}×{p.Width}</span>}
                          </div>
                        )}
                      </div>
                      {p.height < 100 && (
                        <div className="absolute flex items-center justify-center overflow-hidden" style={{
                          left: `${p.left}%`, bottom: `${p.height}%`, width: `${p.width}%`, height: `${100 - p.height}%`,
                          backgroundColor: "#ffffff",
                          backgroundImage: "repeating-linear-gradient(45deg, #ffffff, #ffffff 4px, #f8fafc 4px, #f8fafc 8px)",
                          borderRight: `1.5px dashed #94a3b8`,
                          borderTop: `1px solid ${color.border}20`,
                        }}>
                        </div>
                      )}
                    </div>
                  );
                })}
                {wasteLeft < 96 && (
                  <div className="absolute top-0 h-full flex items-center justify-center" style={{
                    left: `${wasteLeft}%`, width: `${Math.max(100 - wasteLeft, 0)}%`,
                    backgroundColor: "#ffffff",
                    backgroundImage: "repeating-linear-gradient(45deg, #ffffff, #ffffff 4px, #f8fafc 4px, #f8fafc 8px)",
                    borderLeft: `1.5px dashed #94a3b8`,
                  }}>
                    {(100 - wasteLeft) > 6 && <span className="text-[9px] font-bold text-slate-400">{t("orderDetail.modalWaste")} {wasteDims} mm</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="w-full mt-3" style={{ maxWidth: `${MODAL_W + 20}px` }}>
              <div className="w-full bg-black/[0.04] rounded-full h-2 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${utilPct}%`, backgroundColor: utilColor, transition: "width 0.5s" }} />
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-0 overflow-auto max-h-[500px]">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-white">
                <tr className="bg-black/[0.02]">
                  <th className="text-left py-2.5 px-4 font-semibold text-apple-gray">#</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-apple-gray">{t("orderDetail.modalPartId")}</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-apple-gray">{t("orderDetail.modalComponent")}</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-apple-gray">{t("orderDetail.modalCabinetId")}</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-apple-gray">Height</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-apple-gray">Width</th>
                </tr>
              </thead>
              <tbody>
                {board.parts.map((p, idx) => (
                  <tr key={`${p.part_id}-${idx}`} className="border-b border-border/15 hover:bg-black/[0.01]">
                    <td className="py-2 px-4 text-apple-gray">{idx + 1}</td>
                    <td className="py-2 px-4 font-mono font-medium text-[11px]">
                      {p.part_id}
                      {p.rotated && <span className="ml-1 text-[10px] inline-flex items-center text-amber-500 font-sans" title="Rotated 90°">🔄</span>}
                    </td>
                    <td className="py-2 px-4 text-apple-gray">{p.component || "—"}</td>
                    <td className="py-2 px-4 text-apple-gray">{p.cab_id || "—"}</td>
                    <td className="py-2 px-4 text-right font-mono">{p.rotated ? p.Width : p.Height}</td>
                    <td className="py-2 px-4 text-right font-mono">{p.rotated ? p.Height : p.Width}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border/40 bg-black/[0.01]">
                  <td colSpan={4} className="py-2.5 px-4 text-[11px] text-apple-gray font-medium">
                    {board.parts.length} {t("orderDetail.thParts")} · {board.cuts} {t("orderDetail.thCuts")} · {t("orderDetail.modalKerf")}{board.kerf_total}mm · {t("orderDetail.modalWaste")}{wasteDims} mm
                  </td>
                  <td colSpan={2} className="py-2.5 px-4 text-right text-[13px] font-bold" style={{ color: utilColor }}>
                    {t("orderDetail.thUtil")} {utilPct}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
