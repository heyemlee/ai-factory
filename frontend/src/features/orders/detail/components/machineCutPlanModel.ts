import type { Board } from "./types";
import { nominalStockWidthForBoard, parseBoardDims } from "./utils";

/** Convert 0-based index to number string: 0→"1", 1→"2" */
export function indexToNumberStr(idx: number): string {
  return String(idx + 1);
}

export function formatOrderInlineLabel(lang: "zh" | "en" | "es", orderNoLabel: string, orderLabel: string): string {
  if (!orderLabel) return "";
  return lang === "zh" ? `(${orderNoLabel}${orderLabel})` : `(${orderNoLabel} ${orderLabel})`;
}

const T0_RAW_WIDTH_MM = 1219.2;
const T0_RAW_LENGTH_MM = 2438.4;

function fmtMm(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function parseT0SheetDims(sheetId: string): { width: number; length: number } {
  const match = sheetId.match(/T0-(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return { width: T0_RAW_WIDTH_MM, length: T0_RAW_LENGTH_MM };
  return {
    width: parseFloat(match[1]) || T0_RAW_WIDTH_MM,
    length: parseFloat(match[2]) || T0_RAW_LENGTH_MM,
  };
}

export interface MachineT0Recovered {
  width?: number;
  board_type?: string;
  label?: string;
  color?: string;
}

export interface MachineT0Sheet {
  sheet_id: string;
  color?: string;
  strips?: Array<{ strip_width?: number; width?: number; target_width?: number; board_type?: string; strip_label?: string }>;
  recovered_strips?: MachineT0Recovered[];
  remaining_width?: number;
  waste_final?: number;
  waste_width?: number;
  utilization?: number;
}

export type MachinePattern = {
  sampleBoard: Board;
  boardCount: number;
  cutRows: { cutLength: number; pieces: number }[];
};

export type MachineCutSection = {
  key: string;
  sourcePriority: number;
  color: string;
  boardType: string;
  boardWidth: number;
  totalLength: number;
  trimSetting: number;
  patterns: MachinePattern[];
  needsWidthRip: boolean;
  ripStockWidthMm: number | null;
};

export type MachineT0RipBatch = {
  key: string;
  rowOrder: number;
  sheetIds: string[];
  totalLength: number;
  width: number;
  trim: number;
  ripWidth: number;
  pieces: number;
};

export function boardCutSource(board: Board): "T0" | "T1" {
  const source = String(board.source || "").toUpperCase();
  const boardType = String(board.board || board.board_type || "").toUpperCase();
  if (board.t0_sheet_id || source === "T0" || boardType.startsWith("T0")) return "T0";
  return "T1";
}

export function sourcePriority(source: "T0" | "T1"): number {
  return source === "T1" ? 0 : 1;
}

function boardNeedsWidthRip(board: Board, targetWidth: number): boolean {
  const sourceWidth =
    board.source_stock_width ||
    board.rip_from ||
    nominalStockWidthForBoard(board) ||
    parseBoardDims(board).width ||
    0;
  return sourceWidth > 0 && sourceWidth - targetWidth > 0.5;
}

function firstPatternCutLength(pattern: MachinePattern): number {
  return pattern.cutRows[0]?.cutLength || 0;
}

export function comparePatternPriority(
  a: { pattern: MachinePattern; boardWidth: number; sourcePriority?: number },
  b: { pattern: MachinePattern; boardWidth: number; sourcePriority?: number }
): number {
  if ((a.sourcePriority ?? 0) !== (b.sourcePriority ?? 0)) {
    return (a.sourcePriority ?? 0) - (b.sourcePriority ?? 0);
  }
  if (a.pattern.boardCount !== b.pattern.boardCount) {
    return b.pattern.boardCount - a.pattern.boardCount;
  }
  const aNeedsRip = boardNeedsWidthRip(a.pattern.sampleBoard, a.boardWidth);
  const bNeedsRip = boardNeedsWidthRip(b.pattern.sampleBoard, b.boardWidth);
  if (aNeedsRip !== bNeedsRip) return aNeedsRip ? 1 : -1;
  if (Math.abs(a.boardWidth - b.boardWidth) > 0.01) return a.boardWidth - b.boardWidth;
  return firstPatternCutLength(a.pattern) - firstPatternCutLength(b.pattern);
}

export function maxPatternStack(patterns: MachinePattern[]): number {
  return Math.max(0, ...patterns.map((pattern) => pattern.boardCount));
}

export function formatCutNote(
  lang: "zh" | "en" | "es",
  board: Board,
  stackQty: number,
  targetWidth: number,
  rowCutLength: number,
  cutRows: number
): string {
  if (board.stretcher_phase) {
    const yieldCount = board.source_stock_yield_count || 1;
    const width = fmtMm(targetWidth || 101.6);
    const len = fmtMm(rowCutLength);
    if (lang === "zh") return `[叠 ${stackQty} / rip ${yieldCount}×${width} / length→${len}]`;
    if (lang === "es") return `[apilar ${stackQty} / rip ${yieldCount}×${width} / largo→${len}]`;
    return `[stack ${stackQty} / rip ${yieldCount}×${width} / length→${len}]`;
  }

  const nominal = nominalStockWidthForBoard(board);
  const needsRip = nominal != null && nominal - targetWidth > 0.5;
  const widthPart = needsRip ? ` / width→${fmtMm(targetWidth)}` : "";
  if (lang === "zh") return `[叠 ${stackQty}${widthPart} / length ${cutRows} 刀]`;
  if (lang === "es") return `[apilar ${stackQty}${widthPart} / largo ${cutRows} corte${cutRows === 1 ? "" : "s"}]`;
  return `[stack ${stackQty}${widthPart} / length ${cutRows} cut${cutRows === 1 ? "" : "s"}]`;
}

