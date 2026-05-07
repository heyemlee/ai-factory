"use client";

import React from "react";
import type { RecoveryCuttingBoard } from "./types";
import { T0_STRIP_COLORS } from "./constants";
import { clamp, safeNum } from "./utils";

function fmt(n: number | undefined): string {
  const v = safeNum(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function RecoveryCuttingBoardCard({ board }: { board: RecoveryCuttingBoard }) {
  const width = safeNum(board.width);
  const length = safeNum(board.length, 2438.4);
  const stackSize = board.stack_size || 1;
  const isUsed = board.status === "used";
  const wastePattern = "repeating-linear-gradient(45deg, #f8fafc, #f8fafc 5px, #cbd5e1 5px, #cbd5e1 6.5px)";
  const wasteWidth = safeNum(board.inline_waste_width);
  const laneUsedWidth = board.lanes.reduce((max, lane) => Math.max(max, safeNum(lane.x_position) + safeNum(lane.width)), 0);
  const wasteLeftPct = width > 0 ? clamp((laneUsedWidth / width) * 100, 0, 100) : 100;
  const wasteWidthPct = width > 0 ? clamp((wasteWidth / width) * 100, 0, 100) : 0;
  const visualHeight = 520;
  const visualWidth = Math.max(26, Math.round((width / length) * visualHeight));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
      <div className="flex justify-center pt-1">
        <div className="w-full max-w-[340px]">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="h-px bg-slate-200 flex-1" />
            <span className="text-[10px] text-slate-500 font-mono">{fmt(width)} mm</span>
            {stackSize > 1 && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-50 text-red-600 border border-red-200">
                ×{stackSize} Stacked
              </span>
            )}
            <div className="h-px bg-slate-200 flex-1" />
          </div>

          <div className="flex items-center justify-center gap-2">
            <div
              className="relative rounded-sm border-2 border-slate-300 overflow-visible bg-[#a1f2c6]"
              style={{ width: `${visualWidth}px`, height: `${visualHeight}px` }}
            >
              <div className="absolute left-[-26px] top-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </div>

              {board.lanes.map((lane, laneIdx) => {
                const stripColor = T0_STRIP_COLORS[(laneIdx + 4) % T0_STRIP_COLORS.length];
                const leftPct = width > 0 ? clamp((safeNum(lane.x_position) / width) * 100, 0, 100) : 0;
                const laneWidthPct = width > 0 ? clamp((safeNum(lane.width) / width) * 100, 0, 100) : 0;
                let y = 0;
                return (
                  <div
                    key={lane.lane_index}
                    className="absolute top-0 h-full text-left overflow-hidden"
                    style={{
                      left: `${leftPct}%`,
                      width: `${laneWidthPct}%`,
                      backgroundColor: stripColor.bg,
                      borderLeft: `1px solid ${stripColor.border}`,
                      borderRight: `1px solid ${stripColor.border}`,
                    }}
                    title={`Stretcher lane ${fmt(lane.width)}mm`}
                  >
                    <div className="absolute inset-x-0 top-0 h-full opacity-20" style={{ backgroundColor: stripColor.bg }} />
                    {lane.parts.map((part, partIdx) => {
                      const partLen = safeNum(part.cut_length) || safeNum(part.Height);
                      const topPct = length > 0 ? clamp((y / length) * 100, 0, 100) : 0;
                      const heightPct = length > 0 ? clamp((partLen / length) * 100, 0, 100) : 0;
                      y += partLen + 5;
                      const showLabel = laneWidthPct > 70 && heightPct > 4;
                      return (
                        <div
                          key={`${part.part_id}-${partIdx}`}
                          className="absolute left-0 w-full overflow-hidden flex items-center justify-center"
                          style={{
                            top: `${topPct}%`,
                            height: `${heightPct}%`,
                            backgroundColor: stripColor.bg,
                            borderTop: `1px solid ${stripColor.border}`,
                          }}
                          title={`${part.part_id} ${fmt(partLen)}×${fmt(part.cut_width || part.Width)}`}
                        >
                          {showLabel && (
                            <span
                              className="text-[9px] font-bold truncate px-1"
                              style={{ color: stripColor.text, writingMode: laneWidthPct < 12 ? "vertical-rl" : "horizontal-tb" }}
                            >
                              {part.component || part.part_id}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {y < length && (
                      <div
                        className="absolute left-0 right-0 bottom-0"
                        style={{
                          top: `${clamp((y / length) * 100, 0, 100)}%`,
                          backgroundImage: wastePattern,
                          borderTop: `1.5px dashed ${stripColor.border}`,
                        }}
                      />
                    )}
                    {laneWidthPct > 70 && (
                      <div className="absolute left-1 top-1 rounded bg-white/80 px-1 py-0.5 text-[9px] font-bold shadow-sm" style={{ color: stripColor.text }}>
                        {fmt(lane.width)}mm
                      </div>
                    )}
                  </div>
                );
              })}

              {isUsed && wasteWidth > 0.5 && (
                <div
                  className="absolute top-0 h-full bg-slate-50"
                  style={{
                    left: `${wasteLeftPct}%`,
                    width: `${wasteWidthPct}%`,
                    backgroundImage: wastePattern,
                    borderLeft: "1.5px dashed #94a3b8",
                  }}
                  title={`Waste ${fmt(wasteWidth)}×${fmt(length)}`}
                >
                  <div className="-rotate-90 whitespace-nowrap pt-2 text-[9px] font-bold text-slate-500">
                    Waste {fmt(wasteWidth)}mm
                  </div>
                </div>
              )}

              {!isUsed && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="-rotate-90 whitespace-nowrap text-[10px] font-bold text-emerald-700">
                    {fmt(width)}mm recovered
                  </div>
                </div>
              )}
            </div>
            <div className="text-[10px] text-slate-500 font-mono whitespace-nowrap -rotate-90 w-6">{fmt(length)} mm</div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
            {board.lanes.map((lane, laneIdx) => {
              const stripColor = T0_STRIP_COLORS[(laneIdx + 4) % T0_STRIP_COLORS.length];
              return (
                <span key={`lane-${lane.lane_index}`} className="inline-flex items-center gap-1 rounded bg-black/[0.03] px-1.5 py-0.5">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: stripColor.bg, border: `1px solid ${stripColor.border}` }} />
                  Stretcher · {fmt(lane.width)}mm · {lane.parts.length}
                </span>
              );
            })}
            {!isUsed && (
              <span className="inline-flex items-center gap-1 rounded bg-apple-green/10 px-1.5 py-0.5 text-apple-green">
                <span className="h-2 w-2 rounded-sm bg-apple-green/50 border border-apple-green" />
                Recovered · {fmt(width)}mm
              </span>
            )}
            {isUsed && wasteWidth > 0.5 && (
              <span className="inline-flex items-center gap-1 rounded bg-black/[0.03] px-1.5 py-0.5 text-slate-500">
                <span className="h-2 w-3 rounded-sm border border-slate-300" style={{ backgroundImage: wastePattern }} />
                Waste · {fmt(wasteWidth)}mm
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
