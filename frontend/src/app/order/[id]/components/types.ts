/* ── Shared types for the Order Detail page ── */

export interface Part {
  part_id: string;
  Height: number;
  Width: number;
  cut_length: number;
  component: string;
  cab_id: string;
  cab_type: string;
  rotated?: boolean;
  auto_swapped?: boolean;
}

export interface IntegrityIssue {
  code: string;
  severity: "error" | "warn";
  msg: string;
  ref?: Record<string, unknown>;
}

export interface CabinetBreakdownEntry {
  cab_type: string;
  count: number;
  parts: { part_id: string; component: string; Height: number; Width: number }[];
}

export interface Board {
  board_id: string;
  board: string;
  board_type: string;
  board_size: string;
  strip_width: number;
  parts: Part[];
  trim_loss: number;
  saw_kerf: number;
  cuts: number;
  parts_total_length: number;
  parts_total_area: number;
  board_area: number;
  kerf_total: number;
  usable_length: number;
  waste: number;
  utilization: number;
  source?: string;
  /* T0 sheet traceability — set when source === "T0" */
  t0_sheet_id?: string;
  t0_sheet_index?: number;
  t0_strip_position?: number;
  t0_total_strips_on_sheet?: number;
  t0_sheet_utilization?: number;
  t0_all_strips?: { strip_width: number; strip_index: number }[];
  t0_remaining_width?: number;
  actual_strip_width?: number;
}

export interface InventoryShortage {
  board_type: string;
  needed: number;
  stock: number;
  shortage: number;
}

export interface RecoveredStrip {
  width: number;
  board_type: string;
  type?: string;
  label?: string;
}

export interface CutResult {
  summary: {
    boards_used: number;
    total_parts_placed: number;
    overall_utilization: number;
    total_waste: number;
    inventory_shortage?: InventoryShortage[];
    inventory_used?: Record<string, number>;
    board_type_breakdown?: Record<string, number>;
  };
  boards: Board[];
  recovered_inventory?: RecoveredStrip[];
  t0_plan?: {
    t0_sheets?: Array<{
      sheet_id: string;
      recovered_strips?: RecoveredStrip[];
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  cabinet_breakdown?: Record<string, CabinetBreakdownEntry>;
  issues?: {
    integrity?: IntegrityIssue[];
    schema?: IntegrityIssue[];
    oversized_parts?: unknown[];
    unmatched_parts?: unknown[];
    skipped_rows?: unknown[];
    [key: string]: unknown;
  };
}

export interface Order {
  id: string;
  job_id: string;
  status: string;
  cut_result_json: CutResult | null;
  cabinets_summary: string;
  extra_boards_used?: { board_type: string; count: number }[];
}

export interface Cabinet {
  cab_id: string;
  cab_type: string;
  parts: Part[];
  dimensions: { width: number; height: number; depth: number };
}

export interface PatternNumbering {
  byIndex: Record<number, number>;
  byFingerprint: Record<string, number>;
  total: number;
}

export interface StackInfo {
  groupSize: number;
  stackOf: number;
  isLeader: boolean;
}

export interface SizeColor {
  bg: string;
  border: string;
  text: string;
  light: string;
}

export interface EngineeringGroup {
  key: string;
  engNo: number;
  boardType: string;
  boardWidth: number;
  totalLength: number;
  trimSetting: number;
  sourceBoardCount: number;
  boards: Board[];
  patterns: {
    sampleBoard: Board;
    boardCount: number;
    cutRows: { cutLength: number; pieces: number }[];
  }[];
  needsWidthRip: boolean;
  ripStockWidthMm: number | null;
  distinctCutPatterns: number;
  inconsistent?: boolean;
}
