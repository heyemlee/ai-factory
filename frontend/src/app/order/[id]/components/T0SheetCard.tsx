"use client";
import React, { useMemo } from "react";
import { Plus } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import type { Board, SizeColor, PatternNumbering } from "./types";
import { T0_STRIP_COLORS } from "./constants";
import { BoardTile } from "./BoardTile";

export function T0SheetCard({ sheetId, strips, sizeColorMap, onBoardClick, recoveredStrips = [], patternNumbering }: {
  sheetId: string;
  strips: { board: Board; index: number }[];
  sizeColorMap: Record<string, SizeColor>;
  onBoardClick: (b: Board) => void;
  recoveredStrips?: { width: number; board_type: string; label?: string }[];
  patternNumbering: PatternNumbering;
}) {
  const { t } = useLanguage();
  const T0_FULL_WIDTH = 1219.2;
  const SAW_KERF = 5.0;

  // Compute sheet-level utilization from actual parts area (not strip width coverage)
  const T0_BOARD_HEIGHT = 2438.4;
  const sheetUtil = useMemo(() => {
    const totalPartsArea = strips.reduce((sum, { board }) => sum + (board.parts_total_area || 0), 0);
    const sheetArea = T0_FULL_WIDTH * T0_BOARD_HEIGHT;
    return sheetArea > 0 ? totalPartsArea / sheetArea : 0;
  }, [strips]);
  const allStripsInfo = strips[0]?.board.t0_all_strips ?? strips.map((s, i) => ({ strip_width: s.board.strip_width, strip_index: i }));

  // Build x positions for ALL strips on the sheet (from allStripsInfo)
  const stripPositions = useMemo(() => {
    let x = 0;
    return allStripsInfo.map((info) => {
      const pos = { x, width: info.strip_width, index: info.strip_index };
      x += info.strip_width + SAW_KERF;
      return pos;
    });
  }, [allStripsInfo]);

  // Total strips count
  const totalStrips = strips.length;

  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-slate-400" />
          <span className="text-[14px] font-bold text-foreground">{sheetId}</span>
          <span className="text-[11px] text-apple-gray font-medium">
            · {totalStrips} strips · 1 T0
          </span>
        </div>
        <span
          className="text-[13px] font-bold tabular-nums"
          style={{ color: sheetUtil > 0.8 ? "#10b981" : sheetUtil > 0.6 ? "#f59e0b" : "#ef4444" }}
        >
          {(sheetUtil * 100).toFixed(1)}%
        </span>
      </div>

      {/* Individual strip BoardTiles with progressive T0 shadow overlay */}
      <div className="flex flex-col gap-y-5 pt-2">
        {strips.map(({ board, index: idx }, stripIdx) => {
          const stripColor = T0_STRIP_COLORS[stripIdx % T0_STRIP_COLORS.length];

          // Calculate cumulative utilization for this strip
          let cumArea = 0;
          for (let i = 0; i <= stripIdx; i++) {
            cumArea += strips[i].board.parts_total_area || 0;
          }
          const cumUtilNum = (T0_FULL_WIDTH * T0_BOARD_HEIGHT) > 0 ? cumArea / (T0_FULL_WIDTH * T0_BOARD_HEIGHT) : 0;

          const pNo = patternNumbering.byIndex[idx];
          return (
            <div key={`${board.board_id}-${idx}`} className="space-y-1.5">
              {/* Strip label */}
              <div className="flex items-center gap-2 px-2">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: stripColor.bg, border: `1.5px solid ${stripColor.border}` }} />
                <span className="text-[10px] font-semibold" style={{ color: stripColor.text }}>
                  Strip {stripIdx + 1} · {board.strip_width}mm
                </span>

              </div>

              {/* The actual BoardTile — no stackInfo since each strip is unique on this T0 sheet */}
              <BoardTile
                board={board}
                index={idx}
                color={{ ...sizeColorMap[board.board_size], bg: stripColor.bg, border: stripColor.border, text: stripColor.text }}
                onClick={() => onBoardClick(board)}
                overrideUtilNum={cumUtilNum}
              />
            </div>
          );
        })}

        {/* Recovered Strips Visual Representation */}
        {recoveredStrips.map((rs, rIdx) => (
          <div key={`recovered-${rIdx}`} className="space-y-1.5">
            <div className="flex items-center gap-2 px-2">
              <div className="w-2.5 h-2.5 rounded-sm bg-apple-green/50 border-[1.5px] border-apple-green" />
              <span className="text-[10px] font-semibold text-apple-green">
                {t("orderDetail.modalThRecovered" as any)} · {rs.width}mm
              </span>
            </div>
            
            <div className="relative rounded-xl border-2 border-dashed border-apple-green/40 bg-apple-green/5 overflow-hidden flex items-center justify-center py-6 h-[80px]">
              <div className="text-center">
                <span className="block text-[13px] font-bold text-apple-green">{rs.board_type}</span>
                <span className="block text-[11px] text-apple-green/70 mt-0.5">{rs.width} × 2438.4 mm</span>
                <span className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-apple-green/20 text-apple-green text-[10px] font-bold uppercase tracking-wider">
                  <Plus size={10} /> STOCK
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
