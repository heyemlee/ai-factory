"use client";

import React, { useMemo, useRef } from "react";
import { Printer } from "lucide-react";
import type { Board, CutResult, RecoveryCuttingBoard, WasteBlock } from "./types";
import { boardFingerprint, getRipWidth, nominalStockWidthForBoard, parseBoardDims } from "./utils";
import { colorLabel, DEFAULT_BOX_COLOR, useBoxColors } from "@/lib/box_colors";
import { useLanguage } from "@/lib/i18n";

const PRINT_FONT_STACK = [
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  '"Noto Sans CJK SC"',
  '"Noto Sans SC"',
  '"Source Han Sans SC"',
  '"Heiti SC"',
  '"SimHei"',
  '"WenQuanYi Micro Hei"',
  "-apple-system",
  "BlinkMacSystemFont",
  '"SF Pro Text"',
  '"Segoe UI"',
  '"Helvetica Neue"',
  "Arial",
  "sans-serif",
].join(", ");

const T0_RAW_LENGTH_MM = 2438.4;
const SAW_KERF_MM = 3.2;

const WASTE_CATEGORY_DEFS = [
  { key: "under8", min: 90, max: 8 * 25.4 },
  { key: "8to12", min: 8 * 25.4, max: 12 * 25.4 },
  { key: "12to18", min: 12 * 25.4, max: 18 * 25.4 },
  { key: "18to24", min: 18 * 25.4, max: 24 * 25.4 },
];

type LocaleKey = "en" | "zh" | "es";

interface CutPlanT0Recovered {
  width?: number;
  board_type?: string;
  label?: string;
}

interface CutPlanT0Sheet {
  sheet_id: string;
  strips?: Array<{ strip_width?: number; width?: number; target_width?: number }>;
  recovered_strips?: CutPlanT0Recovered[];
  trim_loss?: number;
  /** Number of physical T0 raw sheets stacked together (叠切). Defaults to 1. */
  t0_sheet_stack?: number;
}

interface CutPlanPattern {
  sampleBoard: Board;
  boardCount: number;
  cutRows: { cutLength: number; pieces: number; stackOf?: number }[];
}

interface CutPlanSection {
  sourcePriority: number;
  boardType: string;
  boardWidth: number;
  totalLength: number;
  trimSetting: number;
  patterns: CutPlanPattern[];
}

interface CutPlanInputRow {
  key: string;
  rowNo: number | string;
  value: number;
  sizeLabel?: string;
  pieces: number;
  note?: string;
  isLeftover?: boolean;
}

interface CutPlanStep {
  key: string;
  inputLabel: string;
  stepNo: number;
  take: string;
  stackQty: number;
  stackUnit: string;
  cutLabel: string;
  rows: CutPlanInputRow[];
}

interface CutPlanBlock {
  key: string;
  take: string;
  stackQty: number;
  stackUnit: string;
  trim: number;
  steps: CutPlanStep[];
}

interface WidthGroup {
  rowNo: number;
  width: number;
  pieces: number;
  boards: Board[];
  note?: string;
}

interface SummaryRow {
  key: string;
  label: string;
  size?: string;
  count: number;
  source?: string;
}

const copy: Record<LocaleKey, Record<string, string>> = {
  en: {
    title: "Text Cut Plan",
    print: "Print",
    orderNo: "Order No.",
    color: "Color",
    cabinets: "Cabinets",
    setups: "Machine Setups",
    boards: "Boards",
    utilization: "Utilization",
    setup: "Setup",
    step: "Step",
    inputType: "Input Type",
    material: "Material",
    source: "Source",
    totalLength: "Total Length",
    width: "Width",
    trim: "Trim",
	    stack: "Stack",
	    row: "Row",
	    cut: "Cut",
	    size: "Size",
	    pieces: "Pieces",
	    recover: "RCV",
	    t0SectionTitle: "2. T0 Cutting Area",
	    t1SectionTitle: "1. T1 Cutting Area",
	    recoverySectionTitle: "3. Waste Reuse Zone",
	    wasteSectionTitle: "4. Waste Area",
	    recoveredSectionTitle: "5. Recovered Board Area",
	    noteWaste: "Waste",
	    notePutToArea: "Put in {area}",
	    wasteAreaSuffix: "Waste Area",
	    noteHeader: "Note",
	    leftover: "Leftover",
	    summaryArea: "Area",
	    summaryType: "Type",
	    summaryQty: "Qty",
	    ripWidth: "Cut Width",
	    cutWidth: "Cut Width",
	    widthCut: "W",
	    cutLength: "Cut Length",
	    lengthCut: "L",
	    take: "Take",
	    rawSheets: '48" x 96"',
    t1Strips: "T1 strips",
    sheets: "sheets",
    strips: "strips",
    machineSetup: "① Machine Setup",
	    boardInput: "② Board Input",
	    useWidthRow: "Use Width Row",
	    finishedParts: "Finished Parts",
	    recoveredParts: "Recovered Parts",
	    trimLabel: "Trim",
	    empty: "No cut plan data available.",
	  },
  zh: {
    title: "Text Cut Plan",
    print: "打印",
    orderNo: "订单号",
    color: "颜色",
    cabinets: "Cabinets",
    setups: "机器设置",
    boards: "板数",
    utilization: "利用率",
    setup: "设置",
    step: "步骤",
    inputType: "输入类型",
    material: "板材型号",
    source: "来源",
    totalLength: "总长度",
    width: "宽度",
    trim: "修边",
	    stack: "叠切",
	    row: "序号",
	    cut: "裁切",
	    size: "尺寸",
	    pieces: "片数",
	    recover: "RCV",
	    t0SectionTitle: "2. T0 裁切区域",
	    t1SectionTitle: "1. T1 裁切区域",
	    recoverySectionTitle: "3. 废料再利用区",
	    wasteSectionTitle: "4. 废料区域",
	    recoveredSectionTitle: "5. 回收板材区域",
	    noteWaste: "废料",
	    notePutToArea: "放到 {area}",
	    wasteAreaSuffix: "废料",
	    noteHeader: "备注",
	    leftover: "余料",
	    summaryArea: "区域",
	    summaryType: "类型",
	    summaryQty: "数量",
	    ripWidth: "裁切宽度",
	    cutWidth: "裁切宽度",
	    widthCut: "W",
	    cutLength: "裁切长度",
	    lengthCut: "L",
	    take: "拿料",
	    rawSheets: '48" x 96"',
    t1Strips: "T1 条料",
    sheets: "张",
    strips: "条",
	    machineSetup: "① 机器设置",
	    boardInput: "② 板材输入",
	    useWidthRow: "使用宽度行",
	    finishedParts: "成品零件",
	    recoveredParts: "回收零件",
	    trimLabel: "Trim",
	    empty: "暂无裁切流程数据。",
	  },
  es: {
    title: "Text Cut Plan",
    print: "Imprimir",
    orderNo: "No. de Pedido",
    color: "Color",
    cabinets: "Cabinets",
    setups: "Configuraciones",
    boards: "Tableros",
    utilization: "Utilización",
    setup: "Config.",
    step: "Paso",
    inputType: "Tipo",
    material: "Material",
    source: "Origen",
    totalLength: "Longitud Total",
    width: "Ancho",
    trim: "Recorte",
	    stack: "Apilado",
	    row: "Fila",
	    cut: "Corte",
	    size: "Tamano",
	    pieces: "Piezas",
	    recover: "RCV",
	    t0SectionTitle: "2. Area de Corte T0",
	    t1SectionTitle: "1. Area de Corte T1",
	    recoverySectionTitle: "3. Zona de Reutilización de Desperdicio",
	    wasteSectionTitle: "4. Area de Desperdicio",
	    recoveredSectionTitle: "5. Area de Tableros Recuperados",
	    noteWaste: "Desperdicio",
	    notePutToArea: "Poner en {area}",
	    wasteAreaSuffix: "Desperdicio",
	    noteHeader: "Nota",
	    leftover: "Sobrante",
	    summaryArea: "Area",
	    summaryType: "Tipo",
	    summaryQty: "Cant.",
	    ripWidth: "Cortar Ancho",
	    cutWidth: "Cortar Ancho",
	    widthCut: "W",
	    cutLength: "Longitud Corte",
	    lengthCut: "L",
	    take: "Tomar",
	    rawSheets: '48" x 96"',
    t1Strips: "tiras T1",
    sheets: "hojas",
    strips: "tiras",
	    machineSetup: "① Configuración",
	    boardInput: "② Entrada",
	    useWidthRow: "Usar fila de ancho",
	    finishedParts: "Piezas Finales",
	    recoveredParts: "Piezas Recuperadas",
	    trimLabel: "Trim",
	    empty: "No hay datos de plan de corte.",
	  },
};

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function parseTotalLength(boardSize: string): number {
  const match = boardSize.match(/([\d.]+)\s*[×x*]\s*([\d.]+)/i);
  if (!match) return T0_RAW_LENGTH_MM;
  const len = parseFloat(match[2]);
  return len === 2438 ? 2438.4 : len;
}

function numericKey(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "0.000";
}

function wasteCategoryLabel(key: string, locale: LocaleKey): string {
  const labels: Record<LocaleKey, Record<string, string>> = {
    en: {
      under8: '~8" Area',
      "8to12": '8"-12" Area',
      "12to18": '12"-18" Area',
      "18to24": '18"-24" Area',
    },
    zh: {
      under8: '~8"区',
      "8to12": '8"-12"区',
      "12to18": '12"-18"区',
      "18to24": '18"-24"区',
    },
    es: {
      under8: 'Area ~8"',
      "8to12": 'Area 8"-12"',
      "12to18": 'Area 12"-18"',
      "18to24": 'Area 18"-24"',
    },
  };
  return labels[locale]?.[key] || labels.en[key] || key;
}

function wasteCategories(locale: LocaleKey) {
  return WASTE_CATEGORY_DEFS.map((category) => ({
    ...category,
    label: wasteCategoryLabel(category.key, locale),
  }));
}

function wasteCategoryForWidth(width: number, locale: LocaleKey) {
  const categories = wasteCategories(locale);
  return categories.find((category, index) => {
    const isLast = index === categories.length - 1;
    return width >= category.min && (isLast ? width <= category.max : width < category.max);
  });
}

function wasteText(locale: LocaleKey): string {
  return copy[locale]?.noteWaste || copy.en.noteWaste;
}

function residualNote(width: number, locale: LocaleKey, recovered = false): string | undefined {
  if (width <= 0.5) return undefined;
  if (recovered) return "RCV";
  const category = wasteCategoryForWidth(width, locale);
  if (!category) return undefined;
  return (copy[locale]?.notePutToArea || copy.en.notePutToArea).replace("{area}", category.label);
}

function directWasteNote(width: number, locale: LocaleKey): string | undefined {
  if (width <= 0.5) return undefined;
  return wasteText(locale);
}

function leftoverRow(
  key: string,
  value: number,
  pieces: number,
  note: string | undefined,
  locale: LocaleKey,
  sizeLabel?: string
): CutPlanInputRow[] {
  if (!note || value <= 0.5) return [];
  return [{
    key,
    rowNo: copy[locale]?.leftover || copy.en.leftover,
    value,
    sizeLabel,
    pieces,
    note,
    isLeftover: true,
  }];
}

function aggregateLeftoverRows(
  leftovers: Array<{ key: string; value: number; pieces?: number; note?: string }>,
  locale: LocaleKey
): CutPlanInputRow[] {
  const grouped = new Map<string, { value: number; pieces: number; note: string }>();
  for (const leftover of leftovers) {
    if (!leftover.note || leftover.value <= 0.5) continue;
    const rounded = Math.round(leftover.value * 10) / 10;
    const key = `${numericKey(rounded)}|||${leftover.note}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.pieces += leftover.pieces || 1;
    } else {
      grouped.set(key, { value: rounded, pieces: leftover.pieces || 1, note: leftover.note });
    }
  }
  return Array.from(grouped.values()).map((leftover, index) => ({
    key: `leftover-${index}-${numericKey(leftover.value)}-${leftover.note}`,
    rowNo: copy[locale]?.leftover || copy.en.leftover,
    value: leftover.value,
    pieces: leftover.pieces,
    note: leftover.note,
    isLeftover: true,
  }));
}

function lengthWasteNote(width: number, wasteLength: number, locale: LocaleKey): string | undefined {
  if (wasteLength <= 0.5) return undefined;
  return residualNote(width, locale);
}

function stripLengthWasteForPattern(pattern: CutPlanPattern): number {
  const board = pattern.sampleBoard;
  const usedLength = (board.parts || []).reduce((sum, part) => sum + (part.cut_length || part.Height || 0), 0);
  const kerf = Math.max(0, (board.parts?.length || 0) - 1) * (board.saw_kerf || SAW_KERF_MM);
  return (board.usable_length || parseTotalLength(board.board_size)) - usedLength - kerf;
}

function sourceWidthWasteNote(board: Board, targetWidth: number, locale: LocaleKey): string | undefined {
  const sourceWidth = sourceWidthForBoard(board, targetWidth);
  const wasteWidth = sourceWidth - targetWidth - (board.saw_kerf || SAW_KERF_MM);
  return residualNote(wasteWidth, locale, !!board.rip_leftover_recovered);
}

function sourceWidthWasteSize(board: Board, targetWidth: number): number {
  const sourceWidth = sourceWidthForBoard(board, targetWidth);
  return sourceWidth - targetWidth - (board.saw_kerf || SAW_KERF_MM);
}

function sourceTakeLabelWithWidth(board: Board, targetWidth: number): string {
  const sourceWidth = sourceWidthForBoard(board, targetWidth);
  const sourceLength = parseTotalLength(board.board_size);
  return `${fmt(sourceWidth)} x ${fmt(sourceLength)}`;
}

function recoveryTakeLabel(board: RecoveryCuttingBoard, locale: LocaleKey): string {
  if (board.source === "waste") {
    const category = wasteCategoryForWidth(board.width, locale);
    const suffix = copy[locale]?.wasteAreaSuffix || copy.en.wasteAreaSuffix;
    return category ? `${category.label} ${suffix}` : suffix;
  }
  if (Math.abs(board.width - 608.6) < 0.5) return '24" RCV';
  if (Math.abs(board.width - 303.8) < 0.5) return '12" RCV';
  return "RCV";
}

function t0WidthGroupsForSheet(sheet: CutPlanT0Sheet, boards: Board[]): WidthGroup[] {
  const sheetBoards = boards
    .filter((board) => board.t0_sheet_id === sheet.sheet_id)
    .sort((a, b) => (a.t0_strip_position || 0) - (b.t0_strip_position || 0));
  const primaryBoards = sheetBoards.filter((board) => !board.t0_source_strip_secondary);
  const groupMap = new Map<string, WidthGroup & { order: number }>();

  const plannedWidths = (sheet.strips || [])
    .map((strip) => strip.width || strip.strip_width || strip.target_width || 0)
    .filter((width) => width > 0);

  if (plannedWidths.length > 0) {
    plannedWidths.forEach((width, index) => {
      const key = numericKey(width);
      const existing = groupMap.get(key);
      const matchingBoards = sheetBoards.filter((board) => {
        const sourceWidth = board.t0_source_strip_width || getRipWidth(board) || board.actual_strip_width || board.strip_width || 0;
        return Math.abs(sourceWidth - width) < 0.5;
      });
      if (existing) {
        existing.pieces += 1;
        existing.boards.push(...matchingBoards);
      } else {
        groupMap.set(key, {
          rowNo: 0,
          width,
          pieces: 1,
          order: index,
          boards: matchingBoards,
        });
      }
    });
  } else {
    primaryBoards.forEach((board, index) => {
      const width = board.t0_source_strip_width || getRipWidth(board) || board.actual_strip_width || board.strip_width || 0;
      const key = numericKey(width);
      const existing = groupMap.get(key);
      if (existing) {
        existing.pieces += 1;
        existing.boards.push(...sheetBoards.filter((candidate) => {
          if (candidate.board_id === board.board_id) return true;
          return !!board.source_stock_group_id && candidate.source_stock_group_id === board.source_stock_group_id;
        }));
      } else {
        groupMap.set(key, {
          rowNo: 0,
          width,
          pieces: 1,
          order: index,
          boards: sheetBoards.filter((candidate) => {
            if (candidate.board_id === board.board_id) return true;
            return !!board.source_stock_group_id && candidate.source_stock_group_id === board.source_stock_group_id;
          }),
        });
      }
    });
  }

  (sheet.recovered_strips || [])
    .filter((recovered) => typeof recovered.width === "number")
    .forEach((recovered, index) => {
      const width = recovered.width as number;
      const key = `recovered-${index}-${numericKey(width)}`;
      groupMap.set(key, {
        rowNo: 0,
        width,
        pieces: 1,
        order: groupMap.size + index,
        boards: [],
        note: "RCV",
      });
    });

  return Array.from(groupMap.values())
    .sort((a, b) => a.order - b.order)
    .map((group, index) => ({ rowNo: index + 1, width: group.width, pieces: group.pieces, boards: uniqueBoards(group.boards), note: group.note }));
}

function isStackEfficiencyResult(cutResult?: CutResult | null) {
  return (cutResult?.cut_algorithm || cutResult?.summary?.cut_algorithm) === "stack_efficiency";
}

function productionLengthBoardType(board: Board, mergeStandardPool: boolean) {
  if (!mergeStandardPool) return board.board;
  const width = Math.round((getRipWidth(board) || board.strip_width || 0) * 10) / 10;
  if (width === 608.6) return "T1-608.6x2438.4";
  if (width === 303.8) return "T1-303.8x2438.4";
  return board.board;
}

function boardCutSource(board: Board): "T0" | "T1" {
  const source = String(board.source || "").toUpperCase();
  const boardType = String(board.board || board.board_type || "").toUpperCase();
  if (board.t0_sheet_id || source === "T0" || boardType.startsWith("T0")) return "T0";
  return "T1";
}

function sourcePriority(source: "T0" | "T1") {
  return source === "T1" ? 0 : 1;
}

function boardNeedsWidthRip(board: Board, targetWidth: number) {
  const sourceWidth =
    board.source_stock_width ||
    board.rip_from ||
    nominalStockWidthForBoard(board) ||
    parseBoardDims(board).width ||
    0;
  return sourceWidth > 0 && sourceWidth - targetWidth > 0.5;
}

function uniqueBoards(boards: Board[]): Board[] {
  return Array.from(new Map(boards.map((board) => [board.board_id, board])).values());
}

function targetWidthForBoard(board: Board): number {
  return getRipWidth(board) || board.strip_width || 0;
}

function sourceWidthForBoard(board: Board, fallbackWidth: number): number {
  return board.source_stock_width ||
    board.rip_from ||
    nominalStockWidthForBoard(board) ||
    parseBoardDims(board).width ||
    fallbackWidth;
}

function sourceTakeLabel(board: Board, targetWidth: number): string {
  const sourceWidth = sourceWidthForBoard(board, targetWidth);
  return sourceWidth <= 303.8 ? '12"' : '24"';
}

function widthPiecesForBoards(boards: Board[]): number {
  const yieldCounts = boards
    .map((board) => board.source_stock_yield_count || (board.stretcher_phase ? 1 : 0))
    .filter((count) => count > 0);
  if (yieldCounts.length > 0) return Math.max(...yieldCounts);
  return 1;
}

function groupBoardsByTargetWidth(boards: Board[]): WidthGroup[] {
  const groupMap = new Map<string, WidthGroup & { order: number }>();
  boards.forEach((board, index) => {
    const width = targetWidthForBoard(board);
    const key = numericKey(width);
    const existing = groupMap.get(key);
    if (existing) {
      existing.boards.push(board);
      existing.pieces = Math.max(existing.pieces, widthPiecesForBoards(existing.boards));
    } else {
      groupMap.set(key, {
        rowNo: 0,
        width,
        pieces: widthPiecesForBoards([board]),
        order: index,
        boards: [board],
      });
    }
  });
  return Array.from(groupMap.values())
    .sort((a, b) => a.order - b.order)
    .map((group, index) => ({ rowNo: index + 1, width: group.width, pieces: group.pieces, boards: uniqueBoards(group.boards) }));
}

function rowsForCutLengths(pattern: CutPlanPattern, keyPrefix: string, stripWidth: number, locale: LocaleKey): CutPlanInputRow[] {
  const finalNote = lengthWasteNote(stripWidth, stripLengthWasteForPattern(pattern), locale);
  const rows = pattern.cutRows.map((cutRow, index) => ({
    key: `${keyPrefix}-${index}`,
    rowNo: index + 1,
    value: cutRow.cutLength,
    pieces: cutRow.pieces,
  }));
  return [
    ...rows,
    ...leftoverRow(
      `${keyPrefix}-leftover`,
      stripLengthWasteForPattern(pattern),
      1,
      finalNote,
      locale,
      `${fmt(stripWidth)} x ${fmt(stripLengthWasteForPattern(pattern))}`
    ),
  ];
}

function stockBlockPriority(block: CutPlanBlock): number {
  const isStacked = block.stackQty > 1;
  const is24 = block.take === '24"' || block.take.startsWith("608.6");
  const is12 = block.take === '12"' || block.take.startsWith("303.8");
  if (isStacked && is24) return 0;
  if (isStacked && is12) return 1;
  if (!isStacked && is24) return 2;
  if (!isStacked && is12) return 3;
  return isStacked ? 4 : 5;
}

function maxStepStack(block: CutPlanBlock): number {
  return Math.max(block.stackQty, ...block.steps.map((step) => step.stackQty));
}

function widthCutStackQty(groups: WidthGroup[]): number {
  const counts = groups.map((group) => {
    const sourceGroups = new Set(group.boards.map((board) => board.source_stock_group_id).filter(Boolean));
    return sourceGroups.size > 0 ? sourceGroups.size : group.boards.length;
  });
  return Math.max(1, ...counts);
}

function capStackQty(qty: number): number {
  return Math.max(1, Math.min(4, qty || 1));
}

function countStockTakes(boards: Board[]): { twelve: number; twentyFour: number } {
  const twelve = new Set<string>();
  const twentyFour = new Set<string>();
  for (const board of boards) {
    if (String(board.source || "").toLowerCase() === "recovery") continue;
    if (boardCutSource(board) !== "T1") continue;
    const key = board.source_stock_group_id || board.board_id;
    const take = sourceTakeLabel(board, targetWidthForBoard(board));
    if (take === '12"') twelve.add(key);
    if (take === '24"') twentyFour.add(key);
  }
  return { twelve: twelve.size, twentyFour: twentyFour.size };
}

function countRecoveredParts(cutResult: CutResult | null | undefined, t0Sheets: CutPlanT0Sheet[]): number {
  if (Array.isArray(cutResult?.recovered_inventory)) return cutResult.recovered_inventory.length;
  return t0Sheets.reduce((sum, sheet) => {
    const stack = sheet.t0_sheet_stack || 1;
    return sum + (sheet.recovered_strips?.length || 0) * stack;
  }, 0);
}

function rowsForLaneLengths(
  lane: RecoveryCuttingBoard["lanes"][number],
  board: RecoveryCuttingBoard,
  keyPrefix: string,
  locale: LocaleKey
): CutPlanInputRow[] {
  const cutMap = new Map<number, number>();
  for (const part of lane.parts || []) {
    const cutLength = part.cut_length || part.Height;
    cutMap.set(cutLength, (cutMap.get(cutLength) || 0) + 1);
  }
  const rows = Array.from(cutMap.entries())
    .map(([value, pieces], index) => ({
      key: `${keyPrefix}-${index}`,
      rowNo: index + 1,
      value,
      pieces,
    }))
    .sort((a, b) => a.value - b.value);
  const usedLength = lane.used_length || rows.reduce((sum, row) => sum + row.value * row.pieces, 0);
  const finalNote = board.length - usedLength > 0.5 ? directWasteNote(lane.width || board.width, locale) : undefined;
  return [
    ...rows.map((row, index) => ({ ...row, rowNo: index + 1 })),
    ...leftoverRow(
      `${keyPrefix}-leftover`,
      board.length - usedLength,
      1,
      finalNote,
      locale,
      `${fmt(lane.width || board.width)} x ${fmt(board.length - usedLength)}`
    ),
  ];
}

function buildRecoveryBlocks(recoveryBoards: RecoveryCuttingBoard[], locale: LocaleKey): CutPlanBlock[] {
  const grouped = new Map<string, RecoveryCuttingBoard[]>();
  recoveryBoards
    .filter((board) => board.status === "used" && board.lanes.length > 0)
    .forEach((board) => {
      const key = board.stack_group_id || board.id;
      const list = grouped.get(key) || [];
      list.push(board);
      grouped.set(key, list);
    });

  return Array.from(grouped.entries()).map(([key, group], blockIdx) => {
    const sample = group[0];
    const stackQty = capStackQty(sample.stack_size || group.length || 1);
    const laneGroups = Array.from(sample.lanes.reduce((map, lane) => {
      const laneKey = numericKey(lane.width);
      const existing = map.get(laneKey);
      if (existing) {
        existing.pieces += 1;
      } else {
        map.set(laneKey, { width: lane.width, pieces: 1 });
      }
      return map;
    }, new Map<string, { width: number; pieces: number }>()).values());

    const steps: CutPlanStep[] = [{
      key: `${key}-width`,
      stepNo: 1,
      take: recoveryTakeLabel(sample, locale),
      stackQty,
      stackUnit: "条",
      cutLabel: "W",
      inputLabel: "W",
      rows: laneGroups.flatMap((laneGroup, index) => [
        {
          key: `${key}-width-${index}`,
          rowNo: index + 1,
          value: laneGroup.width,
          pieces: laneGroup.pieces,
        },
        ...leftoverRow(
          `${key}-width-${index}-leftover`,
          index === laneGroups.length - 1 ? sample.inline_waste_width || 0 : 0,
          1,
          index === laneGroups.length - 1 ? directWasteNote(sample.inline_waste_width || 0, locale) : undefined,
          locale
        ),
      ]),
    }];

    sample.lanes.forEach((lane, laneIdx) => {
      const rows = rowsForLaneLengths(lane, sample, `${key}-lane-${laneIdx}`, locale);
      if (rows.length === 0) return;
      steps.push({
        key: `${key}-length-${laneIdx}`,
        stepNo: steps.length + 1,
        take: fmt(lane.width),
        stackQty,
        stackUnit: "条",
        cutLabel: "L",
        inputLabel: "L",
        rows,
      });
    });

    return {
      key: `recovery-block-${blockIdx}-${key}`,
      take: recoveryTakeLabel(sample, locale),
      stackQty,
      stackUnit: "条",
      trim: 0,
      steps,
    };
  });
}

function directWasteBlocksFromBoards(boards: Board[]): WasteBlock[] {
  return boards
    .filter((board) => String(board.source || "").toLowerCase() !== "recovery")
    .flatMap((board) => {
      const rows: WasteBlock[] = [];
      const partsLen = (board.parts || []).reduce((sum, part) => sum + (part.cut_length || part.Height || 0), 0);
      const kerfLen = Math.max(0, (board.parts?.length || 0) - 1) * (board.saw_kerf || SAW_KERF_MM);
      const lengthWaste = (board.usable_length || parseTotalLength(board.board_size)) - partsLen - kerfLen;
      if (lengthWaste > 0.5) {
        rows.push({
          id: `${board.board_id}-length`,
          source_board_id: board.board_id,
          kind: "length",
          color: board.color,
          width: targetWidthForBoard(board),
          length: lengthWaste,
        });
      }
      const stockWidth = board.t0_sheet_id ? 0 : sourceWidthForBoard(board, targetWidthForBoard(board));
      const widthWaste = stockWidth > 0 ? stockWidth - targetWidthForBoard(board) - (board.saw_kerf || SAW_KERF_MM) : 0;
      if (widthWaste > 0.5 && !board.rip_leftover_recovered) {
        rows.push({
          id: `${board.board_id}-width`,
          source_board_id: board.board_id,
          kind: "width",
          color: board.color,
          width: widthWaste,
          length: T0_RAW_LENGTH_MM,
        });
      }
      return rows;
    });
}

function buildWasteSummaryRows(cutResult: CutResult | null | undefined, boards: Board[], locale: LocaleKey): SummaryRow[] {
  const sourceBlocks = cutResult?.waste_blocks?.length ? cutResult.waste_blocks : directWasteBlocksFromBoards(boards);
  const categories = wasteCategories(locale);
  const counts = new Map(categories.map((category) => [category.key, 0]));
  for (const waste of sourceBlocks) {
    const category = wasteCategoryForWidth(waste.width, locale);
    if (!category) continue;
    counts.set(category.key, (counts.get(category.key) || 0) + 1);
  }
  return categories.map((category) => ({
    key: category.key,
    label: category.label,
    count: counts.get(category.key) || 0,
  }));
}

function buildRecoveredSummaryRows(cutResult: CutResult | null | undefined): SummaryRow[] {
  const rows = new Map<string, SummaryRow>();
  for (const item of cutResult?.recovered_inventory || []) {
    const width = Math.round((item.width || 0) * 10) / 10;
    if (Math.abs(width - 303.8) >= 0.5 && Math.abs(width - 608.6) >= 0.5) continue;
    const length = Math.round((item.length || T0_RAW_LENGTH_MM) * 10) / 10;
    const label = Math.abs(width - 303.8) < 0.5 ? '12" RCV' : '24" RCV';
    const size = `${fmt(width)} x ${fmt(length)}`;
    const key = `${label}-${size}`;
    const existing = rows.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      rows.set(key, { key, label, size, count: 1 });
    }
  }
  return Array.from(rows.values()).sort((a, b) => a.label.localeCompare(b.label) || (a.size || "").localeCompare(b.size || ""));
}

function buildCutSections(sectionBoards: Board[], mergeStandardPool = false): CutPlanSection[] {
  const sectionMap: Record<string, Board[]> = {};
  for (const board of sectionBoards) {
    if (String(board.source || "").toLowerCase() === "recovery") continue;
    const width = board.strip_width || 0;
    const color = board.color || DEFAULT_BOX_COLOR;
    const boardType = productionLengthBoardType(board, mergeStandardPool);
    const cutSource = boardCutSource(board);
    const key = `${cutSource}|||${color}|||${width}|||${boardType}|||${board.board_size}|||${board.trim_loss ?? 5}`;
    if (!sectionMap[key]) sectionMap[key] = [];
    sectionMap[key].push(board);
  }

  return Object.entries(sectionMap)
    .sort(([keyA, boardsA], [keyB, boardsB]) => {
      const partsA = keyA.split("|||");
      const partsB = keyB.split("|||");
      const sourceA = sourcePriority((partsA[0] as "T0" | "T1") || boardCutSource(boardsA[0]));
      const sourceB = sourcePriority((partsB[0] as "T0" | "T1") || boardCutSource(boardsB[0]));
      if (sourceA !== sourceB) return sourceA - sourceB;

      const typeA = partsA[3] || boardsA[0]?.board || "";
      const typeB = partsB[3] || boardsB[0]?.board || "";
      const isT1A = typeA.toUpperCase().includes("T1");
      const isT1B = typeB.toUpperCase().includes("T1");
      if (isT1A !== isT1B) return isT1A ? -1 : 1;
      const widthA = parseFloat(partsA[2]);
      const widthB = parseFloat(partsB[2]);
      if (Math.abs(widthB - widthA) > 0.01) return widthB - widthA;
      return keyA.localeCompare(keyB);
    })
    .map(([key, groupedBoards]) => {
      const keyParts = key.split("|||");
      const width = parseFloat(keyParts[2]);
      const sample = groupedBoards[0];
      const fingerprintMap: Record<string, Board[]> = {};

      for (const board of groupedBoards) {
        const fingerprint = boardFingerprint(board);
        if (!fingerprintMap[fingerprint]) fingerprintMap[fingerprint] = [];
        fingerprintMap[fingerprint].push(board);
      }

      const patterns = Object.values(fingerprintMap).flatMap((boardsOfPattern) => {
        const sampleBoard = boardsOfPattern[0];
        const cutMap: Record<number, number> = {};
        for (const part of sampleBoard.parts) {
          const cutLength = part.cut_length || part.Height;
          cutMap[cutLength] = (cutMap[cutLength] || 0) + 1;
        }
        const cutRows = Object.entries(cutMap)
          .map(([len, qty]) => ({ cutLength: parseFloat(len), pieces: qty }))
          .sort((a, b) => a.cutLength - b.cutLength);

        const chunks: CutPlanPattern[] = [];
        for (let i = 0; i < boardsOfPattern.length; i += 4) {
          chunks.push({
            sampleBoard,
            boardCount: boardsOfPattern.slice(i, i + 4).length,
            cutRows,
          });
        }
        return chunks;
      });

      return {
        sourcePriority: sourcePriority(boardCutSource(sample)),
        boardType: productionLengthBoardType(sample, mergeStandardPool),
        boardWidth: getRipWidth(sample) || width,
        totalLength: parseTotalLength(sample.board_size),
        trimSetting: Math.max(...groupedBoards.map((board) => board.trim_loss ?? 5)),
        patterns,
      };
    });
}

export function CutPlanTable({
  boards,
  orderLabel,
  cutResult,
}: {
  boards: Board[];
  orderLabel: string;
  cutResult?: CutResult | null;
}) {
  const printRef = useRef<HTMLDivElement | null>(null);
  const { locale } = useLanguage();
  const { getColor } = useBoxColors();
  const localeKey: LocaleKey = locale === "zh" || locale === "es" ? locale : "en";
  const lc = copy[localeKey] || copy.en;
  const mergeStandardPool = isStackEfficiencyResult(cutResult);
  const cabinetCount = useMemo(() => {
    const breakdownCount = Object.keys(cutResult?.cabinet_breakdown || {}).length;
    if (breakdownCount > 0) return breakdownCount;

    return new Set(
      boards
        .flatMap((board) => board.parts || [])
        .map((part) => part.cab_id)
        .filter((cabId) => cabId && cabId !== "?" && cabId !== "Unknown")
    ).size;
  }, [boards, cutResult?.cabinet_breakdown]);

  const t0Sheets = useMemo<CutPlanT0Sheet[]>(() => {
    const fromPlan = (cutResult?.t0_plan?.t0_sheets || [])
      .map((sheet) => sheet as CutPlanT0Sheet)
      .filter((sheet) => !!sheet.sheet_id);
    if (fromPlan.length > 0) return fromPlan;

    return Array.from(new Set(boards.map((board) => board.t0_sheet_id).filter(Boolean) as string[]))
      .map((sheet_id) => ({ sheet_id }));
  }, [boards, cutResult]);
  const rawSheetCount = useMemo(
    () => t0Sheets.reduce((n, sheet) => n + (sheet.t0_sheet_stack || 1), 0),
    [t0Sheets]
  );
  const stockTakeCounts = useMemo(() => countStockTakes(boards), [boards]);
  const finishedPartCount = useMemo(
    () => boards.reduce((acc, board) => acc + (board.parts?.length || 0), 0),
    [boards]
  );
  const recoveredPartCount = useMemo(
    () => countRecoveredParts(cutResult, t0Sheets),
    [cutResult, t0Sheets]
  );
  const trimSetting = cutResult?.summary?.config_trim_loss_mm ?? 2;

  const planBlocks = useMemo(() => {
    const rawBlocks: CutPlanBlock[] = [];
    const stockBlocks: CutPlanBlock[] = [];
    const globalTrim = cutResult?.summary?.config_trim_loss_mm ?? 5;

    t0Sheets.forEach((sheet, sheetIdx) => {
      const widthGroups = t0WidthGroupsForSheet(sheet, boards);
      if (widthGroups.length === 0) return;

      const steps: CutPlanStep[] = [{
        key: `raw-${sheetIdx}-width`,
        stepNo: 1,
        take: lc.rawSheets,
        stackQty: capStackQty(sheet.t0_sheet_stack || 1),
        stackUnit: lc.sheets,
        cutLabel: lc.widthCut,
        inputLabel: lc.cutWidth,
        rows: widthGroups.map((group) => ({
          key: `raw-${sheetIdx}-width-${group.rowNo}`,
          rowNo: group.rowNo,
          value: group.width,
          pieces: group.pieces,
          note: group.note,
        })),
      }];

      let stepNo = 2;
      widthGroups.forEach((widthGroup) => {
        if (widthGroup.boards.length === 0) return;

        const targetGroups = groupBoardsByTargetWidth(widthGroup.boards);
        const needsSecondWidthCut = targetGroups.some((targetGroup) =>
          Math.abs(targetGroup.width - widthGroup.width) > 0.5
        );

        const lengthSourceGroups = needsSecondWidthCut ? targetGroups : [{
          rowNo: widthGroup.rowNo,
          width: widthGroup.width,
          pieces: widthGroup.pieces,
          boards: widthGroup.boards,
        }];

          if (needsSecondWidthCut) {
          steps.push({
            key: `raw-${sheetIdx}-width-${widthGroup.rowNo}-second-width`,
            stepNo: stepNo++,
            take: `width-${fmt(widthGroup.width)}`,
            stackQty: capStackQty(widthCutStackQty(targetGroups)),
            stackUnit: lc.strips,
            cutLabel: lc.widthCut,
            inputLabel: lc.cutWidth,
            rows: [
              ...targetGroups.map((targetGroup) => ({
                key: `raw-${sheetIdx}-width-${widthGroup.rowNo}-target-${targetGroup.rowNo}`,
                rowNo: targetGroup.rowNo,
                value: targetGroup.width,
                pieces: targetGroup.pieces,
              })),
              ...aggregateLeftoverRows(targetGroups.map((targetGroup) => {
                const wasteWidth = widthGroup.width - targetGroup.width - SAW_KERF_MM;
                return {
                  key: `raw-${sheetIdx}-width-${widthGroup.rowNo}-target-${targetGroup.rowNo}-leftover`,
                  value: wasteWidth,
                  pieces: 1,
                  note: residualNote(wasteWidth, localeKey),
                };
              }), localeKey),
            ],
          });
        }

        lengthSourceGroups.forEach((targetGroup) => {
          buildCutSections(targetGroup.boards, mergeStandardPool).forEach((section, sectionIdx) => {
            section.patterns.forEach((pattern, patternIdx) => {
              steps.push({
                key: `raw-${sheetIdx}-length-${widthGroup.rowNo}-${targetGroup.rowNo}-${sectionIdx}-${patternIdx}`,
                stepNo: stepNo++,
                take: `width-${fmt(targetGroup.width)}`,
                stackQty: capStackQty(pattern.boardCount),
                stackUnit: lc.strips,
                cutLabel: lc.lengthCut,
                inputLabel: lc.cutLength,
                rows: rowsForCutLengths(pattern, `raw-${sheetIdx}-length-${widthGroup.rowNo}-${targetGroup.rowNo}-${sectionIdx}-${patternIdx}`, targetGroup.width, localeKey),
              });
            });
          });
        });
      });

      const sheetTrim = typeof sheet.trim_loss === "number" ? sheet.trim_loss : globalTrim;
      rawBlocks.push({
        key: `raw-${sheet.sheet_id}-${sheetIdx}`,
        take: lc.rawSheets,
        stackQty: capStackQty(sheet.t0_sheet_stack || 1),
        stackUnit: lc.sheets,
        trim: sheetTrim,
        steps,
      });
    });

    const stockItems: Array<{
      key: string;
      take: string;
      stackQty: number;
      trim: number;
      targetWidth: number;
      needsWidthRip: boolean;
      pattern: CutPlanPattern;
      sectionIdx: number;
      patternIdx: number;
    }> = [];

    const stockBoards = boards.filter((board) => String(board.source || "").toLowerCase() !== "recovery" && boardCutSource(board) === "T1");
    buildCutSections(stockBoards, mergeStandardPool).forEach((section, sectionIdx) => {
      section.patterns.forEach((pattern, patternIdx) => {
        const targetWidth = section.boardWidth;
        const take = sourceTakeLabelWithWidth(pattern.sampleBoard, targetWidth);
        stockItems.push({
          key: `stock-${sectionIdx}-${patternIdx}`,
          take,
          stackQty: capStackQty(pattern.boardCount),
          trim: section.trimSetting,
          targetWidth,
          needsWidthRip: boardNeedsWidthRip(pattern.sampleBoard, targetWidth) || !!pattern.sampleBoard.stretcher_phase,
          pattern,
          sectionIdx,
          patternIdx,
        });
      });
    });

    const stockMap = new Map<string, typeof stockItems>();
    stockItems.forEach((item) => {
      const widthKey = item.needsWidthRip ? numericKey(item.targetWidth) : "no-width-rip";
      const key = `${item.take}|||${item.stackQty}|||${numericKey(item.trim)}|||${item.needsWidthRip ? "width" : "length"}|||${widthKey}`;
      const items = stockMap.get(key) || [];
      items.push(item);
      stockMap.set(key, items);
    });

    Array.from(stockMap.entries()).forEach(([key, items], blockIdx) => {
      const first = items[0];
      const steps: CutPlanStep[] = [];
      let stepNo = 1;

      if (first.needsWidthRip) {
        steps.push({
          key: `${key}-width`,
          stepNo: stepNo++,
          take: first.take,
          stackQty: capStackQty(first.stackQty),
          stackUnit: lc.strips,
          cutLabel: lc.widthCut,
          inputLabel: lc.cutWidth,
          rows: [
            {
              key: `${key}-width`,
              rowNo: 1,
              value: first.targetWidth,
              pieces: Math.max(...items.map((item) => widthPiecesForBoards([item.pattern.sampleBoard]))),
            },
            ...aggregateLeftoverRows([{
              key: `${key}-width-leftover`,
              value: sourceWidthWasteSize(first.pattern.sampleBoard, first.targetWidth),
              pieces: 1,
              note: sourceWidthWasteNote(first.pattern.sampleBoard, first.targetWidth, localeKey),
            }], localeKey),
          ],
        });
      }

      items.forEach((item) => {
        steps.push({
          key: `${item.key}-length`,
          stepNo: stepNo++,
          take: first.needsWidthRip ? `width-${fmt(item.targetWidth)}` : first.take,
          stackQty: capStackQty(item.stackQty),
          stackUnit: lc.strips,
          cutLabel: lc.lengthCut,
          inputLabel: lc.cutLength,
          rows: rowsForCutLengths(item.pattern, `${item.key}-${item.sectionIdx}-${item.patternIdx}`, item.targetWidth, localeKey),
        });
      });

      stockBlocks.push({
        key: `stock-block-${blockIdx}-${key}`,
        take: first.take,
        stackQty: capStackQty(first.stackQty),
        stackUnit: lc.strips,
        trim: first.trim,
        steps,
      });
    });

    rawBlocks.sort((a, b) => {
      const maxStackDelta = maxStepStack(b) - maxStepStack(a);
      if (maxStackDelta !== 0) return maxStackDelta;
      if (a.stackQty !== b.stackQty) return b.stackQty - a.stackQty;
      return a.key.localeCompare(b.key);
    });

    stockBlocks.sort((a, b) => {
      const priorityDelta = stockBlockPriority(a) - stockBlockPriority(b);
      if (priorityDelta !== 0) return priorityDelta;
      const maxStackDelta = maxStepStack(b) - maxStepStack(a);
      if (maxStackDelta !== 0) return maxStackDelta;
      if (a.stackQty !== b.stackQty) return b.stackQty - a.stackQty;
      if (a.trim !== b.trim) return a.trim - b.trim;
      return a.key.localeCompare(b.key);
    });

    return { rawBlocks, stockBlocks };
	  }, [boards, cutResult?.summary?.config_trim_loss_mm, lc.cutLength, lc.cutWidth, lc.lengthCut, lc.rawSheets, lc.sheets, lc.strips, lc.widthCut, localeKey, mergeStandardPool, t0Sheets]);

  const recoveryBlocks = useMemo(
    () => buildRecoveryBlocks(cutResult?.recovery_cutting_boards || [], localeKey),
    [cutResult?.recovery_cutting_boards, localeKey]
  );
  const wasteSummaryRows = useMemo(
    () => buildWasteSummaryRows(cutResult, boards, localeKey),
    [boards, cutResult, localeKey]
  );
  const recoveredSummaryRows = useMemo(
    () => buildRecoveredSummaryRows(cutResult),
    [cutResult]
  );

  const selectedColor = boards[0]?.color || DEFAULT_BOX_COLOR;

  const handlePrint = () => {
    if (!printRef.current) return;
    const pw = window.open("", "_blank", "width=1100,height=800");
    if (!pw) {
      alert("Popup blocked — please allow popups for printing.");
      return;
    }

    const clone = printRef.current.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".cut-plan-no-print").forEach((el) => el.remove());

    const styleSheets = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((el) => el.cloneNode(true) as HTMLElement);

    pw.document.open();
    pw.document.write(`<!DOCTYPE html><html lang="${locale === "zh" ? "zh-CN" : locale}"><head><meta charset="utf-8"><title>${lc.title} — ${orderLabel}</title></head><body></body></html>`);
    pw.document.close();

    for (const sheet of styleSheets) pw.document.head.appendChild(sheet);

    const printStyle = pw.document.createElement("style");
    printStyle.textContent = `
      :root {
        --color-background: #f5f5f7;
        --color-foreground: #1d1d1f;
        --color-card: #ffffff;
        --color-border: #e5e5ea;
        --color-apple-blue: #0071e3;
        --color-apple-gray: #86868b;
        --font-sans: ${PRINT_FONT_STACK};
        --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      html, body {
        margin: 0;
        padding: 0;
        background: white;
        color: var(--color-foreground);
        font-family: var(--font-sans);
        text-rendering: geometricPrecision;
      }
      body, div, span, p, table, thead, tbody, tr, th, td, h1, h2, h3, strong {
        font-family: var(--font-sans);
      }
      .print-container {
        padding: 8mm 10mm;
        box-sizing: border-box;
      }
	      .cut-plan-print-root {
	        box-shadow: none !important;
	        border: 0 !important;
	        font-size: 17px !important;
	      }
	      .cut-plan-print-root table {
	        width: 100% !important;
	        max-width: 100% !important;
	        border-collapse: collapse !important;
	        font-size: 17px !important;
	        table-layout: auto !important;
	      }
	      .cut-plan-print-root th,
	      .cut-plan-print-root td {
	        border: 1px solid #d1d5db !important;
	        padding: 7px 8px !important;
	        vertical-align: middle !important;
	      }
	      .cut-plan-print-root th {
	        font-size: 16px !important;
	      }
	      .cut-plan-print-root td {
	        font-size: 18px !important;
	      }
      .cut-plan-print-root thead tr {
        background: #f3f4f6 !important;
      }
      .cut-plan-print-root tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .cut-plan-section h3 {
        break-after: avoid;
        page-break-after: avoid;
      }
	      .cut-plan-section + .cut-plan-section {
	        break-before: page;
	        page-break-before: always;
	      }
	      .cut-plan-batch {
	        break-inside: avoid;
	        page-break-inside: avoid;
	      }
	      .cut-plan-gap-row td {
	        height: 16px !important;
	        padding: 0 !important;
	        background: #e5e7eb !important;
	        border-top: 0 !important;
	        border-bottom: 0 !important;
	        border-left: 0 !important;
	        border-right: 0 !important;
	      }
      * {
        transition: none !important;
        animation: none !important;
        box-shadow: none !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      @media print {
        @page { size: A4 portrait; margin: 10mm 12mm; }
        html, body {
          overflow: visible !important;
        }
        .print-container { padding: 0; }
      }
    `;
    pw.document.head.appendChild(printStyle);

    const pageContainer = pw.document.createElement("div");
    pageContainer.className = "print-container";
    pageContainer.appendChild(clone);
    pw.document.body.appendChild(pageContainer);

    setTimeout(() => {
      try { pw.print(); } catch {}
    }, 1000);
  };

  if (boards.length === 0) {
    return (
      <div className="bg-card rounded-xl shadow-apple border border-border/30 p-12 text-center text-apple-gray text-[15px]">
        {lc.empty}
      </div>
    );
  }

  const renderBlocks = (blocks: CutPlanBlock[]) => (
    <div className="overflow-x-auto">
      <table className="w-full table-auto text-[12px]">
        <colgroup>
          <col style={{ width: "20%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead>
          <tr className="bg-black/[0.03] border-b border-border/40">
            <th className="text-left py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.take}</th>
            <th className="text-center py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.stack}</th>
            <th className="text-center py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.step}</th>
            <th className="text-center py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.row}</th>
            <th className="text-center py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.cut}</th>
	            <th className="text-right py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.size} (mm)</th>
	            <th className="text-center py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.pieces}</th>
	            <th className="text-left py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.noteHeader}</th>
          </tr>
	        </thead>
	        <tbody>
	          {blocks.map((block, blockIdx) => (
	            <React.Fragment key={block.key}>
	              {blockIdx > 0 && (
	                <tr className="cut-plan-gap-row"><td colSpan={8} /></tr>
	              )}
	              {block.steps.flatMap((step) =>
	                step.rows.map((row, rowIdx) => (
	                  <tr key={`${block.key}-${step.key}-${row.key}`} className="border-b border-border/20 hover:bg-black/[0.01]">
	                    {rowIdx === 0 && (
	                      <>
	                        <td rowSpan={step.rows.length} className="py-2 px-1.5 align-top whitespace-nowrap border-r border-border/20">{step.take}</td>
	                        <td rowSpan={step.rows.length} className="py-2 px-1.5 align-top text-center whitespace-nowrap border-r border-border/20">
	                          {step.stackQty > 1 ? (
	                            <span className="font-bold text-apple-red">x{step.stackQty}</span>
	                          ) : (
	                            <span className="text-slate-900">1</span>
	                          )}
	                        </td>
	                        <td rowSpan={step.rows.length} className="py-2 px-1.5 align-top text-center text-apple-gray border-r border-border/20">{step.stepNo}</td>
	                      </>
	                    )}
	                    <td className="py-2 px-1.5 text-center text-apple-gray">{row.rowNo}</td>
	                    <td className={`py-2 px-1.5 align-top text-center border-r border-border/20 ${rowIdx === 0 && step.cutLabel === lc.widthCut ? "font-bold" : "font-normal"}`}>
	                      {rowIdx === 0 && !row.isLeftover ? step.cutLabel : ""}
	                    </td>
	                    <td className={`py-2 px-1.5 text-right font-mono ${row.isLeftover ? "text-slate-500" : ""}`}>{row.sizeLabel || fmt(row.value)}</td>
	                    <td className="py-2 px-1.5 text-center">{row.pieces}</td>
	                    <td className="py-2 px-1.5 text-left">
	                      {row.note && (
	                        <span className={`font-semibold ${row.note === "RCV" ? "text-apple-green" : row.note === wasteText(localeKey) ? "text-slate-700" : "text-amber-700"}`}>
	                          {row.note === "RCV" ? lc.recover : row.note}
	                        </span>
	                      )}
	                    </td>
	                  </tr>
	                ))
	              )}
	            </React.Fragment>
	          ))}
	        </tbody>
      </table>
    </div>
  );

  const renderSummaryRows = (rows: SummaryRow[], columns: "waste" | "recovered") => (
    <div className="overflow-x-auto">
      <table className="w-full table-auto text-[12px]">
        <thead>
          <tr className="bg-black/[0.03] border-b border-border/40">
            <th className="text-left py-2 px-3 font-semibold text-apple-gray whitespace-nowrap">
              {columns === "waste" ? lc.summaryArea : lc.summaryType}
            </th>
            {columns === "recovered" && (
              <th className="text-left py-2 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.size} (mm)</th>
            )}
            <th className="text-right py-2 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.summaryQty}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/20 last:border-0">
              <td className="py-2 px-3 font-medium text-slate-800">{row.label}</td>
              {columns === "recovered" && (
                <td className="py-2 px-3 font-mono text-slate-700">{row.size || "-"}</td>
              )}
              <td className="py-2 px-3 text-right font-mono font-semibold text-slate-900">{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div ref={printRef} className="cut-plan-print-root bg-card rounded-xl shadow-apple border border-border/30 overflow-hidden">
      <div className="p-4 border-b border-border/50 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[22px] font-bold text-foreground leading-tight">{lc.orderNo}: {orderLabel}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-apple-gray">
            <span className="inline-flex items-center gap-1.5">
              {lc.color}:
              <span className="w-2.5 h-2.5 rounded-full border border-black/10" style={{ backgroundColor: getColor(selectedColor).hex_color }} />
              <strong className="text-foreground font-semibold">{colorLabel(getColor(selectedColor), locale)}</strong>
            </span>
          </div>
        </div>

        <button
          onClick={handlePrint}
          className="cut-plan-no-print inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-foreground text-white text-[13px] font-semibold hover:bg-foreground/90 transition-colors shadow-sm self-start lg:self-auto"
        >
          <Printer size={14} /> {lc.print}
        </button>
      </div>

      <div className="px-4 py-3 border-b border-border/40 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] leading-none">
        <div className="inline-flex h-5 items-center gap-2">
          <span className="text-apple-gray font-medium leading-none">{lc.cabinets}</span>
          <span className="font-bold text-foreground leading-none">{cabinetCount}</span>
        </div>
        <div className="inline-flex h-5 items-center gap-2">
          <span className="text-apple-gray font-medium leading-none">48&quot; × 96&quot;</span>
          <span className="font-bold text-foreground leading-none">{rawSheetCount}</span>
        </div>
        <div className="inline-flex h-5 items-center gap-2">
          <span className="text-apple-gray font-medium leading-none">12&quot;</span>
          <span className="font-bold text-foreground leading-none">{stockTakeCounts.twelve}</span>
        </div>
        <div className="inline-flex h-5 items-center gap-2">
          <span className="text-apple-gray font-medium leading-none">24&quot;</span>
          <span className="font-bold text-foreground leading-none">{stockTakeCounts.twentyFour}</span>
        </div>
        <div className="inline-flex h-5 items-center gap-2">
          <span className="text-apple-gray font-medium leading-none">{lc.finishedParts}</span>
          <span className="font-bold text-foreground leading-none">{finishedPartCount}</span>
        </div>
        <div className="inline-flex h-5 items-center gap-2">
          <span className="text-apple-gray font-medium leading-none">{lc.recoveredParts}</span>
          <span className="font-bold text-foreground leading-none">{recoveredPartCount}</span>
        </div>
        <div className="inline-flex h-5 items-center gap-2">
          <span className="text-apple-gray font-medium leading-none">{lc.trimLabel}</span>
          <span className="font-bold text-apple-red leading-none">{fmt(trimSetting)}</span>
        </div>
      </div>

      <div className="divide-y divide-border/40">
        {planBlocks.stockBlocks.length > 0 && (
          <section className="cut-plan-section">
            <div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100">
              <h3 className="text-[16px] font-bold text-slate-900">{lc.t1SectionTitle}</h3>
            </div>
            {renderBlocks(planBlocks.stockBlocks)}
          </section>
        )}

        {planBlocks.rawBlocks.length > 0 && (
          <section className="cut-plan-section cut-plan-section-t0">
            <div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100">
              <h3 className="text-[16px] font-bold text-slate-900">{lc.t0SectionTitle}</h3>
            </div>
            {renderBlocks(planBlocks.rawBlocks)}
          </section>
        )}

        {recoveryBlocks.length > 0 && (
          <section className="cut-plan-section">
            <div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100">
              <h3 className="text-[16px] font-bold text-slate-900">{lc.recoverySectionTitle}</h3>
            </div>
            {renderBlocks(recoveryBlocks)}
          </section>
        )}

        <section className="cut-plan-section">
          <div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100">
            <h3 className="text-[16px] font-bold text-slate-900">{lc.wasteSectionTitle}</h3>
          </div>
          {renderSummaryRows(wasteSummaryRows, "waste")}
        </section>

        {recoveredSummaryRows.length > 0 && (
          <section className="cut-plan-section">
            <div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100">
              <h3 className="text-[16px] font-bold text-slate-900">{lc.recoveredSectionTitle}</h3>
            </div>
            {renderSummaryRows(recoveredSummaryRows, "recovered")}
          </section>
        )}
      </div>
    </div>
  );
}
