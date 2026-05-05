/* ── Shared types for the Order Detail page ── */

export interface Part {
  part_id: string;
  Height: number;
  Width: number;
  cut_length: number;
  cut_width?: number;
  component: string;
  cab_id: string;
  cab_type: string;
  color?: string;
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
  color?: string;
  count: number;
  parts: { part_id: string; component: string; Height: number; Width: number }[];
}

export interface Board {
  board_id: string;
  board: string;
  board_type: string;
  board_size: string;
  strip_width: number;
  rip_width?: number;
  color?: string;
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
  t0_source_strip_width?: number;
  t0_source_strip_label?: string;
  t0_source_strip_secondary?: boolean;
  stretcher_phase?: boolean;
  source_stock_group_id?: string;
  source_stock_width?: number;
  source_stock_board_type?: string;
  source_stock_yield_count?: number;
  source_stock_waste_width?: number;
  rip_from?: number;
  rip_leftover?: number;
  rip_leftover_recovered?: boolean;
}

export interface InventoryShortage {
  board_type: string;
  color?: string;
  needed: number;
  stock: number;
  shortage: number;
}

export interface RecoveredStrip {
  width: number;
  board_type: string;
  color?: string;
  type?: string;
  label?: string;
}

export interface CutResult {
  summary: {
    boards_used: number;
    total_parts_placed: number;
    overall_utilization: number;
    total_waste: number;
    cut_mode?: "inventory_first" | "t0_start";
    cut_algorithm?: "efficient" | "stack_efficiency";
    config_trim_loss_mm?: number;
    max_stack?: number;
    inventory_shortage?: InventoryShortage[];
    inventory_used?: Record<string, number>;
    board_type_breakdown?: Record<string, number>;
    by_color?: Record<string, {
      parts_total?: number;
      parts_placed?: number;
      total_parts_placed?: number;
      boards_used: number;
      t0_sheets_used?: number;
      t0_recovered_strips?: number;
      overall_utilization: number;
    }>;
  };
  boards: Board[];
  cut_mode?: "inventory_first" | "t0_start";
  cut_algorithm?: "efficient" | "stack_efficiency";
  upload_settings?: {
    cut_algorithm?: "efficient" | "stack_efficiency";
    cut_mode?: "inventory_first" | "t0_start";
    trim_loss_mm?: number;
  };
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
  filename?: string | null;
  status: string;
  cut_mode?: "inventory_first" | "t0_start";
  cut_algorithm?: "efficient" | "stack_efficiency";
  trim_loss_mm?: number;
  cut_result_json: CutResult | null;
  cabinets_summary: string;
  extra_boards_used?: { board_type: string; color?: string; count: number }[];
}

export interface Cabinet {
  cab_id: string;
  cab_type: string;
  color?: string;
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

export interface RipStackInfo {
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
  sourcePriority?: number;
  boardType: string;
  color?: string;
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
