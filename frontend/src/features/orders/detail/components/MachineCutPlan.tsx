"use client";
import React, { useCallback, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import type { Board, EngineeringGroup, CutResult, IntegrityIssue } from "./types";
import { colorLabel, DEFAULT_BOX_COLOR, useBoxColors } from "@/lib/box_colors";
import { useLanguage } from "@/lib/i18n";
import { SIZE_COLORS } from "./constants";
import { boardFingerprint, getRipWidth, nominalStockWidthForBoard, parseBoardDims } from "./utils";
import { BoardTile } from "./BoardTile";
import { T0SheetCard } from "./T0SheetCard";
import { MachineCutErrorBoundary } from "./MachineCutErrorBoundary";
import { machineI18n, type MachineLanguage } from "./machineCutPlanCopy";
import { boardCutSource, comparePatternPriority, formatCutNote, indexToNumberStr, maxPatternStack, parseT0SheetDims, sourcePriority, type MachineCutSection, type MachinePattern, type MachineT0RipBatch, type MachineT0Sheet } from "./machineCutPlanModel";
import { openMachineCutPrintWindow } from "./machineCutPlanPrint";

export function MachineCutPlan({ boards, orderLabel, machineLang, setMachineLang, patternNumbering, cutResult }: { boards: Board[], orderLabel: string, machineLang: MachineLanguage, setMachineLang: (l: MachineLanguage) => void, patternNumbering: { byIndex: Record<number, number>; byFingerprint: Record<string, number>; total: number }, cutResult?: CutResult | null }) {
  const { locale } = useLanguage();
  const { getColor } = useBoxColors();
  const sizeColorMap = useMemo(() => {
    const map: Record<string, typeof SIZE_COLORS[0]> = {};
    const uniqueSizes = Array.from(new Set(boards.map((b) => b.board_size)));
    uniqueSizes.forEach((size, idx) => {
      map[size] = SIZE_COLORS[idx % SIZE_COLORS.length];
    });
    return map;
  }, [boards]);
  const mt = useCallback(
    (key: string) => machineI18n[machineLang]?.[key] || machineI18n.en[key] || key,
    [machineLang]
  );
  const t0Sheets = useMemo<MachineT0Sheet[]>(() => {
    // Accept any sheet that has a sheet_id — avoid filtering on `strips` array
    // which the CutResult index signature types as `unknown`.
    return (cutResult?.t0_plan?.t0_sheets || [])
      .map((sheet) => sheet as MachineT0Sheet)
      .filter((sheet) => !!sheet.sheet_id);
  }, [cutResult]);
  const t0SheetById = useMemo(() => {
    const map: Record<string, MachineT0Sheet> = {};
    for (const sheet of t0Sheets) map[sheet.sheet_id] = sheet;
    return map;
  }, [t0Sheets]);
  const t0BoardStripsBySheetId = useMemo(() => {
    const map: Record<string, { board: Board; index: number }[]> = {};
    boards.forEach((board, index) => {
      if (!board.t0_sheet_id) return;
      if (!map[board.t0_sheet_id]) map[board.t0_sheet_id] = [];
      map[board.t0_sheet_id].push({ board, index });
    });
    for (const strips of Object.values(map)) {
      strips.sort((a, b) => (a.board.t0_strip_position || 0) - (b.board.t0_strip_position || 0));
    }
    return map;
  }, [boards]);

  const buildT0RipBatches = (sheets: MachineT0Sheet[]): MachineT0RipBatch[] => {
    const ripMap = new Map<string, MachineT0RipBatch & { order: number }>();
    sheets.forEach((sheet, sheetIdx) => {
      const dims = parseT0SheetDims(sheet.sheet_id);
      const sheetStrips = t0BoardStripsBySheetId[sheet.sheet_id] || [];
      const rows = [
        ...sheetStrips.filter(({ board }) => !board.t0_source_strip_secondary).map(({ board }, stripIdx) => ({
          key: board.board_id || `strip-${stripIdx}`,
          width: board.t0_source_strip_width || getRipWidth(board) || board.actual_strip_width || 0,
          pieces: 1,
        })),
        ...(sheet.recovered_strips || [])
          .filter((r) => typeof r.width === "number")
          .map((r, rIdx) => ({
            key: `recovered-${rIdx}`,
            width: r.width as number,
            pieces: 1,
          })),
      ];

      rows.forEach((row, rowIdx) => {
        const key = [
          rowIdx,
          dims.length.toFixed(3),
          dims.width.toFixed(3),
          row.width.toFixed(3),
          row.pieces,
        ].join("|||");
        const existing = ripMap.get(key);
        if (existing) {
          existing.sheetIds.push(sheet.sheet_id);
        } else {
          ripMap.set(key, {
            key,
            order: sheetIdx,
            rowOrder: rowIdx,
            sheetIds: [sheet.sheet_id],
            totalLength: dims.length,
            width: dims.width,
            trim: 5,
            ripWidth: row.width,
            pieces: row.pieces,
          });
        }
      });
    });

    const batches: MachineT0RipBatch[] = [];
    Array.from(ripMap.values())
      .sort((a, b) => a.rowOrder - b.rowOrder || a.order - b.order)
      .forEach((rip, ripIdx) => {
        for (let start = 0; start < rip.sheetIds.length; start += 4) {
          batches.push({
            key: `${rip.key}-${ripIdx}-${start}`,
            rowOrder: rip.rowOrder,
            sheetIds: rip.sheetIds.slice(start, start + 4),
            totalLength: rip.totalLength,
            width: rip.width,
            trim: rip.trim,
            ripWidth: rip.ripWidth,
            pieces: rip.pieces,
          });
        }
      });
    return batches.sort((a, b) => {
      if (a.sheetIds.length !== b.sheetIds.length) return b.sheetIds.length - a.sheetIds.length;
      return a.rowOrder - b.rowOrder;
    });
  };

  const parseTotalLength = (bs: string): number => {
    const m = bs.match(/([\d.]+)\s*[×x*]\s*([\d.]+)/i);
    if (m) {
      const len = parseFloat(m[2]);
      return len === 2438 ? 2438.4 : len;
    }
    console.warn("[MachineCutPlan] board_size unparsable, falling back to 2438.4", bs);
    return 2438.4;
  };

  const useStandardLengthPool = (cutResult?.cut_algorithm || cutResult?.summary?.cut_algorithm) === "stack_efficiency";

  const productionLengthBoardType = useCallback((board: Board) => {
    if (!useStandardLengthPool) return board.board;
    const width = Math.round((getRipWidth(board) || board.strip_width || 0) * 10) / 10;
    if (width === 608.6) return "T1-608.6x2438.4";
    if (width === 303.8) return "T1-303.8x2438.4";
    return board.board;
  }, [useStandardLengthPool]);

  const buildMachinePatterns = (groupedBoards: Board[], width: number): MachinePattern[] => {
    if (useStandardLengthPool && groupedBoards.length > 1) {
      const lengthStats = new Map<number, { stackOf: number; pieces: number }>();
      for (const board of groupedBoards) {
        const perBoard = new Map<number, number>();
        for (const part of board.parts) {
          const cutLength = part.cut_length || part.Height;
          perBoard.set(cutLength, (perBoard.get(cutLength) || 0) + 1);
        }
        for (const [cutLength, qty] of perBoard) {
          const current = lengthStats.get(cutLength) || { stackOf: 0, pieces: 0 };
          current.stackOf += 1;
          current.pieces = Math.max(current.pieces, qty);
          lengthStats.set(cutLength, current);
        }
      }
      const cutRows = Array.from(lengthStats.entries())
        .map(([cutLength, stat]) => ({ cutLength, pieces: stat.pieces, stackOf: stat.stackOf }))
        .sort((a, b) => b.stackOf - a.stackOf || a.cutLength - b.cutLength);
      const boardCount = Math.max(1, ...cutRows.map((row) => row.stackOf || 1));
      return [{ sampleBoard: groupedBoards[0], boardCount, cutRows }];
    }

    const fpMap: Record<string, Board[]> = {};
    for (const board of groupedBoards) {
      const fp = boardFingerprint(board);
      if (!fpMap[fp]) fpMap[fp] = [];
      fpMap[fp].push(board);
    }
    return Object.values(fpMap).flatMap((boardsOfPattern) => {
      const sampleBoard = boardsOfPattern[0];
      const cutMap: Record<number, number> = {};
      for (const part of sampleBoard.parts) {
        const cutLength = part.cut_length || part.Height;
        cutMap[cutLength] = (cutMap[cutLength] || 0) + 1;
      }
      const cutRows = Object.entries(cutMap)
        .map(([len, qty]) => ({ cutLength: parseFloat(len), pieces: qty }))
        .sort((a, b) => a.cutLength - b.cutLength);
      const chunks: MachinePattern[] = [];
      for (let i = 0; i < boardsOfPattern.length; i += 4) {
        chunks.push({
          sampleBoard,
          boardCount: boardsOfPattern.slice(i, i + 4).length,
          cutRows,
        });
      }
      return chunks;
    }).sort((a, b) => comparePatternPriority(
      { pattern: a, boardWidth: getRipWidth(a.sampleBoard) || width, sourcePriority: sourcePriority(boardCutSource(a.sampleBoard)) },
      { pattern: b, boardWidth: getRipWidth(b.sampleBoard) || width, sourcePriority: sourcePriority(boardCutSource(b.sampleBoard)) }
    ));
  };

  const buildCutSections = (sectionBoards: Board[]): MachineCutSection[] => {
    const sectionMap: Record<string, Board[]> = {};
    for (const b of sectionBoards) {
      const w = b.strip_width || 0;
      const color = b.color || DEFAULT_BOX_COLOR;
      const boardType = productionLengthBoardType(b);
      const cutSource = boardCutSource(b);
      const key = `${cutSource}|||${color}|||${w}|||${boardType}|||${b.board_size}|||${b.trim_loss ?? 5}`;
      if (!sectionMap[key]) sectionMap[key] = [];
      sectionMap[key].push(b);
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
        const wA = parseFloat(partsA[2]);
        const wB = parseFloat(partsB[2]);
        if (Math.abs(wB - wA) > 0.01) return wB - wA;
        return keyA.localeCompare(keyB);
      })
      .map(([key, groupedBoards]) => {
        const keyParts = key.split("|||");
        const color = keyParts[1] || DEFAULT_BOX_COLOR;
        const width = parseFloat(keyParts[2]);
        const sample = groupedBoards[0];
        const boardType = productionLengthBoardType(sample);
        const patterns = buildMachinePatterns(groupedBoards, width);

        let ripStockWidthMm: number | null = null;
        for (const b of groupedBoards) {
          const nw = nominalStockWidthForBoard(b) ?? parseBoardDims(b).width;
          if (nw > 0 && nw - width > 0.5) {
            ripStockWidthMm = ripStockWidthMm === null ? nw : Math.max(ripStockWidthMm, nw);
          }
        }

        return {
          key,
          sourcePriority: sourcePriority(boardCutSource(sample)),
          color,
          boardType,
          boardWidth: getRipWidth(sample) || width,
          totalLength: parseTotalLength(sample.board_size),
          trimSetting: Math.max(...groupedBoards.map(b => b.trim_loss ?? 5)),
          patterns,
          needsWidthRip: ripStockWidthMm !== null,
          ripStockWidthMm,
        };
      });
  };

  /* ── Build engineering groups: group by strip_width AND board type ── */
  const engineeringGroups = useMemo<EngineeringGroup[]>(() => {
    // Group boards by strip_width AND board type AND board size to prevent mixing different sheet types/sizes
    const groupMap: Record<string, Board[]> = {};
    for (const b of boards) {
      const w = b.strip_width || 0;
      const color = b.color || DEFAULT_BOX_COLOR;
      const boardType = productionLengthBoardType(b);
      const cutSource = boardCutSource(b);
      const key = `${cutSource}|||${color}|||${w}|||${boardType}|||${b.board_size}|||${b.trim_loss ?? 5}`;
      if (!groupMap[key]) groupMap[key] = [];
      groupMap[key].push(b);
    }

    // Sort by width descending so wider groups appear first, then by board type
    return Object.entries(groupMap)
      .sort(([keyA, boardsA], [keyB, boardsB]) => {
        const partsA = keyA.split("|||");
        const partsB = keyB.split("|||");
        const sourceA = sourcePriority((partsA[0] as "T0" | "T1") || boardCutSource(boardsA[0]));
        const sourceB = sourcePriority((partsB[0] as "T0" | "T1") || boardCutSource(boardsB[0]));
        if (sourceA !== sourceB) return sourceA - sourceB;

        // T1 boards first
        const typeA = partsA[3] || boardsA[0]?.board || "";
        const typeB = partsB[3] || boardsB[0]?.board || "";
        const isT1A = typeA.toUpperCase().includes("T1");
        const isT1B = typeB.toUpperCase().includes("T1");
        if (isT1A !== isT1B) return isT1A ? -1 : 1;

        const wA = parseFloat(partsA[2]);
        const wB = parseFloat(partsB[2]);

        // Non-rip before rip (rip = needs two-step, goes last)
        // Fall back to parseBoardDims width if SKU label doesn't yield a nominal width.
        const nwA = nominalStockWidthForBoard(boardsA[0]) ?? parseBoardDims(boardsA[0]).width ?? 0;
        const nwB = nominalStockWidthForBoard(boardsB[0]) ?? parseBoardDims(boardsB[0]).width ?? 0;
        const needsRipA = nwA > 0 && (nwA - wA > 0.5);
        const needsRipB = nwB > 0 && (nwB - wB > 0.5);
        if (needsRipA !== needsRipB) return needsRipA ? 1 : -1;

        if (Math.abs(wB - wA) > 0.01) return wB - wA;
        return keyA.localeCompare(keyB);
      })
      .map(([key, grpBoards]) => {
      const keyParts = key.split("|||");
      const color = keyParts[1] || DEFAULT_BOX_COLOR;
      const width = parseFloat(keyParts[2]);
      const sample = grpBoards[0];
      const totalLength = parseTotalLength(sample.board_size);
      const trimSetting = Math.max(...grpBoards.map(b => b.trim_loss ?? 5));

      // Collect all distinct board type names for the header (should just be one now)
      const boardTypes = [...new Set(grpBoards.map(b => productionLengthBoardType(b)))];
      const boardType = boardTypes.join(" / ");

      const patterns = buildMachinePatterns(grpBoards, width);
      const distinctCutPatterns = patterns.length;

      let ripStockWidthMm: number | null = null;
      for (const b of grpBoards) {
        const nw = nominalStockWidthForBoard(b) ?? parseBoardDims(b).width;
        if (nw > 0 && nw - width > 0.5) {
          ripStockWidthMm = ripStockWidthMm === null ? nw : Math.max(ripStockWidthMm, nw);
        }
      }
      const needsWidthRip = ripStockWidthMm !== null;

      // 组内一致性守卫 — 不同 strip_width 或 board 名称出现在同组意味着后端分组键污染
      const widthSet = new Set(grpBoards.map((b) => b.strip_width));
      const typeSet = new Set(grpBoards.map((b) => productionLengthBoardType(b)));
      const colorSet = new Set(grpBoards.map((b) => b.color || DEFAULT_BOX_COLOR));
      const inconsistent = widthSet.size > 1 || typeSet.size > 1 || colorSet.size > 1;
      if (inconsistent) {
        console.warn("[MachineCutPlan] engineering group has inconsistent strip_width/board_type", {
          key,
          widths: [...widthSet],
          types: [...typeSet],
          colors: [...colorSet],
        });
      }

      return {
        key: key,
        engNo: 0,
        sourcePriority: sourcePriority(boardCutSource(sample)),
        color,
        boardType,
        boardWidth: getRipWidth(sample) || width,
        totalLength,
        trimSetting,
        sourceBoardCount: grpBoards.length,
        boards: grpBoards,
        patterns,
        needsWidthRip,
        ripStockWidthMm,
        distinctCutPatterns,
        inconsistent,
      } as EngineeringGroup & { inconsistent: boolean };
    })
      .sort((a, b) => {
        const sourceDelta = (a.sourcePriority ?? 0) - (b.sourcePriority ?? 0);
        if (sourceDelta !== 0) return sourceDelta;
        const stackDelta = maxPatternStack(b.patterns) - maxPatternStack(a.patterns);
        if (stackDelta !== 0) return stackDelta;
        if (a.needsWidthRip !== b.needsWidthRip) return a.needsWidthRip ? 1 : -1;
        if (Math.abs(a.boardWidth - b.boardWidth) > 0.01) return a.boardWidth - b.boardWidth;
        return a.key.localeCompare(b.key);
      })
      .map((group, idx) => ({ ...group, engNo: idx + 1 }));
  }, [boards, productionLengthBoardType]);

  const displayGroups = useMemo(() => {
    const useCrossSheetT0Stack = useStandardLengthPool;
    const usedT0Sheets = new Set<string>();
    const groups: Array<EngineeringGroup & { displayBoards: Board[]; displayT0Sheets: MachineT0Sheet[] }> = [];
    const t0SheetOrder = new Map(t0Sheets.map((sheet, idx) => [sheet.sheet_id, idx]));

    for (const grp of engineeringGroups) {
      const allSheetIds = Array.from(new Set(grp.boards.map((b) => b.t0_sheet_id).filter(Boolean) as string[]))
        .sort((a, b) => (t0SheetOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (t0SheetOrder.get(b) ?? Number.MAX_SAFE_INTEGER));
      const nonT0Boards = grp.boards.filter((board) => !board.t0_sheet_id);

      if (allSheetIds.length === 0) {
        groups.push({ ...grp, displayBoards: grp.boards, displayT0Sheets: [] });
        continue;
      }

      if (!useCrossSheetT0Stack) {
        for (const sheetId of allSheetIds) {
          if (usedT0Sheets.has(sheetId)) continue;
          const displayBoards = Array.from(new Map(
            (t0BoardStripsBySheetId[sheetId] || []).map(({ board }) => [board.board_id, board])
          ).values());
          if (displayBoards.length === 0) continue;

          const sheet = t0SheetById[sheetId];
          usedT0Sheets.add(sheetId);
          groups.push({
            ...grp,
            key: `${grp.key}::${sheetId}`,
            sourceBoardCount: displayBoards.length,
            boards: displayBoards,
            displayBoards,
            displayT0Sheets: sheet ? [sheet] : [],
          });
        }

        if (nonT0Boards.length > 0) {
          groups.push({
            ...grp,
            key: `${grp.key}::stock`,
            sourceBoardCount: nonT0Boards.length,
            boards: nonT0Boards,
            displayBoards: nonT0Boards,
            displayT0Sheets: [],
          });
        }
        continue;
      }

      const displayT0Sheets = allSheetIds
        .filter((sheetId) => !usedT0Sheets.has(sheetId))
        .map((sheetId) => {
          usedT0Sheets.add(sheetId);
          return t0SheetById[sheetId];
        })
        .filter(Boolean) as MachineT0Sheet[];

      groups.push({
        ...grp,
        key: `${grp.key}::t0-strips`,
        sourceBoardCount: grp.boards.length,
        boards: grp.boards,
        displayBoards: grp.boards,
        displayT0Sheets,
      });
    }

    return groups.map((grp, idx) => ({ ...grp, engNo: idx + 1 }));
  }, [engineeringGroups, t0BoardStripsBySheetId, t0SheetById, t0Sheets, useStandardLengthPool]);

  const handlePrint = useCallback(() => {
    openMachineCutPrintWindow({ displayGroups, machineLang, orderLabel, mt });
  }, [displayGroups, machineLang, mt, orderLabel]);

  // Collect backend-reported issues (integrity + schema) for banner display
  const allIssues: IntegrityIssue[] = useMemo(() => {
    const list: IntegrityIssue[] = [];
    const ii = cutResult?.issues;
    if (!ii) return list;
    if (Array.isArray(ii.integrity)) list.push(...ii.integrity);
    if (Array.isArray(ii.schema)) list.push(...ii.schema);
    return list.filter((issue) => {
      if (issue.code === "STRIP_LENGTH_OVERFLOW") {
        const ref = issue.ref as { board_id?: string } | undefined;
        const board = boards.find((b) => b.board_id === ref?.board_id);
        if (board) {
          const partsLen = board.parts.reduce((sum, part) => sum + (part.cut_length || part.Height || 0), 0);
          const kerfLen = Math.max(0, board.parts.length - 1) * (board.saw_kerf || 0);
          const usableLen = board.usable_length || 0;
          if (usableLen > 0 && partsLen + kerfLen <= usableLen + 0.5) return false;
        }
      }
      if (issue.code !== "CABINET_DIM_MISMATCH") return true;
      const ref = issue.ref as
        | {
            expected?: { Height?: number; Width?: number };
            actual?: { Height?: number; Width?: number };
          }
        | undefined;
      const eh = ref?.expected?.Height;
      const ew = ref?.expected?.Width;
      const ah = ref?.actual?.Height;
      const aw = ref?.actual?.Width;
      if ([eh, ew, ah, aw].every((v) => typeof v === "number")) {
        const direct = Math.abs((eh as number) - (ah as number)) < 0.5 && Math.abs((ew as number) - (aw as number)) < 0.5;
        const swapped = Math.abs((eh as number) - (aw as number)) < 0.5 && Math.abs((ew as number) - (ah as number)) < 0.5;
        if (!direct && swapped) return false;
      }
      return true;
    });
  }, [cutResult, boards]);
  const [issuesOpen, setIssuesOpen] = useState(false);

  if (boards.length === 0) {
    return (
      <div className="bg-card rounded-xl shadow-apple border border-border/30 p-12 text-center">
        <p className="text-apple-gray text-[15px]">{mt("noData")}</p>
      </div>
    );
  }

  return (
    <MachineCutErrorBoundary label="MachineCutPlan">

      <div className="machine-cut-plan space-y-4">
        <div className="flex items-center justify-between machine-no-print">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-apple-gray">🌐</span>
            {(["zh", "en", "es"] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setMachineLang(lang)}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                  machineLang === lang
                    ? "bg-foreground text-white shadow-sm"
                    : "bg-black/[0.04] text-apple-gray hover:text-foreground"
                }`}
              >
                {lang === "zh" ? "中文" : lang === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-foreground text-white text-[13px] font-semibold hover:bg-foreground/90 transition-colors shadow-sm"
          >
            <Printer size={14} /> {mt("printBtn")}
          </button>
        </div>


        {allIssues.length > 0 && (
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 machine-no-print">
            <button
              onClick={() => setIssuesOpen((o) => !o)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-[13px] font-semibold text-amber-800">
                ⚠ Data issues detected: {allIssues.length}
              </span>
              <span className="text-[11px] text-amber-700">{issuesOpen ? "▼" : "▶"}</span>
            </button>
            {issuesOpen && (
              <ul className="mt-2 space-y-1 text-[11px] font-mono text-amber-900 max-h-48 overflow-auto">
                {allIssues.map((it, i) => (
                  <li key={i} className={it.severity === "error" ? "text-red-700" : "text-amber-800"}>
                    <span className="font-bold">[{it.code}]</span> {it.msg}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(displayGroups as (EngineeringGroup & { inconsistent?: boolean; displayBoards: Board[]; displayT0Sheets: MachineT0Sheet[] })[]).map((grp) => {
          const groupT0Sheets = grp.displayT0Sheets;
          const hasT0RipStep = groupT0Sheets.length > 0;
          const ripBatches = buildT0RipBatches(groupT0Sheets);
          const cutSections = buildCutSections(grp.displayBoards);
          const tileItems = cutSections.flatMap((section) =>
            section.patterns.map((pattern) => ({ section, pattern }))
          ).sort((a, b) => comparePatternPriority(
            { pattern: a.pattern, boardWidth: a.section.boardWidth, sourcePriority: a.section.sourcePriority },
            { pattern: b.pattern, boardWidth: b.section.boardWidth, sourcePriority: b.section.sourcePriority }
          ));
          return (
          <MachineCutErrorBoundary key={grp.key} label={`group ${grp.engNo}`}>
          <div data-print-group={grp.engNo} className="bg-white rounded-xl shadow-sm border border-border overflow-hidden">

            <div data-print-group-header className="bg-white text-slate-800 p-5 border-b border-border/60">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <span data-print-group-title>{`${mt("engineeringNo")} ${grp.engNo}`}</span>
                {grp.inconsistent && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300 machine-no-print">
                    ⚠ Inconsistent group
                  </span>
                )}
              </h3>
              <div className="mt-2 inline-flex items-center gap-2 text-[13px] font-medium text-slate-600">
                <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: getColor(grp.color).hex_color }} />
                <span>{mt("color")}: {colorLabel(getColor(grp.color), locale)}</span>
              </div>
            </div>

            {/* CONTENT SECTION */}
            <div data-print-content className="p-5 space-y-8 flex flex-col">

              {hasT0RipStep && (
                <div data-print-phase={`A-${grp.engNo}`} className="space-y-4 order-2">
                  <h4 data-print-step-title className="text-[16px] font-bold text-slate-800 border-b-2 border-emerald-200 pb-2">
                    {mt("phaseATitle")}
                  </h4>

                  {ripBatches.map((batch, batchIdx) => {
                    const sampleSheet = t0SheetById[batch.sheetIds[0]];
                    const sampleSheetOrdinal = groupT0Sheets.findIndex((sheet) => sheet.sheet_id === batch.sheetIds[0]);
                    const sampleSheetNo = sampleSheetOrdinal >= 0 ? sampleSheetOrdinal + 1 : batchIdx + 1;
                    const sheetStrips = sampleSheet ? t0BoardStripsBySheetId[sampleSheet.sheet_id] || [] : [];
                    const sheetLabel = `${mt("rawSheetWord")} ${sampleSheetNo}`;
                    const sheetBadge = batch.sheetIds.length > 1
                      ? mt("stackBadge").replace("{n}", String(batch.sheetIds.length))
                      : mt("singleSheet");

                    return (
                      <div key={batch.key} data-print-step={`${grp.engNo}-A-${batchIdx}`} className="space-y-3 border-l-4 border-emerald-200/70 pl-4">
                        <div data-print-step-header className="flex items-center gap-2 flex-wrap">
                          <h5 className="text-[15px] font-bold text-slate-800">{sheetLabel}</h5>
                          <span data-print-board-count className={`text-[14px] font-semibold ${batch.sheetIds.length > 1 ? "text-red-600" : "text-emerald-600"}`}>
                            {sheetBadge}
                          </span>
                        </div>

                        <div data-print-substep="setup" className="text-[13px] text-slate-600 bg-black/[0.02] p-4 rounded-xl border border-black/[0.05]">
                          <h6 className="text-[13px] font-semibold text-slate-700 mb-2">{mt("subStepSetup")}</h6>
                          <p>
                            {mt("step1Desc2")} <strong className="text-black font-semibold">{batch.totalLength} mm</strong>{mt("step1Desc3")} <strong className="text-black font-semibold">{batch.width} mm</strong>{mt("step1Desc4")} <strong className="text-black font-semibold">{batch.trim} mm</strong>。
                          </p>
                        </div>

                        <div data-print-substep="input" className="bg-emerald-50/30 p-4 rounded-xl border border-emerald-100">
                          <h6 className="text-[13px] font-semibold text-slate-700 mb-2">{mt("subStepInput")}</h6>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[13px] bg-white rounded-lg overflow-hidden border border-border/40">
                              <thead>
                                <tr className="bg-black/[0.03] border-b border-border/40">
                                  <th className="text-center py-3 px-4 font-semibold text-apple-gray w-24">{mt("rowNo")}</th>
                                  <th className="text-center py-3 px-4 font-semibold text-apple-gray w-48">{mt("cutLength")}</th>
                                  <th className="text-center py-3 px-4 font-semibold text-apple-gray w-36">{mt("pieceCount")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-b border-border/10 last:border-0 hover:bg-black/[0.01]">
                                  <td className="text-center py-2.5 px-4 text-apple-gray">{batch.rowOrder + 1}</td>
                                  <td className="text-center py-2.5 px-4 font-mono text-[15px]">{batch.ripWidth}</td>
                                  <td className="text-center py-2.5 px-4 text-[15px]">{batch.pieces}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {sampleSheet && (
                          <div data-print-substep="layout" data-print-keep className="bg-emerald-50/30 p-4 rounded-xl border border-emerald-100">
                            <h6 className="text-[13px] font-semibold text-slate-700 mb-3">{mt("subStepLayout")}</h6>
                            <T0SheetCard
                              sheetId={sampleSheet.sheet_id}
                              strips={sheetStrips}
                              sizeColorMap={sizeColorMap}
                              onBoardClick={() => {}}
                              recoveredStrips={(sampleSheet.recovered_strips || [])
                                .filter((r) => typeof r.width === "number")
                                .map((r) => ({ width: r.width as number, board_type: r.board_type ?? "", label: r.label }))}
                              patternNumbering={patternNumbering}
                              compactHeader={true}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div data-print-phase={`B-${grp.engNo}`} className="space-y-5 order-1">
                <h4 data-print-step-title className="text-[16px] font-bold text-slate-800 border-b-2 border-blue-200 pb-2">
                  {mt("phaseBTitle")}
                </h4>

                {tileItems.map(({ section, pattern }, pIdx) => {
                  const numLabel = indexToNumberStr(pIdx);
                  const boardLabel = `${mt("boardWord")} ${numLabel}`;
                  const isSingle = pattern.boardCount === 1;
                  const badgeText = isSingle
                    ? mt("singleSheet")
                    : mt("stackBadge").replace("{n}", String(pattern.boardCount));

                  return (
                    <div key={pIdx} data-print-step={`${grp.engNo}-B-${pIdx}`} className="space-y-3 border-l-4 border-blue-200/60 pl-4">
                      <div data-print-step-header className="flex items-center gap-2 flex-wrap">
                        <h5 className="text-[15px] font-bold text-slate-800">{boardLabel}</h5>
                        <span data-print-board-count className={`text-[14px] font-semibold ${isSingle ? "text-emerald-600" : "text-red-600"}`}>
                          {badgeText}
                        </span>

                      </div>

                      <div data-print-substep="setup" className="text-[13px] text-slate-600 bg-black/[0.02] p-4 rounded-xl border border-black/[0.05]">
                        <h6 className="text-[13px] font-semibold text-slate-700 mb-2">{mt("subStepSetup")}</h6>
                        <p>
                          {mt("step1Desc2")} <strong className="text-black font-semibold">{section.totalLength} mm</strong>{mt("step1Desc3")} <strong className="text-black font-semibold">{section.boardWidth} mm</strong>{mt("step1Desc4")} <strong className="text-black font-semibold">{section.trimSetting} mm</strong>。
                        </p>
                      </div>

                      <div data-print-substep="input" className="bg-blue-50/40 p-4 rounded-xl border border-blue-100">
                        <h6 className="text-[13px] font-semibold text-slate-700 mb-2">{mt("subStepInput")}</h6>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[13px] bg-white rounded-lg overflow-hidden border border-border/40">
                            <thead>
                              <tr className="bg-black/[0.03] border-b border-border/40">
                                <th className="text-center py-3 px-4 font-semibold text-apple-gray w-24">{mt("rowNo")}</th>
                                <th className="text-center py-3 px-4 font-semibold text-apple-gray w-48">{mt("cutLength")}</th>
                                <th className="text-center py-3 px-4 font-semibold text-apple-gray w-36">{mt("pieceCount")}</th>
                                <th className="text-left py-3 px-4 font-semibold text-apple-gray">{mt("notes")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pattern.cutRows.map((row, ri) => (
                                <tr key={ri} className="border-b border-border/10 last:border-0 hover:bg-black/[0.01]">
                                  <td className="text-center py-2.5 px-4 text-apple-gray">{ri + 1}</td>
                                  <td className="text-center py-2.5 px-4 font-mono text-[15px]">{row.cutLength}</td>
                                  <td className="text-center py-2.5 px-4 text-[15px]">{row.pieces}</td>
                                  <td className="py-2.5 px-4 text-[12px] font-mono text-slate-500 whitespace-nowrap">
                                    {formatCutNote(machineLang, pattern.sampleBoard, row.stackOf || pattern.boardCount, section.boardWidth, row.cutLength, pattern.cutRows.length)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div data-print-substep="layout" data-print-keep className="bg-slate-50/60 p-4 rounded-xl border border-slate-200/60">
                        <h6 className="text-[13px] font-semibold text-slate-700 mb-3">{mt("subStepLayout")}</h6>
                        <div className="flex justify-center">
                          <BoardTile
                            board={pattern.sampleBoard}
                            index={pIdx}
                            color={{ bg: "#fad2a4", border: "#f47820", text: "#c2410c", light: "#ffffff" }}
                            stackInfo={{ groupSize: pattern.boardCount, stackOf: pattern.boardCount, isLeader: true }}
                            onClick={() => {}}
                            disableHover={true}
                            hideWidthWaste={false}
                            isRotated={false}
                            hideUtilization={true}
                            showDimensions={true}
                            hideStackBadge={true}
                            hidePreviousStripShade={true}
                            hideBoardId={true}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>

          </div>
          </MachineCutErrorBoundary>
        );
        })}
      </div>
    </MachineCutErrorBoundary>
  );
}
