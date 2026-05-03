"use client";

import React, { useMemo, useRef } from "react";
import { Printer } from "lucide-react";
import type { Board, CutResult, EngineeringGroup } from "./types";
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

const T0_RAW_WIDTH_MM = 1219.2;
const T0_RAW_LENGTH_MM = 2438.4;

type LocaleKey = "en" | "zh" | "es";

interface CutPlanT0Recovered {
  width?: number;
  board_type?: string;
  label?: string;
}

interface CutPlanT0Sheet {
  sheet_id: string;
  recovered_strips?: CutPlanT0Recovered[];
}

interface CutPlanPattern {
  sampleBoard: Board;
  boardCount: number;
  cutRows: { cutLength: number; pieces: number }[];
}

interface CutPlanSection {
  color: string;
  boardType: string;
  boardWidth: number;
  totalLength: number;
  trimSetting: number;
  patterns: CutPlanPattern[];
}

interface DisplayGroup extends EngineeringGroup {
  displayBoards: Board[];
  displayT0Sheets: CutPlanT0Sheet[];
}

interface TableRow {
  key: string;
  setupNo: number;
  step: string;
  inputType: string;
  boardType: string;
  color: string;
  sourceId: string;
  totalLength: number;
  width: number;
  trim: number;
  stackQty: number;
  rowNo: number;
  inputValue: number;
  pieces: number;
}

const copy: Record<LocaleKey, Record<string, string>> = {
  en: {
    title: "Text Cut Plan",
    print: "Print",
    orderNo: "Order No.",
    color: "Color",
    setups: "Machine Setups",
    boards: "Boards",
    inputs: "Input Rows",
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
    inputValue: "Input Value (mm)",
    pieces: "Pieces",
    t0Rip: "A T0 Rip",
    lengthCut: "B Length Cut",
    ripWidth: "Rip Width",
    cutLength: "Cut Length",
    empty: "No cut plan data available.",
  },
  zh: {
    title: "Text Cut Plan",
    print: "打印",
    orderNo: "订单号",
    color: "颜色",
    setups: "机器设置",
    boards: "板数",
    inputs: "输入行",
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
    inputValue: "输入数值 (mm)",
    pieces: "片数",
    t0Rip: "A 原板纵裁",
    lengthCut: "B 长度裁切",
    ripWidth: "纵裁宽度",
    cutLength: "裁切长度",
    empty: "暂无裁切流程数据。",
  },
  es: {
    title: "Text Cut Plan",
    print: "Imprimir",
    orderNo: "No. de Pedido",
    color: "Color",
    setups: "Configuraciones",
    boards: "Tableros",
    inputs: "Filas de Entrada",
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
    inputValue: "Valor (mm)",
    pieces: "Piezas",
    t0Rip: "A Corte T0",
    lengthCut: "B Corte Longitud",
    ripWidth: "Ancho Corte",
    cutLength: "Longitud Corte",
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

function parseT0SheetDims(sheetId: string): { width: number; length: number } {
  const match = sheetId.match(/T0-(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return { width: T0_RAW_WIDTH_MM, length: T0_RAW_LENGTH_MM };
  return {
    width: parseFloat(match[1]) || T0_RAW_WIDTH_MM,
    length: parseFloat(match[2]) || T0_RAW_LENGTH_MM,
  };
}

function buildCutSections(sectionBoards: Board[]): CutPlanSection[] {
  const sectionMap: Record<string, Board[]> = {};
  for (const board of sectionBoards) {
    const width = board.strip_width || 0;
    const color = board.color || DEFAULT_BOX_COLOR;
    const key = `${color}|||${width}|||${board.board}|||${board.board_size}|||${board.trim_loss ?? 5}`;
    if (!sectionMap[key]) sectionMap[key] = [];
    sectionMap[key].push(board);
  }

  return Object.entries(sectionMap)
    .sort(([keyA, boardsA], [keyB, boardsB]) => {
      const typeA = boardsA[0]?.board || "";
      const typeB = boardsB[0]?.board || "";
      const isT1A = typeA.toUpperCase().includes("T1");
      const isT1B = typeB.toUpperCase().includes("T1");
      if (isT1A !== isT1B) return isT1A ? -1 : 1;
      const widthA = parseFloat(keyA.split("|||")[1]);
      const widthB = parseFloat(keyB.split("|||")[1]);
      if (Math.abs(widthB - widthA) > 0.01) return widthB - widthA;
      return keyA.localeCompare(keyB);
    })
    .map(([key, groupedBoards]) => {
      const color = key.split("|||")[0] || DEFAULT_BOX_COLOR;
      const width = parseFloat(key.split("|||")[1]);
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
        color,
        boardType: [...new Set(groupedBoards.map((board) => board.board))].join(" / "),
        boardWidth: getRipWidth(sample) || width,
        totalLength: parseTotalLength(sample.board_size),
        trimSetting: Math.max(...groupedBoards.map((board) => board.trim_loss ?? 5)),
        patterns,
      };
    });
}

function buildDisplayGroups(boards: Board[], t0Sheets: CutPlanT0Sheet[]): DisplayGroup[] {
  const groupMap: Record<string, Board[]> = {};
  for (const board of boards) {
    const width = board.strip_width || 0;
    const color = board.color || DEFAULT_BOX_COLOR;
    const key = `${color}|||${width}|||${board.board}|||${board.board_size}|||${board.trim_loss ?? 5}`;
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(board);
  }

  const engineeringGroups = Object.entries(groupMap)
    .sort(([keyA, boardsA], [keyB, boardsB]) => {
      const typeA = boardsA[0]?.board || "";
      const typeB = boardsB[0]?.board || "";
      const isT1A = typeA.toUpperCase().includes("T1");
      const isT1B = typeB.toUpperCase().includes("T1");
      if (isT1A !== isT1B) return isT1A ? -1 : 1;

      const widthA = parseFloat(keyA.split("|||")[1]);
      const widthB = parseFloat(keyB.split("|||")[1]);
      const stockWidthA = nominalStockWidthForBoard(boardsA[0]) ?? parseBoardDims(boardsA[0]).width ?? 0;
      const stockWidthB = nominalStockWidthForBoard(boardsB[0]) ?? parseBoardDims(boardsB[0]).width ?? 0;
      const needsRipA = stockWidthA > 0 && stockWidthA - widthA > 0.5;
      const needsRipB = stockWidthB > 0 && stockWidthB - widthB > 0.5;
      if (needsRipA !== needsRipB) return needsRipA ? 1 : -1;

      if (Math.abs(widthB - widthA) > 0.01) return widthB - widthA;
      return keyA.localeCompare(keyB);
    })
    .map(([key, groupBoards], idx) => {
      const color = key.split("|||")[0] || DEFAULT_BOX_COLOR;
      const width = parseFloat(key.split("|||")[1]);
      const sample = groupBoards[0];
      const patterns = buildCutSections(groupBoards).flatMap((section) => section.patterns);
      const stockWidth = nominalStockWidthForBoard(sample) ?? parseBoardDims(sample).width ?? 0;

      return {
        key: `${color}-w${width}`,
        engNo: idx + 1,
        boardType: [...new Set(groupBoards.map((board) => board.board))].join(" / "),
        color,
        boardWidth: getRipWidth(sample) || width,
        totalLength: parseTotalLength(sample.board_size),
        trimSetting: Math.max(...groupBoards.map((board) => board.trim_loss ?? 5)),
        sourceBoardCount: groupBoards.length,
        boards: groupBoards,
        patterns,
        needsWidthRip: stockWidth > 0 && stockWidth - width > 0.5,
        ripStockWidthMm: stockWidth > 0 && stockWidth - width > 0.5 ? stockWidth : null,
        distinctCutPatterns: patterns.length,
      };
    });

  const t0SheetById = Object.fromEntries(t0Sheets.map((sheet) => [sheet.sheet_id, sheet]));
  const t0SheetOrder = new Map(t0Sheets.map((sheet, idx) => [sheet.sheet_id, idx]));
  const t0BoardStripsBySheetId: Record<string, { board: Board; index: number }[]> = {};
  boards.forEach((board, index) => {
    if (!board.t0_sheet_id) return;
    if (!t0BoardStripsBySheetId[board.t0_sheet_id]) t0BoardStripsBySheetId[board.t0_sheet_id] = [];
    t0BoardStripsBySheetId[board.t0_sheet_id].push({ board, index });
  });
  for (const strips of Object.values(t0BoardStripsBySheetId)) {
    strips.sort((a, b) => (a.board.t0_strip_position || 0) - (b.board.t0_strip_position || 0));
  }

  const usedT0Sheets = new Set<string>();
  const groups: DisplayGroup[] = [];
  for (const group of engineeringGroups) {
    const allSheetIds = Array.from(new Set(group.boards.map((board) => board.t0_sheet_id).filter(Boolean) as string[]))
      .sort((a, b) => (t0SheetOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (t0SheetOrder.get(b) ?? Number.MAX_SAFE_INTEGER));
    const nonT0Boards = group.boards.filter((board) => !board.t0_sheet_id);

    if (allSheetIds.length === 0) {
      groups.push({ ...group, displayBoards: group.boards, displayT0Sheets: [] });
      continue;
    }

    for (const sheetId of allSheetIds) {
      if (usedT0Sheets.has(sheetId)) continue;
      const displayBoards = Array.from(new Map(
        (t0BoardStripsBySheetId[sheetId] || []).map(({ board }) => [board.board_id, board])
      ).values());
      if (displayBoards.length === 0) continue;

      usedT0Sheets.add(sheetId);
      groups.push({
        ...group,
        key: `${group.key}::${sheetId}`,
        sourceBoardCount: displayBoards.length,
        boards: displayBoards,
        displayBoards,
        displayT0Sheets: t0SheetById[sheetId] ? [t0SheetById[sheetId]] : [],
      });
    }

    if (nonT0Boards.length > 0) {
      groups.push({
        ...group,
        key: `${group.key}::stock`,
        sourceBoardCount: nonT0Boards.length,
        boards: nonT0Boards,
        displayBoards: nonT0Boards,
        displayT0Sheets: [],
      });
    }
  }

  return groups.map((group, idx) => ({ ...group, engNo: idx + 1 }));
}

export function CutPlanTable({
  boards,
  orderLabel,
  cutResult,
  selectedUtilization,
}: {
  boards: Board[];
  orderLabel: string;
  cutResult?: CutResult | null;
  selectedUtilization: number;
}) {
  const printRef = useRef<HTMLDivElement | null>(null);
  const { locale } = useLanguage();
  const { getColor } = useBoxColors();
  const lc = copy[(locale as LocaleKey) || "en"] || copy.en;

  const t0Sheets = useMemo<CutPlanT0Sheet[]>(() => {
    return (cutResult?.t0_plan?.t0_sheets || [])
      .map((sheet) => sheet as CutPlanT0Sheet)
      .filter((sheet) => !!sheet.sheet_id);
  }, [cutResult]);

  const tableRows = useMemo<TableRow[]>(() => {
    const displayGroups = buildDisplayGroups(boards, t0Sheets);
    const rows: TableRow[] = [];

    displayGroups.forEach((group) => {
      for (const sheet of group.displayT0Sheets) {
        const dims = parseT0SheetDims(sheet.sheet_id);
        const sheetStrips = group.displayBoards
          .filter((board) => board.t0_sheet_id === sheet.sheet_id)
          .sort((a, b) => (a.t0_strip_position || 0) - (b.t0_strip_position || 0));
        const ripRows = [
          ...sheetStrips.map((board, idx) => ({
            key: board.board_id || `strip-${idx}`,
            width: getRipWidth(board) || board.actual_strip_width || 0,
            boardType: board.board,
          })),
          ...(sheet.recovered_strips || [])
            .filter((recovered) => typeof recovered.width === "number")
            .map((recovered, idx) => ({
              key: recovered.label || `recovered-${idx}`,
              width: recovered.width as number,
              boardType: recovered.board_type || group.boardType,
            })),
        ];

        ripRows.forEach((row, rowIdx) => {
          rows.push({
            key: `${group.key}-A-${sheet.sheet_id}-${row.key}`,
            setupNo: group.engNo,
            step: lc.t0Rip,
            inputType: lc.ripWidth,
            boardType: row.boardType,
            color: group.color || DEFAULT_BOX_COLOR,
            sourceId: sheet.sheet_id,
            totalLength: dims.length,
            width: dims.width,
            trim: 5,
            stackQty: 1,
            rowNo: rowIdx + 1,
            inputValue: row.width,
            pieces: 1,
          });
        });
      }

      const cutSections = buildCutSections(group.displayBoards);
      cutSections.forEach((section, sectionIdx) => {
        section.patterns.forEach((pattern, patternIdx) => {
          pattern.cutRows.forEach((cutRow, cutRowIdx) => {
            rows.push({
              key: `${group.key}-B-${sectionIdx}-${patternIdx}-${cutRowIdx}`,
              setupNo: group.engNo,
              step: lc.lengthCut,
              inputType: lc.cutLength,
              boardType: section.boardType,
              color: section.color,
              sourceId: pattern.sampleBoard.board_id,
              totalLength: section.totalLength,
              width: section.boardWidth,
              trim: section.trimSetting,
              stackQty: pattern.boardCount,
              rowNo: cutRowIdx + 1,
              inputValue: cutRow.cutLength,
              pieces: cutRow.pieces,
            });
          });
        });
      });
    });

    return rows;
  }, [boards, lc.cutLength, lc.lengthCut, lc.ripWidth, lc.t0Rip, t0Sheets]);

  const setupCount = useMemo(() => new Set(tableRows.map((row) => row.setupNo)).size, [tableRows]);
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
      .print-container { padding: 8mm; }
      .cut-plan-print-root {
        box-shadow: none !important;
        border: 0 !important;
      }
      .cut-plan-print-root table {
        width: 100% !important;
        border-collapse: collapse !important;
        font-size: 10px !important;
      }
      .cut-plan-print-root th,
      .cut-plan-print-root td {
        border: 1px solid #d1d5db !important;
        padding: 5px 6px !important;
        vertical-align: middle !important;
      }
      .cut-plan-print-root thead tr {
        background: #f3f4f6 !important;
      }
      .cut-plan-print-root tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      * {
        transition: none !important;
        animation: none !important;
        box-shadow: none !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      @media print {
        @page { size: A4 landscape; margin: 7mm; }
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

  return (
    <div ref={printRef} className="cut-plan-print-root bg-card rounded-xl shadow-apple border border-border/30 overflow-hidden">
      <div className="p-4 border-b border-border/50 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-foreground">{lc.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-apple-gray">
            <span>{lc.orderNo}: <strong className="text-foreground font-semibold">{orderLabel}</strong></span>
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

      <div className="px-4 py-3 border-b border-border/40 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-black/[0.03] rounded-lg">
          <span className="text-[13px] text-apple-gray font-medium">T0 48&quot; × 96&quot;</span>
          <span className="text-[14px] font-bold text-foreground">{t0Sheets.length}</span>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-black/[0.03] rounded-lg">
          <span className="text-[13px] text-apple-gray font-medium">T1 Strips</span>
          <span className="text-[14px] font-bold text-foreground">{boards.length}</span>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-black/[0.03] rounded-lg">
          <span className="text-[13px] text-apple-gray font-medium">T2 Parts</span>
          <span className="text-[14px] font-bold text-foreground">{boards.reduce((acc, b) => acc + (b.parts?.length || 0), 0)}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-black/[0.03] border-b border-border/40">
              <th className="text-center py-3 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.setup}</th>
              <th className="text-left py-3 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.step}</th>
              <th className="text-left py-3 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.inputType}</th>
              <th className="text-left py-3 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.material}</th>
              <th className="text-right py-3 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.totalLength}</th>
              <th className="text-right py-3 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.width}</th>
              <th className="text-right py-3 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.trim}</th>
              <th className="text-center py-3 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.stack}</th>
              <th className="text-center py-3 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.row}</th>
              <th className="text-right py-3 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.inputValue}</th>
              <th className="text-center py-3 px-3 font-semibold text-apple-gray whitespace-nowrap">{lc.pieces}</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr key={row.key} className="border-b border-border/20 hover:bg-black/[0.01]">
                <td className="py-2.5 px-3 text-center font-semibold">{row.setupNo}</td>
                <td className="py-2.5 px-3 whitespace-nowrap">{row.step}</td>
                <td className="py-2.5 px-3 whitespace-nowrap">{row.inputType}</td>
                <td className="py-2.5 px-3 whitespace-nowrap">{row.boardType}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmt(row.totalLength)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmt(row.width)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{fmt(row.trim)}</td>
                <td className="py-2.5 px-3 text-center">{row.stackQty}</td>
                <td className="py-2.5 px-3 text-center">{row.rowNo}</td>
                <td className="py-2.5 px-3 text-right font-mono font-semibold">{fmt(row.inputValue)}</td>
                <td className="py-2.5 px-3 text-center font-semibold">{row.pieces}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
