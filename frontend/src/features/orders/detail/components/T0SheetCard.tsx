"use client";
import React, { useMemo } from "react";
import { useLanguage } from "@/lib/i18n";
import type { Board, SizeColor, PatternNumbering, RipStackInfo } from "./types";
import { T0_STRIP_COLORS } from "./constants";
import { clamp, getRipWidth, safeNum } from "./utils";

export function T0SheetCard({ strips, onBoardClick, recoveredStrips = [], patternNumbering, stackLookup, ripStackLookup, t0SheetStack = 1 }: {
  sheetId: string;
  strips: { board: Board; index: number }[];
  sizeColorMap: Record<string, SizeColor>;
  onBoardClick: (b: Board) => void;
  recoveredStrips?: { width: number; board_type: string; label?: string }[];
  patternNumbering: PatternNumbering;
  stackLookup?: Record<number, { groupSize: number; stackOf: number; isLeader: boolean }>;
  ripStackLookup?: Record<number, RipStackInfo>;
  compactHeader?: boolean;
  /** Number of physical T0 raw sheets stacked together (叠切). */
  t0SheetStack?: number;
}) {
  const { t } = useLanguage();
  const T0_FULL_WIDTH = 1219.2;
  const T0_BOARD_HEIGHT = 2438.4;
  const sheetWastePattern = "repeating-linear-gradient(45deg, #f8fafc, #f8fafc 5px, #cbd5e1 5px, #cbd5e1 6.5px)";
  const displayStrips = useMemo(
    () => strips.filter(({ board }) => !board.t0_source_strip_secondary),
    [strips]
  );

  const placedEdge = useMemo(() => {
    return displayStrips.reduce((max, { board }) => {
      const x = safeNum(board.t0_strip_position);
      const w = safeNum(board.t0_source_strip_width) || safeNum(board.strip_width);
      return Math.max(max, x + w);
    }, 0);
  }, [displayStrips]);

  const recoveredLayout = useMemo(() => {
    return recoveredStrips.reduce<Array<{ width: number; board_type: string; label?: string; left: number }>>((acc, rs) => {
      const previous = acc[acc.length - 1];
      const left = previous ? previous.left + safeNum(previous.width) + 5 : placedEdge;
      acc.push({ ...rs, left });
      return acc;
    }, []);
  }, [placedEdge, recoveredStrips]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">


      <div className="flex justify-center pt-1">
        <div className="w-full max-w-[340px]">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="h-px bg-slate-200 flex-1" />
            <span className="text-[10px] text-slate-500 font-mono">1219.2 mm</span>
            {t0SheetStack > 1 && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-50 text-red-600 border border-red-200">
                ×{t0SheetStack} T0 Stacked
              </span>
            )}
            <div className="h-px bg-slate-200 flex-1" />
          </div>

          <div className="flex items-center gap-2">
            <div
              className="relative w-full aspect-[1219.2/2438.4] min-h-[360px] max-h-[520px] rounded-sm border-2 border-slate-300 overflow-visible bg-slate-50"
              style={{ backgroundImage: sheetWastePattern }}
            >
              <div className="absolute left-[-26px] top-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </div>
              {displayStrips.map(({ board, index: idx }, stripIdx) => {
                const stripColor = T0_STRIP_COLORS[stripIdx % T0_STRIP_COLORS.length];
                const stripX = safeNum(board.t0_strip_position);
                const stripW = safeNum(board.t0_source_strip_width) || safeNum(board.strip_width);
                const ripW = stripW || getRipWidth(board);
                const stripLeftPct = clamp((stripX / T0_FULL_WIDTH) * 100, 0, 100);
                const stripWidthPct = clamp((ripW / T0_FULL_WIDTH) * 100, 0, 100);
                let y = safeNum(board.trim_loss);

                return (
                  <button
                    type="button"
                    key={`${board.board_id}-${idx}`}
                    data-pattern-no={patternNumbering.byIndex[idx] ?? undefined}
                    onClick={() => onBoardClick(board)}
                    className="absolute top-0 h-full text-left overflow-hidden focus:outline-none focus:ring-2 focus:ring-apple-blue/40"
                    title={`${board.board_id} · ${ripW}mm`}
                    style={{
                      left: `${stripLeftPct}%`,
                      width: `${stripWidthPct}%`,
                      backgroundColor: stripColor.bg,
                      borderLeft: `1px solid ${stripColor.border}`,
                      borderRight: `1px solid ${stripColor.border}`,
                    }}
                  >
                    <div className="absolute inset-x-0 top-0 h-full opacity-20" style={{ backgroundColor: stripColor.bg }} />
                    {board.parts.map((part, partIdx) => {
                      const partLen = safeNum(part.cut_length) || safeNum(part.Height);
                      const partWidth = safeNum(part.cut_width) || safeNum(part.Width);
                      const topPct = clamp((y / T0_BOARD_HEIGHT) * 100, 0, 100);
                      const heightPct = clamp((partLen / T0_BOARD_HEIGHT) * 100, 0, 100);
                      const partWidthPct = ripW > 0 ? clamp((partWidth / ripW) * 100, 0, 100) : 100;
                      y += partLen + safeNum(board.saw_kerf);
                      const showLabel = stripWidthPct > 8 && heightPct > 4;
                      return (
                        <React.Fragment key={`${part.part_id}-${partIdx}`}>
                          <div
                            className="absolute left-0 overflow-hidden flex items-center justify-center"
                            style={{
                              top: `${topPct}%`,
                              height: `${heightPct}%`,
                              width: `${partWidthPct}%`,
                              backgroundColor: stripColor.bg,
                              borderTop: `1px solid ${stripColor.border}`,
                              borderRight: `1px solid ${stripColor.border}`,
                            }}
                          >
                            {showLabel && (
                              <span 
                                className="text-[9px] font-bold truncate px-1" 
                                style={{ 
                                  color: stripColor.text,
                                  writingMode: stripWidthPct < 12 ? "vertical-rl" : "horizontal-tb"
                                }}
                              >
                                {part.component || part.part_id}
                              </span>
                            )}
                          </div>
                          {partWidthPct < 99 && (
                            <div
                              className="absolute right-0"
                              style={{
                                top: `${topPct}%`,
                                height: `${heightPct}%`,
                                width: `${100 - partWidthPct}%`,
                                backgroundImage: sheetWastePattern,
                                borderTop: `1px solid ${stripColor.border}55`,
                              }}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                    {y < T0_BOARD_HEIGHT && (
                      <div
                        className="absolute left-0 right-0 bottom-0"
                        style={{
                          top: `${clamp((y / T0_BOARD_HEIGHT) * 100, 0, 100)}%`,
                          backgroundImage: sheetWastePattern,
                          borderTop: `1.5px dashed ${stripColor.border}`,
                        }}
                      />
                    )}
                    <div className="absolute left-1 top-1 rounded bg-white/80 px-1 py-0.5 text-[9px] font-bold shadow-sm" style={{ color: stripColor.text }}>
                      {patternNumbering.byIndex[idx] ? `P${patternNumbering.byIndex[idx]}` : `${ripW}mm`}
                    </div>
                    {((ripStackLookup?.[idx]?.stackOf || stackLookup?.[idx]?.stackOf || 1) > 1) && (
                      <div 
                        className="absolute shadow-sm border border-red-200 bg-red-50 text-red-600 font-bold flex items-center justify-center whitespace-nowrap z-20"
                        style={
                          stripWidthPct < 12
                            ? {
                                top: "4px",
                                left: "50%",
                                transform: "translateX(-50%)",
                                writingMode: "vertical-rl",
                                padding: "4px 2px",
                                borderRadius: "4px",
                                fontSize: "8px",
                              }
                            : {
                                top: "4px",
                                right: "4px",
                                padding: "2px 6px",
                                borderRadius: "9999px",
                                fontSize: "8px",
                              }
                        }
                      >
                        ×{ripStackLookup?.[idx]?.stackOf || stackLookup?.[idx]?.stackOf} Stack
                      </div>
                    )}
                  </button>
                );
              })}

              {recoveredLayout.map((rs, rIdx) => {
                const leftPct = clamp((rs.left / T0_FULL_WIDTH) * 100, 0, 100);
                const widthPct = clamp((safeNum(rs.width) / T0_FULL_WIDTH) * 100, 0, 100);
                return (
                  <div
                    key={`recovered-${rIdx}`}
                    className="absolute top-0 h-full bg-[#a1f2c6] border-x border-emerald-500 flex items-center justify-center"
                    title={`${rs.board_type} · ${rs.width}mm`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  >
                    <div className="-rotate-90 whitespace-nowrap text-[10px] font-bold text-emerald-700">
                      {rs.width}mm recovered
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] text-slate-500 font-mono whitespace-nowrap -rotate-90 w-6">2438.4 mm</div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
            {displayStrips.map(({ board, index: idx }, stripIdx) => {
          const stripColor = T0_STRIP_COLORS[stripIdx % T0_STRIP_COLORS.length];
          const legendW = safeNum(board.t0_source_strip_width) || getRipWidth(board) || safeNum(board.strip_width);
          return (
                <span key={`${board.board_id}-legend-${idx}`} className="inline-flex items-center gap-1 rounded bg-black/[0.03] px-1.5 py-0.5">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: stripColor.bg, border: `1px solid ${stripColor.border}` }} />
                  P{patternNumbering.byIndex[idx] ?? stripIdx + 1} · {legendW}mm
                </span>
          );
        })}
            {recoveredStrips.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-apple-green/10 px-1.5 py-0.5 text-apple-green">
                <span className="h-2 w-2 rounded-sm bg-apple-green/50 border border-apple-green" />
                {t("orderDetail.modalThRecovered")} · {recoveredStrips.map((r) => `${r.width}mm`).join(", ")}
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded bg-black/[0.03] px-1.5 py-0.5 text-slate-500">
              <span className="h-2 w-3 rounded-sm border border-slate-300" style={{ backgroundImage: sheetWastePattern }} />
              Waste
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
