"use client";
import React, { useState, useMemo } from "react";
import { useLanguage } from "@/lib/i18n";
import type { Board, SizeColor } from "./types";
import { SIZE_COLORS } from "./constants";
import { parseBoardDims, safeNum, clamp } from "./utils";

export function BoardTile({ board, index, color, stackInfo, onClick, disableHover = false, overrideUtilNum, hideWidthWaste = false, isRotated = false, hideUtilization = false, showDimensions = false, hideStackBadge = false, hidePreviousStripShade = false }: {
  board: Board;
  index: number;
  color: SizeColor;
  stackInfo?: { groupSize: number; stackOf: number; isLeader: boolean };
  onClick: () => void;
  disableHover?: boolean;
  overrideUtilNum?: number;
  hideWidthWaste?: boolean;
  isRotated?: boolean;
  hideUtilization?: boolean;
  showDimensions?: boolean;
  hideStackBadge?: boolean;
  hidePreviousStripShade?: boolean;
}) {
  const { t } = useLanguage();
  const [isHovered, setIsHovered] = useState(false);
  const activeHover = !disableHover && isHovered;

  const boardDims = useMemo(() => {
    const parsed = parseBoardDims(board);
    let parsedWidth = parsed.width;
    const parsedHeight = parsed.height;
    if (hideWidthWaste && safeNum(board.strip_width) > 0) {
      parsedWidth = safeNum(board.strip_width);
    }
    return { width: parsedWidth, height: parsedHeight, ok: parsed.ok };
  }, [board, hideWidthWaste]);

  const TILE_BASE_W = 200;
  const heightRatio = boardDims.ok && boardDims.height > 0 ? boardDims.width / boardDims.height : 1;
  const stretchFactor = heightRatio < 0.3 ? 1.8 : heightRatio < 0.5 ? 1.4 : 1.2;
  const tileH = Math.max(40, Math.round(TILE_BASE_W * heightRatio * stretchFactor));
  const tileW = TILE_BASE_W;

  const partLayout = useMemo(() => {
    if (!boardDims.ok || boardDims.height <= 0 || boardDims.width <= 0) return [];
    const bH = boardDims.height;
    const bW = boardDims.width;
    let x = safeNum(board.trim_loss);
    const sk = safeNum(board.saw_kerf);
    const laid: Array<typeof board.parts[number] & { top: number; left: number; width: number; height: number; idx: number; _dropped?: boolean }> = [];
    board.parts.forEach((p, idx) => {
      const pH = safeNum(p.cut_length) || safeNum(p.Height);
      const pW = safeNum(p.Width);
      if (pH <= 0 || pW <= 0) {
        console.warn("[BoardTile] dropping part with invalid dims", { board_id: board.board_id, part_id: p.part_id, Height: p.Height, Width: p.Width });
        laid.push({ ...p, top: 0, left: 0, width: 0, height: 0, idx, _dropped: true });
        return;
      }
      const left = clamp((x / bH) * 100, 0, 100);
      const width = clamp((pH / bH) * 100, 0, 100);
      const height = clamp((pW / bW) * 100, 0, 100);
      x += pH + sk;
      laid.push({ ...p, top: 0, left, width, height, idx });
    });
    return laid;
  }, [board, boardDims]);

  const wasteLeft = useMemo(() => {
    if (!partLayout.length) return 100;
    const last = partLayout[partLayout.length - 1];
    return last.left + last.width;
  }, [partLayout]);
  const lengthWasteWidth = Math.max(100 - wasteLeft, 0);

  const utilPct = overrideUtilNum !== undefined ? (overrideUtilNum * 100).toFixed(1) : (board.utilization * 100).toFixed(1);
  const utilNum = parseFloat(utilPct);
  const utilColor = utilNum > 80 ? "#10b981" : utilNum > 60 ? "#f59e0b" : "#ef4444";

  const stackOf = stackInfo?.stackOf || 1;

  const bottomOffset = useMemo(() => {
    if (hideWidthWaste) return 0;
    const tsp = safeNum(board.t0_strip_position, NaN);
    if (Number.isFinite(tsp) && boardDims.width > 0) {
      return clamp((tsp / boardDims.width) * 100, 0, 100);
    }
    return 0;
  }, [board.t0_strip_position, boardDims.width, hideWidthWaste]);

  const stripHeight = useMemo(() => {
    const sw = safeNum(board.strip_width);
    if (sw > 0 && boardDims.width > 0) {
      return clamp((sw / boardDims.width) * 100, 0, 100);
    }
    return 100;
  }, [board.strip_width, boardDims.width]);
  const sideLeftoverHeight = useMemo(() => {
    if (!isRotated) return 0;
    return Math.max(100 - (bottomOffset + stripHeight), 0);
  }, [bottomOffset, isRotated, stripHeight]);
  const visualBottomOffset = bottomOffset + sideLeftoverHeight;

  // ── Diagnostic fallback: if dims cannot be parsed, render a red card instead of crashing
  if (!boardDims.ok) {
    const diag = t("orderDetail.tileDiagnostic") || "Unrenderable board";
    return (
      <div
        className="relative rounded-xl border-2 border-red-400 bg-red-50 p-3 text-[11px] font-mono text-red-700"
        style={{ width: `${tileW + 24}px`, minHeight: `${tileH + 46}px` }}
        onClick={onClick.toString() === "() => {}" ? undefined : onClick}
      >
        <div className="font-bold mb-1">⚠ {diag}</div>
        <div>board_id: {board.board_id || "?"}</div>
        <div>board: {String(board.board ?? "") || "∅"}</div>
        <div>board_size: {String(board.board_size ?? "") || "∅"}</div>
        <div>strip_width: {String(board.strip_width ?? "?")}</div>
        <div>parts: {Array.isArray(board.parts) ? board.parts.length : "?"}</div>
      </div>
    );
  }

  const tileContent = (
    <>
      <div className="px-2 pt-2 pb-1 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold text-foreground truncate">{board.board_id}</span>
        </div>
        {!hideUtilization && <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color: utilColor }}>{utilPct}%</span>}
      </div>

      <div className={`px-2 pb-2 flex justify-center ${showDimensions ? (isRotated ? 'mt-5 mb-3 ml-8 mr-8' : 'mt-2 mb-5 ml-8 mr-8') : ''}`}>
        <div className="relative rounded-sm overflow-visible" style={{
          width: isRotated ? `${tileH}px` : `${tileW}px`,
          height: isRotated ? `${tileW}px` : `${tileH}px`,
        }}>
          {showDimensions && (
            <>
              {/* Length label */}
              <div 
                className={`absolute text-[10px] text-gray-500 font-mono whitespace-nowrap ${isRotated ? 'top-1/2 -right-[30px] -translate-y-1/2' : 'bottom-[-16px] left-1/2 -translate-x-1/2'}`}
                style={isRotated ? { writingMode: 'vertical-rl' } : {}}
              >
                {boardDims.height}
              </div>
              {/* Width label (styled identically to length label) */}
              <div 
                className={`absolute text-[10px] text-gray-500 font-mono whitespace-nowrap ${isRotated ? 'top-[-16px] left-1/2 -translate-x-1/2' : 'right-[-30px] top-1/2 -translate-y-1/2'}`}
                style={!isRotated ? { writingMode: 'vertical-rl', transform: 'rotate(180deg)' } : {}}
              >
                {boardDims.width}
              </div>
              {/* Feed direction arrow (ALWAYS on the left, pointing left) */}
              <div className="absolute left-[-26px] top-1/2 -translate-y-1/2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </div>
            </>
          )}

          <div className="absolute overflow-hidden rounded-sm" style={{
            ...(isRotated ? {
                width: `${tileW}px`, height: `${tileH}px`,
                transform: 'rotate(90deg)',
                transformOrigin: 'top left',
                left: `${tileH}px`,
                top: 0
            } : {
                width: '100%', height: '100%',
                left: 0, top: 0
            }),
            backgroundColor: color.light, border: `1.5px solid ${color.border}`,
          }}>
            {/* Shaded area for previously cut strips (if this is Strip 2+) */}
            {bottomOffset > 0 && !hidePreviousStripShade && (
              <div className="absolute" style={{
                left: 0, width: '100%',
                bottom: `${sideLeftoverHeight}%`, height: `${bottomOffset}%`,
                backgroundColor: "#e2e8f0",
                backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)",
                borderTop: `1px dashed ${color.border}80`,
              }} />
            )}

            {/* Parts */}
            {partLayout.filter((p) => !p._dropped).map((p) => (
              <React.Fragment key={`${p.part_id}-${p.idx}`}>
                <div
                  className="absolute"
                  data-part-id={p.part_id}
                  data-cab-id={p.cab_id}
                  data-part-h={p.Height}
                  data-part-w={p.Width}
                  style={{
                    left: `${lengthWasteWidth + p.left}%`, bottom: `${visualBottomOffset}%`, width: `${p.width}%`, height: `${p.height}%`,
                    backgroundColor: color.bg,
                    borderRight: `1px solid ${color.border}`,
                    borderTop: p.height < 100 ? `1px solid ${color.border}` : undefined,
                  }}
                />
                {/* Upper Waste */}
                {p.height < stripHeight && (
                  <div className="absolute" style={{
                    left: `${lengthWasteWidth + p.left}%`, bottom: `${visualBottomOffset + p.height}%`, width: `${p.width}%`, height: `${stripHeight - p.height}%`,
                    backgroundColor: "#f8fafc",
                    backgroundImage: "repeating-linear-gradient(45deg, #f8fafc, #f8fafc 4px, rgba(0,0,0,0.2) 4px, rgba(0,0,0,0.2) 5.5px)",
                    borderRight: `1px dashed #94a3b8`,
                    borderTop: `1px solid ${color.border}20`,
                  }} />
                )}
              </React.Fragment>
            ))}

            {/* Length Leftover area (ALWAYS Waste) */}
            {lengthWasteWidth > 0.5 && (
              <div className="absolute" style={{
                left: 0, width: `${lengthWasteWidth}%`,
                bottom: `${visualBottomOffset}%`, height: `${stripHeight}%`,
                backgroundColor: "#f8fafc",
                backgroundImage: "repeating-linear-gradient(45deg, #f8fafc, #f8fafc 4px, rgba(0,0,0,0.2) 4px, rgba(0,0,0,0.2) 5.5px)",
                borderRight: `1.5px dashed #94a3b8`,
                borderBottom: visualBottomOffset > 0 ? `1px solid ${color.border}40` : undefined,
                borderTop: `1px solid ${color.border}`,
              }} />
            )}

            {/* Width Leftover area (Waste or Recovered) */}
            {stripHeight < 100 && (() => {
              const remainingWidthMm = ((100 - stripHeight) / 100) * boardDims.width;
              // Only leftovers that maintain the full 2438.4 length (width rips) can be recovered
              const isRecovered = remainingWidthMm >= 200;
              return (
                <div className="absolute" style={{
                  left: 0, width: '100%',
                  bottom: isRotated ? 0 : `${bottomOffset + stripHeight}%`,
                  height: `${100 - (bottomOffset + stripHeight)}%`,
                  ...(isRecovered 
                    ? {
                        backgroundColor: "#a1f2c6",
                        ...(isRotated ? { borderTop: `1.5px dashed #10b981` } : { borderBottom: `1.5px dashed #10b981` }),
                      }
                    : {
                        backgroundColor: "#f8fafc",
                        backgroundImage: "repeating-linear-gradient(45deg, #f8fafc, #f8fafc 4px, rgba(0,0,0,0.2) 4px, rgba(0,0,0,0.2) 5.5px)",
                        ...(isRotated ? { borderTop: `1.5px dashed #94a3b8` } : { borderBottom: `1.5px dashed #94a3b8` }),
                      })
                }} />
              );
            })()}
          </div>
        </div>
      </div>
    </>
  );

  const containerW = isRotated ? tileH : tileW;
  const containerH = isRotated ? tileW : tileH;

  const cardContainer = (
    <div
      className={`relative transition-all duration-300 ${activeHover ? 'z-50' : 'z-0'} ${onClick.toString() === "() => {}" ? "" : "cursor-pointer"}`}
      style={{ width: `${containerW + (showDimensions ? 80 : 24)}px`, height: `${containerH + (showDimensions ? 56 : 46)}px` }}
      onClick={onClick.toString() === "() => {}" ? undefined : onClick}
      onMouseEnter={() => !disableHover && setIsHovered(true)}
      onMouseLeave={() => !disableHover && setIsHovered(false)}
    >
      {/* Floating Badge above the card */}
      {!hideStackBadge && stackOf > 1 && (
        <div 
          className="absolute left-1/2 -translate-x-1/2 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] z-50 rounded-full px-2 py-0.5 pointer-events-none flex items-center shadow-lg border"
          style={{
             top: activeHover ? '-36px' : '-12px',
             background: color.bg,
             borderColor: color.border,
             color: color.text,
             transform: activeHover ? `translateX(-50%) scale(1.15)` : `translateX(-50%) scale(1)`,
             opacity: activeHover ? 0 : 1
          }}
        >
          <span className="font-bold text-[11px] whitespace-nowrap">×{stackOf} {t("orderDetail.stackCutBadge")}</span>
        </div>
      )}

      {/* Backdrops for stack effect (animated on hover to fan out like cards) */}
      {stackOf > 1 && Array.from({ length: stackOf - 1 }).map((_, domIndex) => {
        const depth = Math.min(stackOf - 1, 4) - domIndex; 
        
        const baseTransform = `translate(${depth * 6}px, ${depth * 6}px) rotate(0deg) scale(1)`;
        const hoverTransform = `translate(${depth * (tileW + 16)}px, 0px) rotate(0deg) scale(1)`;
        
        return (
          <div 
            key={domIndex}
            className="absolute top-0 left-0 bg-white rounded-xl border transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-bottom-left"
            style={{ 
              borderColor: color.border + "30", 
              width: `100%`, 
              height: `100%`,
              transform: activeHover ? hoverTransform : baseTransform,
              boxShadow: activeHover ? 'inset 0 0 0 1px rgba(0,0,0,0.12), 0 8px 30px rgba(0,0,0,0.12)' : 'inset 0 0 0 1px rgba(0,0,0,0.08)',
              overflow: 'hidden',
              zIndex: activeHover ? -depth : 0
            }}
          >
             <div 
               className="w-full h-full transition-opacity duration-500" 
               style={{ opacity: activeHover ? 0.9 : 0.6 }} 
             >
               {tileContent}
             </div>
          </div>
        );
      })}

      {/* Main Tile */}
      <div
        className="absolute top-0 left-0 bg-card rounded-xl border overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-bottom-left bg-white"
        style={{ 
          borderColor: color.border + "30", 
          width: `100%`, 
          height: `100%`,
          transform: `translate(0px, 0px) rotate(0deg) scale(1)`,
          boxShadow: activeHover ? '0 20px 40px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.04)'
        }}
      >
        {tileContent}
      </div>
    </div>
  );
  return cardContainer;
}
