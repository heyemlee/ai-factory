import type { Board } from "./types";

/** 安全数字 — returns a finite non-negative number or fallback. */
export function safeNum(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Clamp a number into [lo, hi], coercing NaN/Infinity to lo. */
export function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Effective rip width for a strip — the saw's actual rip setting after
 * accounting for edge-banding allowance. Falls back to strip_width if the
 * board doesn't carry rip_width or per-part cut_width data.
 */
export function getRipWidth(board: Board): number {
  const explicit = safeNum(board.rip_width);
  if (explicit > 0) return explicit;
  if (Array.isArray(board.parts) && board.parts.length > 0) {
    const widths = board.parts
      .map((p) => safeNum(p.cut_width) || safeNum(p.Width))
      .filter((w) => w > 0);
    if (widths.length > 0) return Math.max(...widths);
  }
  return safeNum(board.strip_width);
}

/** Parse "1219.2×2438.4" / "1219x2438" from board.board or board.board_size. */
export function parseBoardDims(board: { board?: string; board_size?: string }):
  { width: number; height: number; ok: boolean } {
  const sources = [board.board, board.board_size].filter(Boolean) as string[];
  for (const src of sources) {
    const m = src.match(/(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)/i);
    if (m) {
      const w = safeNum(m[1]);
      const h = safeNum(m[2]);
      if (w > 0 && h > 0) return { width: w, height: h, ok: true };
    }
  }
  return { width: 0, height: 0, ok: false };
}

/* ── Cut-length multiset (order-independent) for stack-cut matching ── */
export function cutLengthMultisetSignature(board: Board): string {
  const counts = new Map<number, number>();
  for (const p of board.parts) {
    const raw = p.cut_length ?? p.Height;
    const len = Math.round(raw * 1000) / 1000;
    counts.set(len, (counts.get(len) || 0) + 1);
  }
  const sorted = [...counts.keys()].sort((a, b) => a - b);
  return sorted.map((k) => `${k}×${counts.get(k)!}`).join("|");
}

/* Stack cutting: same board_size + identical cut-length multiset → stackable */
export function boardFingerprint(board: Board): string {
  return `${board.board_size}|${cutLengthMultisetSignature(board)}`;
}

/** Nominal stock width from SKU label (e.g. T0-1219x2438 → 1219). Not from board_size (often strip width). */
export function nominalStockWidthFromLabel(label: string): number | null {
  if (!label) return null;
  const m = label.match(/T\d+\s*-\s*([\d.]+)\s*[x×*]\s*([\d.]+)/i);
  if (m) return parseFloat(m[1]);
  return null;
}

export function nominalStockWidthForBoard(board: Board): number | null {
  for (const s of [board.board, board.board_type, board.board_id]) {
    const w = nominalStockWidthFromLabel(s || "");
    if (w != null && !Number.isNaN(w)) return w;
  }
  return null;
}

export function formatStackCutSequence(sampleBoard: Board, stackSize: number, perCutLabel: string): string {
  if (!sampleBoard.parts.length) return "—";
  return sampleBoard.parts
    .map((p) => {
      const L = (p.cut_length || p.Height).toFixed(1);
      if (stackSize <= 1) return L;
      return `${L}（×${stackSize}${perCutLabel}）`;
    })
    .join(" → ");
}

/**
 * Compute waste dimensions from a board.
 * Returns a string like "150×838.2" (wasteLength × stripWidth) in mm.
 */
export function formatWasteDimensions(board: Board): string {
  // waste field is in mm (linear waste along the length axis)
  const wasteLength = board.waste;
  const stripW = board.strip_width || 0;
  if (wasteLength <= 0) return "0";
  if (stripW > 0) {
    return `${wasteLength.toFixed(0)}×${stripW.toFixed(0)}`;
  }
  // Fallback: show just the linear waste
  return `${wasteLength.toFixed(0)}`;
}
