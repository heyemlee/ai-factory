"use client";

import React, { useMemo, useRef } from "react";
import { Printer } from "lucide-react";
import type { Board, CutResult } from "./types";
import { boardFingerprint, getRipWidth } from "./utils";
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
  boardType: string;
  boardWidth: number;
  totalLength: number;
  trimSetting: number;
  patterns: CutPlanPattern[];
}

interface BatchInputRow {
  key: string;
  rowNo: number;
  inputValue: number;
  pieces: number;
}

interface CutPlanBatch {
  key: string;
  take: string;
  stackQty: number;
  stackUnit: string;
  totalLength: number;
  width: number;
  trim: number;
  inputLabel: string;
  rows: BatchInputRow[];
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
    inputValue: "Input Value (mm)",
    pieces: "Pieces",
    t0Rip: "A T0 Rip",
    lengthCut: "B Length Cut",
    t0SectionTitle: "T0 ➡️ T1",
    t1SectionTitle: "T1 ➡️ T2",
    ripWidth: "Rip Width",
    cutLength: "Cut Length",
    take: "Take",
    rawSheets: 'T0-48"x96"',
    t1Strips: "T1 strips",
    sheets: "sheets",
    strips: "strips",
    machineSetup: "① Machine Setup",
    boardInput: "② Board Input",
    inputTotalLength: "Input Total Length",
    trimSetting: "Trim Setting",
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
    inputValue: "输入数值 (mm)",
    pieces: "片数",
    t0Rip: "A 原板纵裁",
    lengthCut: "B 长度裁切",
    t0SectionTitle: "T0 ➡️ T1",
    t1SectionTitle: "T1 ➡️ T2",
    ripWidth: "纵裁宽度",
    cutLength: "裁切长度",
    take: "拿料",
    rawSheets: 'T0-48"x96"',
    t1Strips: "T1 条料",
    sheets: "张",
    strips: "条",
    machineSetup: "① 机器设置",
    boardInput: "② 板材输入",
    inputTotalLength: "输入总长度",
    trimSetting: "修边设置",
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
    inputValue: "Valor (mm)",
    pieces: "Piezas",
    t0Rip: "A Corte T0",
    lengthCut: "B Corte Longitud",
    t0SectionTitle: "T0 ➡️ T1",
    t1SectionTitle: "T1 ➡️ T2",
    ripWidth: "Ancho Corte",
    cutLength: "Longitud Corte",
    take: "Tomar",
    rawSheets: 'T0-48"x96"',
    t1Strips: "tiras T1",
    sheets: "hojas",
    strips: "tiras",
    machineSetup: "① Configuración",
    boardInput: "② Entrada",
    inputTotalLength: "Longitud Total",
    trimSetting: "Recorte",
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

function numericKey(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "0.000";
}

function compactInputRuns(rows: Array<{ width: number; boardType: string }>) {
  const runs: Array<{ width: number; boardType: string; pieces: number }> = [];
  for (const row of rows) {
    const prev = runs[runs.length - 1];
    if (prev && numericKey(prev.width) === numericKey(row.width) && prev.boardType === row.boardType) {
      prev.pieces += 1;
    } else {
      runs.push({ ...row, pieces: 1 });
    }
  }
  return runs;
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
        boardType: [...new Set(groupedBoards.map((board) => board.board))].join(" / "),
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

  const planBatches = useMemo(() => {
    const t0Batches: CutPlanBatch[] = [];
    const t1Batches: CutPlanBatch[] = [];
    const t0PatternMap = new Map<string, {
      order: number;
      sheetIds: string[];
      totalLength: number;
      width: number;
      trim: number;
      runs: Array<{ width: number; boardType: string; pieces: number }>;
    }>();

    t0Sheets.forEach((sheet, sheetIdx) => {
      const dims = parseT0SheetDims(sheet.sheet_id);
      const sheetStrips = boards
        .filter((board) => board.t0_sheet_id === sheet.sheet_id)
        .sort((a, b) => (a.t0_strip_position || 0) - (b.t0_strip_position || 0));
      const ripRows = compactInputRuns([
        ...sheetStrips.map((board) => ({
          width: getRipWidth(board) || board.actual_strip_width || 0,
          boardType: board.board,
        })),
        ...(sheet.recovered_strips || [])
          .filter((recovered) => typeof recovered.width === "number")
          .map((recovered) => ({
            width: recovered.width as number,
            boardType: recovered.board_type || sheetStrips[0]?.board || "T0",
          })),
      ]);
      if (ripRows.length === 0) return;

      const patternKey = [
        numericKey(dims.length),
        numericKey(dims.width),
        "5.000",
        ripRows.map((row) => `${row.boardType}:${numericKey(row.width)}:${row.pieces}`).join("|"),
      ].join("|||");
      const existing = t0PatternMap.get(patternKey);
      if (existing) {
        existing.sheetIds.push(sheet.sheet_id);
      } else {
        t0PatternMap.set(patternKey, {
          order: sheetIdx,
          sheetIds: [sheet.sheet_id],
          totalLength: dims.length,
          width: dims.width,
          trim: 5,
          runs: ripRows,
        });
      }
    });

    let t0BatchNo = 1;
    Array.from(t0PatternMap.values())
      .sort((a, b) => a.order - b.order)
      .forEach((pattern) => {
        for (let start = 0; start < pattern.sheetIds.length; start += 4) {
          const stackQty = pattern.sheetIds.slice(start, start + 4).length;
          const batchKey = `A${t0BatchNo++}`;
          t0Batches.push({
            key: batchKey,
            take: lc.rawSheets,
            stackQty,
            stackUnit: lc.sheets,
            totalLength: pattern.totalLength,
            width: pattern.width,
            trim: pattern.trim,
            inputLabel: lc.ripWidth,
            rows: pattern.runs.map((row, rowIdx) => ({
              key: `${batchKey}-${rowIdx}`,
              rowNo: rowIdx + 1,
              inputValue: row.width,
              pieces: row.pieces,
            })),
          });
        }
      });

    let t1BatchNo = 1;
    buildCutSections(boards).forEach((section, sectionIdx) => {
      section.patterns.forEach((pattern, patternIdx) => {
        const batchKey = `B${t1BatchNo++}`;
        t1Batches.push({
          key: `${batchKey}-${sectionIdx}-${patternIdx}`,
          take: `${fmt(section.boardWidth)} mm ${lc.t1Strips}`,
          stackQty: pattern.boardCount,
          stackUnit: lc.strips,
          totalLength: section.totalLength,
          width: section.boardWidth,
          trim: section.trimSetting,
          inputLabel: lc.cutLength,
          rows: pattern.cutRows.map((cutRow, cutRowIdx) => ({
            key: `${batchKey}-${sectionIdx}-${patternIdx}-${cutRowIdx}`,
            rowNo: cutRowIdx + 1,
            inputValue: cutRow.cutLength,
            pieces: cutRow.pieces,
          })),
        });
      });
    });

    return { t0Batches, t1Batches };
  }, [boards, lc.cutLength, lc.rawSheets, lc.ripWidth, lc.sheets, lc.strips, lc.t1Strips, t0Sheets]);

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
      }
      .cut-plan-print-root table {
        width: 100% !important;
        max-width: 100% !important;
        border-collapse: collapse !important;
        font-size: 14px !important;
        table-layout: auto !important;
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
      .cut-plan-section h3 {
        break-after: avoid;
        page-break-after: avoid;
      }
      .cut-plan-section-t1 {
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

  const renderBatchTable = (batches: CutPlanBatch[], inputLabel: string) => (
    <div className="overflow-x-auto">
      <table className="w-full table-auto text-[12px]">
        <colgroup>
          <col style={{ width: "20%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "9%" }} />
        </colgroup>
        <thead>
          <tr className="bg-black/[0.03] border-b border-border/40">
            <th className="text-left py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.take}</th>
            <th className="text-center py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.stack}</th>
            <th className="text-right py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.totalLength}</th>
            <th className="text-right py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.width}</th>
            <th className="text-right py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.trim}</th>
            <th className="text-center py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.row}</th>
            <th className="text-right py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{inputLabel} (mm)</th>
            <th className="text-center py-2 px-1.5 font-semibold text-apple-gray whitespace-nowrap">{lc.pieces}</th>
          </tr>
        </thead>
        <tbody>
          {batches.flatMap((batch) =>
            batch.rows.map((row, rowIdx) => (
              <tr key={row.key} className={`border-b border-border/20 hover:bg-black/[0.01] ${rowIdx === 0 ? "cut-plan-batch-start" : ""}`}>
                {rowIdx === 0 && (
                  <>
                    <td rowSpan={batch.rows.length} className="py-2 px-1.5 align-top font-semibold whitespace-nowrap border-r border-border/20">
                      {batch.take}
                    </td>
                    <td rowSpan={batch.rows.length} className="py-2 px-1.5 align-top text-center whitespace-normal border-r border-border/20">
                      {batch.stackQty > 1 ? (
                        <span className="font-bold text-apple-red">
                          Stack {batch.stackQty} {batch.stackUnit}
                        </span>
                      ) : (
                        <span>1</span>
                      )}
                    </td>
                    <td rowSpan={batch.rows.length} className="py-2 px-1.5 align-top text-right font-mono whitespace-nowrap border-r border-border/20">
                      {fmt(batch.totalLength)}
                    </td>
                    <td rowSpan={batch.rows.length} className="py-2 px-1.5 align-top text-right font-mono whitespace-nowrap border-r border-border/20">
                      {fmt(batch.width)}
                    </td>
                    <td rowSpan={batch.rows.length} className="py-2 px-1.5 align-top text-right font-mono whitespace-nowrap border-r border-border/20">
                      {fmt(batch.trim)}
                    </td>
                  </>
                )}
                <td className="py-2 px-1.5 text-center text-apple-gray">{row.rowNo}</td>
                <td className="py-2 px-1.5 text-right font-mono">{fmt(row.inputValue)}</td>
                <td className="py-2 px-1.5 text-center">{row.pieces}</td>
              </tr>
            ))
          )}
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
          <span className="text-apple-gray font-medium leading-none">T0 48&quot; × 96&quot;</span>
          <span className="font-bold text-foreground leading-none">{t0Sheets.length}</span>
        </div>
        <div className="inline-flex h-5 items-center gap-2">
          <span className="text-apple-gray font-medium leading-none">T1 Strips</span>
          <span className="font-bold text-foreground leading-none">{boards.length}</span>
        </div>
        <div className="inline-flex h-5 items-center gap-2">
          <span className="text-apple-gray font-medium leading-none">T2 Parts</span>
          <span className="font-bold text-foreground leading-none">{boards.reduce((acc, b) => acc + (b.parts?.length || 0), 0)}</span>
        </div>
      </div>

      <div className="divide-y divide-border/40">
        {planBatches.t0Batches.length > 0 && (
          <section className="cut-plan-section">
            <div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100">
              <h3 className="text-[16px] font-bold text-slate-900">{lc.t0SectionTitle}</h3>
            </div>
            {renderBatchTable(planBatches.t0Batches, lc.ripWidth)}
          </section>
        )}

        <section className="cut-plan-section cut-plan-section-t1">
          <div className="px-4 py-3 bg-blue-50/50 border-b border-blue-100">
            <h3 className="text-[16px] font-bold text-slate-900">{lc.t1SectionTitle}</h3>
          </div>
          {renderBatchTable(planBatches.t1Batches, lc.cutLength)}
        </section>
      </div>
    </div>
  );
}
