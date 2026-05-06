"use client";

import React, { useMemo, useRef } from "react";
import { Printer } from "lucide-react";
import type { Board, CutResult } from "./types";
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
  cutRows: { cutLength: number; pieces: number }[];
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
  rowNo: number;
  value: number;
  pieces: number;
  note?: "recover";
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
	    t0SectionTitle: 'Take 48" x 96"',
	    t1SectionTitle: 'Take 24" / 12"',
	    ripWidth: "Cut Width",
	    cutWidth: "Cut Width",
	    widthCut: "Width",
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
	    t0SectionTitle: '拿 48" x 96"',
	    t1SectionTitle: '拿 24" / 12"',
	    ripWidth: "裁切宽度",
	    cutWidth: "裁切宽度",
	    widthCut: "Width",
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
	    t0SectionTitle: 'Tomar 48" x 96"',
	    t1SectionTitle: 'Tomar 24" / 12"',
	    ripWidth: "Cortar Ancho",
	    cutWidth: "Cortar Ancho",
	    widthCut: "Width",
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
      });
    });

  return Array.from(groupMap.values())
    .sort((a, b) => a.order - b.order)
    .map((group, index) => ({ rowNo: index + 1, width: group.width, pieces: group.pieces, boards: uniqueBoards(group.boards) }));
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

function rowsForCutLengths(pattern: CutPlanPattern, keyPrefix: string): CutPlanInputRow[] {
  return pattern.cutRows.map((cutRow, index) => ({
    key: `${keyPrefix}-${index}`,
    rowNo: index + 1,
    value: cutRow.cutLength,
    pieces: cutRow.pieces,
  }));
}

function stockBlockPriority(block: CutPlanBlock): number {
  const isStacked = block.stackQty > 1;
  const is24 = block.take === '24"';
  const is12 = block.take === '12"';
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

function countStockTakes(boards: Board[]): { twelve: number; twentyFour: number } {
  const twelve = new Set<string>();
  const twentyFour = new Set<string>();
  for (const board of boards) {
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

function buildCutSections(sectionBoards: Board[], mergeStandardPool = false): CutPlanSection[] {
  const sectionMap: Record<string, Board[]> = {};
  for (const board of sectionBoards) {
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
  const lc = copy[(locale as LocaleKey) || "en"] || copy.en;
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
        stackQty: sheet.t0_sheet_stack || 1,
        stackUnit: lc.sheets,
        cutLabel: lc.widthCut,
        inputLabel: lc.cutWidth,
        rows: widthGroups.map((group) => ({
          key: `raw-${sheetIdx}-width-${group.rowNo}`,
          rowNo: group.rowNo,
          value: group.width,
          pieces: group.pieces,
          note: group.boards.length === 0 ? "recover" : undefined,
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
            stackQty: widthCutStackQty(targetGroups),
            stackUnit: lc.strips,
            cutLabel: lc.widthCut,
            inputLabel: lc.cutWidth,
            rows: targetGroups.map((targetGroup) => ({
              key: `raw-${sheetIdx}-width-${widthGroup.rowNo}-target-${targetGroup.rowNo}`,
              rowNo: targetGroup.rowNo,
              value: targetGroup.width,
              pieces: targetGroup.pieces,
            })),
          });
        }

        lengthSourceGroups.forEach((targetGroup) => {
          buildCutSections(targetGroup.boards, mergeStandardPool).forEach((section, sectionIdx) => {
            section.patterns.forEach((pattern, patternIdx) => {
              steps.push({
                key: `raw-${sheetIdx}-length-${widthGroup.rowNo}-${targetGroup.rowNo}-${sectionIdx}-${patternIdx}`,
                stepNo: stepNo++,
                take: `width-${fmt(targetGroup.width)}`,
                stackQty: pattern.boardCount,
                stackUnit: lc.strips,
                cutLabel: lc.lengthCut,
                inputLabel: lc.cutLength,
                rows: rowsForCutLengths(pattern, `raw-${sheetIdx}-length-${widthGroup.rowNo}-${targetGroup.rowNo}-${sectionIdx}-${patternIdx}`),
              });
            });
          });
        });
      });

      const sheetTrim = typeof sheet.trim_loss === "number" ? sheet.trim_loss : globalTrim;
      rawBlocks.push({
        key: `raw-${sheet.sheet_id}-${sheetIdx}`,
        take: lc.rawSheets,
        stackQty: sheet.t0_sheet_stack || 1,
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

    const stockBoards = boards.filter((board) => boardCutSource(board) === "T1");
    buildCutSections(stockBoards, mergeStandardPool).forEach((section, sectionIdx) => {
      section.patterns.forEach((pattern, patternIdx) => {
        const targetWidth = section.boardWidth;
        const take = sourceTakeLabel(pattern.sampleBoard, targetWidth);
        stockItems.push({
          key: `stock-${sectionIdx}-${patternIdx}`,
          take,
          stackQty: pattern.boardCount,
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
      const key = `${item.take}|||${item.stackQty}|||${numericKey(item.trim)}|||${item.needsWidthRip ? "width" : "length"}`;
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
          stackQty: first.stackQty,
          stackUnit: lc.strips,
          cutLabel: lc.widthCut,
          inputLabel: lc.cutWidth,
          rows: items.map((item, index) => ({
            key: `${item.key}-width`,
            rowNo: index + 1,
            value: item.targetWidth,
            pieces: widthPiecesForBoards([item.pattern.sampleBoard]),
          })),
        });
      }

      items.forEach((item) => {
        steps.push({
          key: `${item.key}-length`,
          stepNo: stepNo++,
          take: first.needsWidthRip ? `width-${fmt(item.targetWidth)}` : first.take,
          stackQty: item.stackQty,
          stackUnit: lc.strips,
          cutLabel: lc.lengthCut,
          inputLabel: lc.cutLength,
          rows: rowsForCutLengths(item.pattern, `${item.key}-${item.sectionIdx}-${item.patternIdx}`),
        });
      });

      stockBlocks.push({
        key: `stock-block-${blockIdx}-${key}`,
        take: first.take,
        stackQty: first.stackQty,
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
  }, [boards, cutResult?.summary?.config_trim_loss_mm, lc.cutLength, lc.cutWidth, lc.lengthCut, lc.rawSheets, lc.sheets, lc.strips, lc.widthCut, mergeStandardPool, t0Sheets]);

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
      .cut-plan-batch-start td {
        border-top: 5px solid #e5e7eb !important;
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
            <th className="text-left py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">Note</th>
          </tr>
        </thead>
        <tbody>
          {blocks.flatMap((block) => block.steps.flatMap((step, stepIdx) =>
            step.rows.map((row, rowIdx) => (
              <tr
                key={`${block.key}-${step.key}-${row.key}`}
                className={`border-b border-border/20 hover:bg-black/[0.01] ${stepIdx === 0 && rowIdx === 0 ? "cut-plan-batch-start" : ""}`}
              >
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
                {rowIdx === 0 && (
                  <td rowSpan={step.rows.length} className={`py-2 px-1.5 align-top text-center border-r border-border/20 ${step.cutLabel === lc.widthCut ? "font-bold" : "font-normal"}`}>{step.cutLabel}</td>
                )}
                <td className="py-2 px-1.5 text-right font-mono">{fmt(row.value)}</td>
                <td className="py-2 px-1.5 text-center">{row.pieces}</td>
                <td className="py-2 px-1.5 text-left">
                  {row.note === "recover" && (
                    <span className="font-bold text-apple-green">{lc.recover}</span>
                  )}
                </td>
              </tr>
            ))
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
        {planBlocks.rawBlocks.length > 0 && (
          <section className="cut-plan-section cut-plan-section-t0">
            <div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100">
              <h3 className="text-[16px] font-bold text-slate-900">{lc.t0SectionTitle}</h3>
            </div>
            {renderBlocks(planBlocks.rawBlocks)}
          </section>
        )}

        {planBlocks.stockBlocks.length > 0 && (
          <section className="cut-plan-section">
            <div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100">
              <h3 className="text-[16px] font-bold text-slate-900">{lc.t1SectionTitle}</h3>
            </div>
            {renderBlocks(planBlocks.stockBlocks)}
          </section>
        )}
      </div>
    </div>
  );
}
