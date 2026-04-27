"use client";
import React, { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import type { Board, SizeColor, PatternNumbering, EngineeringGroup, CutResult, IntegrityIssue } from "./types";
import { colorLabel, DEFAULT_BOX_COLOR, useBoxColors } from "@/lib/box_colors";
import { useLanguage } from "@/lib/i18n";
import { SIZE_COLORS } from "./constants";
import { boardFingerprint, nominalStockWidthForBoard, parseBoardDims } from "./utils";
import { BoardTile } from "./BoardTile";
import { MachineCutErrorBoundary } from "./MachineCutErrorBoundary";

/** Convert 0-based index to number string: 0→"1", 1→"2" */
function indexToNumberStr(idx: number): string {
  return String(idx + 1);
}

function formatOrderInlineLabel(lang: "zh" | "en" | "es", orderNoLabel: string, orderLabel: string): string {
  if (!orderLabel) return "";
  return lang === "zh" ? `(${orderNoLabel}${orderLabel})` : `(${orderNoLabel} ${orderLabel})`;
}

/* ═══════════════════════════════════════════
   Machine Cut Plan i18n lookup (independent of app locale)
   ═══════════════════════════════════════════ */
const machineI18n: Record<string, Record<string, string>> = {
  zh: {
    tabLabel: "机台裁切方案",
    engineeringNo: "图纸",
    boardType: "板材型号",
    boardWidth: "宽度",
    totalLength: "总长度",
    trimSetting: "修边设置",
    sourceBoardCount: "板数",
    suggestedStack: "建议叠切",
    rowNo: "工程",
    cutLength: "裁切长度 (mm)",
    pieces: "件数",
    pieceCount: "片数",
    pieceCountHint: "表中为同一工程组内该裁切长度的总片数。",
    cutRowsMultiPatternHint: "本组含多种裁切组合，上表各行为全组合计。",
    perCutPieces: "片/刀",
    noStackReason: "各板裁切长度与片数组合不同，无法叠切；请分板按序加工。",
    widthRipBody:
      "板型原料宽约 {stock} mm，本工程条宽 {target} mm。除下表裁切长度方向下刀外，尚需纵裁（裁宽）至目标条宽；先长后宽或先宽后长由车间自定。",
    widthRipBadge: "需裁宽",
    notes: "备注",
    operatorNote1: "本工程组已匹配固定板材宽度，操作员只需输入裁切长度和数量。",
    operatorNote2: "上板 → 先修边 5mm → 再按下表裁切。",
    printBtn: "打印",
    printTitle: "机台裁切方案",
    orderNo: "订单号",
    operator: "操作员",
    firstPieceCheck: "首件检查",
    completionCheck: "完工检查",
    printNotes: "备注",
    stackBatch: "批次",
    stackSize: "张/叠",
    stackBoards: "覆盖板数",
    stackSequence: "裁切顺序",
    stackSuggestions: "叠切建议",
    noData: "暂无裁切数据。",
    sheetsUnit: "张",
    mm: "mm",
    step1Title: "Step 1：机器设定",
    step1Desc1: "请确认板材型号为",
    step1Desc2: "，并在机器上输入总长度",
    step1Desc3: "，宽度",
    step1Desc4: "，修边设置",
    stepCutTitle: "Step {stepNum}：{patternNo}",
    stepCutDescFirst: "请取 {count} 张板材进行裁切。单次裁切数量已按单板生成（人工叠切时，机器端只需按此表输入，机器就会自动切出对应倍数的成品）：",
    stepCutDescNext: "请继续取 {count} 张板材进行 {patternNo} 的裁切。机器的总长度和宽度无需更改，请清除之前数据，重新从序号 1 开始输入：",
    boardWord: "板材",
    singleSheet: "1 张",
    stackBadge: "叠切 x{n}",
    color: "颜色",
  },
  en: {
    tabLabel: "Machine Cut Plan",
    engineeringNo: "Pattern",
    boardType: "Board Type",
    boardWidth: "Width",
    totalLength: "Total Length",
    trimSetting: "Trim Setting",
    sourceBoardCount: "Boards",
    suggestedStack: "Suggested Stack",
    rowNo: "Engineering",
    cutLength: "Cut Length (mm)",
    pieces: "Pieces",
    pieceCount: "Pieces",
    pieceCountHint: "Totals for this engineering group at each cut length.",
    cutRowsMultiPatternHint: "This group has multiple cut patterns; rows are combined totals.",
    perCutPieces: "pcs/cut",
    noStackReason: "Boards differ in cut lengths/counts — cannot stack; cut separately.",
    widthRipBody:
      "Nominal stock width ≈ {stock} mm, target strip {target} mm. Besides length cuts in the table, rip to strip width; cut order is shop-specific.",
    widthRipBadge: "Rip width",
    notes: "Notes",
    operatorNote1: "This engineering group uses a fixed board width. The operator only needs to input cut lengths and quantities.",
    operatorNote2: "Load board → Trim 5mm first → Then cut according to the table below.",
    printBtn: "Print",
    printTitle: "Machine Cut Plan",
    orderNo: "Order No.",
    operator: "Operator",
    firstPieceCheck: "First Piece Check",
    completionCheck: "Completion Check",
    printNotes: "Notes",
    stackBatch: "Batch",
    stackSize: "sheets/stack",
    stackBoards: "Covers Boards",
    stackSequence: "Cut Sequence",
    stackSuggestions: "Stack Suggestions",
    noData: "No cut data available.",
    sheetsUnit: "sheets",
    mm: "mm",
    step1Title: "Step 1: Machine Setup",
    step1Desc1: "Please confirm board type is",
    step1Desc2: ", and input Total Length",
    step1Desc3: ", Width",
    step1Desc4: ", Trim Setting",
    stepCutTitle: "Step {stepNum}: {patternNo}",
    stepCutDescFirst: "Take {count} board(s) for cutting. Piece counts below are for a single board (if you stack boards manually, input these exact numbers into the machine):",
    stepCutDescNext: "Take the next {count} board(s) for {patternNo}. Total Length and Width do not need to be changed. Clear previous data and restart from Row 1:",
    boardWord: "Board",
    singleSheet: "1 Sheet",
    stackBadge: "Stack x{n}",
    color: "Color",
  },
  es: {
    tabLabel: "Plan de Corte de Máquina",
    engineeringNo: "Patrón",
    boardType: "Tipo de Tablero",
    boardWidth: "Ancho",
    totalLength: "Longitud Total",
    trimSetting: "Ajuste de Recorte",
    sourceBoardCount: "Tableros",
    suggestedStack: "Apilado Sugerido",
    rowNo: "Ingeniería",
    cutLength: "Longitud de Corte (mm)",
    pieces: "Piezas",
    pieceCount: "Piezas",
    pieceCountHint: "Totales del grupo de ingeniería por longitud de corte.",
    cutRowsMultiPatternHint: "Varios patrones de corte en el grupo; la tabla muestra totales combinados.",
    perCutPieces: "pzs/corte",
    noStackReason: "Los tableros difieren en cortes — no apilar; cortar por separado.",
    widthRipBody:
      "Ancho nominal de stock ≈ {stock} mm, tira objetivo {target} mm. Además de los cortes en longitud, ripado al ancho de tira; el orden lo define el taller.",
    widthRipBadge: "Rip ancho",
    notes: "Notas",
    operatorNote1: "Este grupo de ingeniería usa un ancho fijo. El operador solo necesita ingresar longitudes y cantidades.",
    operatorNote2: "Cargar tablero → Recortar 5mm primero → Luego cortar según la tabla.",
    printBtn: "Imprimir",
    printTitle: "Plan de Corte de Máquina",
    orderNo: "No. de Pedido",
    operator: "Operador",
    firstPieceCheck: "Verificación Primera Pieza",
    completionCheck: "Verificación Final",
    printNotes: "Notas",
    stackBatch: "Lote",
    stackSize: "hojas/pila",
    stackBoards: "Tableros Cubiertos",
    stackSequence: "Secuencia de Corte",
    stackSuggestions: "Sugerencias de Apilado",
    noData: "No hay datos de corte.",
    sheetsUnit: "hojas",
    mm: "mm",
    step1Title: "Paso 1: Configuración de Máquina",
    step1Desc1: "Confirme el tipo de tablero",
    step1Desc2: ", e ingrese Longitud Total",
    step1Desc3: ", Ancho",
    step1Desc4: ", Ajuste Recorte",
    stepCutTitle: "Paso {stepNum}: {patternNo}",
    stepCutDescFirst: "Tome {count} tablero(s). Las cantidades son por tablero único (si apila, ingrese estos mismos números):",
    stepCutDescNext: "Tome {count} tablero(s) para {patternNo}. Longitud y Ancho no cambian. Limpie datos y reinicie de Fila 1:",
    boardWord: "Tablero",
    singleSheet: "1 Hoja",
    stackBadge: "Apilado x{n}",
    color: "Color",
  },
};

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
  '-apple-system',
  "BlinkMacSystemFont",
  '"SF Pro Text"',
  '"Segoe UI"',
  '"Helvetica Neue"',
  "Arial",
  "sans-serif",
].join(", ");

export function MachineCutPlan({ boards, orderLabel, machineLang, setMachineLang, patternNumbering, cutResult }: { boards: Board[], orderLabel: string, machineLang: "zh" | "en" | "es", setMachineLang: (l: "zh" | "en" | "es") => void, patternNumbering: { byIndex: Record<number, number>; byFingerprint: Record<string, number>; total: number }, cutResult?: CutResult | null }) {
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
  const mt = (key: string) => machineI18n[machineLang]?.[key] || machineI18n.en[key] || key;

  /* ── Parse board_size → { totalLength } ── */
  const parseTotalLength = (bs: string): number => {
    const m = bs.match(/([\d.]+)\s*[×x*]\s*([\d.]+)/i);
    if (m) return parseFloat(m[2]);
    console.warn("[MachineCutPlan] board_size unparsable, falling back to 2438.4", bs);
    return 2438.4;
  };

  /* ── Build engineering groups: group by strip_width AND board type ── */
  const engineeringGroups = useMemo<EngineeringGroup[]>(() => {
    // Group boards by strip_width AND board type AND board size to prevent mixing different sheet types/sizes
    const groupMap: Record<string, Board[]> = {};
    for (const b of boards) {
      const w = b.strip_width || 0;
      const color = b.color || DEFAULT_BOX_COLOR;
      const key = `${color}|||${w}|||${b.board}|||${b.board_size}`;
      if (!groupMap[key]) groupMap[key] = [];
      groupMap[key].push(b);
    }

    // Sort by width descending so wider groups appear first, then by board type
    return Object.entries(groupMap)
      .sort(([keyA, boardsA], [keyB, boardsB]) => {
        // T1 boards first
        const typeA = boardsA[0]?.board || "";
        const typeB = boardsB[0]?.board || "";
        const isT1A = typeA.toUpperCase().includes("T1");
        const isT1B = typeB.toUpperCase().includes("T1");
        if (isT1A !== isT1B) return isT1A ? -1 : 1;

        const wA = parseFloat(keyA.split("|||")[1]);
        const wB = parseFloat(keyB.split("|||")[1]);

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
      .map(([key, grpBoards], idx) => {
      const color = key.split("|||")[0] || DEFAULT_BOX_COLOR;
      const width = parseFloat(key.split("|||")[1]);
      const sample = grpBoards[0];
      const totalLength = parseTotalLength(sample.board_size);
      const trimSetting = 5;

      // Collect all distinct board type names for the header (should just be one now)
      const boardTypes = [...new Set(grpBoards.map(b => b.board))];
      const boardType = boardTypes.join(" / ");

      // Group boards by cut patterns
      const fpMap: Record<string, Board[]> = {};
      for (const b of grpBoards) {
        const fp = boardFingerprint(b);
        if (!fpMap[fp]) fpMap[fp] = [];
        fpMap[fp].push(b);
      }
      
      const patterns = Object.values(fpMap).flatMap((boardsOfPattern) => {
        const sampleBoard = boardsOfPattern[0];
        const cutMap: Record<number, number> = {};
        for (const p of sampleBoard.parts) {
          const cl = p.cut_length || p.Height;
          cutMap[cl] = (cutMap[cl] || 0) + 1;
        }
        const cutRows = Object.entries(cutMap)
          .map(([len, qty]) => ({ cutLength: parseFloat(len), pieces: qty }))
          .sort((a, b) => a.cutLength - b.cutLength);

        const chunks = [];
        for (let i = 0; i < boardsOfPattern.length; i += 4) {
          chunks.push({
            sampleBoard,
            boardCount: boardsOfPattern.slice(i, i + 4).length,
            cutRows,
          });
        }
        return chunks;
      });
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
      const typeSet = new Set(grpBoards.map((b) => b.board));
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
        key: `${color}-w${width}`,
        engNo: idx + 1,
        color,
        boardType,
        boardWidth: width,
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
    });
  }, [boards, machineLang]);

  /* ── Build a dedicated print window: clone actual DOM for pixel-perfect color output ── */
  const handlePrint = () => {
    const printLang = machineLang === "zh" ? "zh-CN" : machineLang === "es" ? "es" : "en";
    const pw = window.open("", "_blank", "width=900,height=1100");
    if (!pw) { alert("Popup blocked — please allow popups for printing."); return; }
    const printOrderInline = formatOrderInlineLabel(machineLang, mt("orderNo"), orderLabel);

    /* 1. Copy ALL stylesheets from the current page so Tailwind classes resolve
       for BOTH layout (display, flex, padding, etc.) AND visuals (color, bg, etc.) */
    const styleSheets = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((el) => el.cloneNode(true) as HTMLElement);

    /* 2. Build one page per engineering group by cloning the rendered group DOM */
    const pageContainer = document.createElement("div");

    const totalPages = engineeringGroups.length;

    for (const [pageIdx, grp] of engineeringGroups.entries()) {
      const groupEl = document.querySelector(`[data-print-group="${grp.engNo}"]`);
      if (!groupEl) continue;

      const page = document.createElement("div");
      page.className = "print-page";

      const groupClone = groupEl.cloneNode(true) as HTMLElement;
      groupClone.classList.add("print-group-clone");
      const titleEl = groupClone.querySelector("[data-print-group-title]");
      if (titleEl) {
        titleEl.textContent = `${mt("engineeringNo")} ${grp.engNo}${printOrderInline}`;
      }
      page.appendChild(groupClone);

      const footer = document.createElement("div");
      footer.className = "print-page-footer";
      footer.textContent = `${pageIdx + 1}/${totalPages}`;
      page.appendChild(footer);

      pageContainer.appendChild(page);
    }

    /* 3. Write the document shell */
    pw.document.open();
    pw.document.write(`<!DOCTYPE html><html lang="${printLang}"><head><meta charset="utf-8">
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <title>${mt("printTitle")} — ${orderLabel}</title></head><body></body></html>`);
    pw.document.close();

    /* 4. Inject all copied stylesheets (Tailwind utility CSS for layout + visuals) */
    for (const ss of styleSheets) {
      pw.document.head.appendChild(ss);
    }

    /* 5. Inject CSS custom properties (@theme values) + print page styles.
       Tailwind v4 @theme vars may not survive the stylesheet copy, so we
       define them explicitly to guarantee text/color visibility. */
    const printStyle = pw.document.createElement("style");
    printStyle.textContent = `
      /* ── Replicate @theme CSS custom properties ── */
      :root {
        --color-background: #f5f5f7;
        --color-foreground: #1d1d1f;
        --color-card: #ffffff;
        --color-card-hover: #fbfbfc;
        --color-border: #e5e5ea;
        --color-apple-blue: #0071e3;
        --color-apple-green: #34c759;
        --color-apple-orange: #ff9500;
        --color-apple-red: #ff3b30;
        --color-apple-gray: #86868b;
        --font-sans: ${PRINT_FONT_STACK};
        --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
        --shadow-apple: 0 2px 12px rgba(0,0,0,0.03), 0 4px 24px rgba(0,0,0,0.03);
      }

      html,
      body {
        font-family: var(--font-sans);
        color: var(--color-foreground);
        margin: 0; padding: 0;
        background: white;
        text-rendering: geometricPrecision;
      }

      body, div, span, p, table, thead, tbody, tr, th, td, h1, h2, h3, h4, strong {
        font-family: var(--font-sans);
      }

      .print-page {
        width: 100%;
        min-height: 100vh;
        padding: 4mm 5mm 3mm;
        display: flex;
        flex-direction: column;
        page-break-after: always;
        break-after: page;
        box-sizing: border-box;
      }
      .print-page:last-child { page-break-after: auto; break-after: auto; }
      table { page-break-inside: avoid; }

      .print-group-clone {
        box-shadow: none !important;
        border-radius: 0 !important;
        overflow: visible !important;
        flex: 1 1 auto;
      }

      .print-group-clone [data-print-tiles-wrap] {
        overflow: visible !important;
        padding: 8px 12px !important;
      }

      .print-group-clone [data-print-group-header] {
        padding: 8px 12px !important;
      }

      .print-group-clone [data-print-content] {
        padding: 10px 12px !important;
      }

      .print-group-clone [data-print-content] > * + * {
        margin-top: 10px !important;
      }

      .print-group-clone [data-print-setup] h4,
      .print-group-clone [data-print-step-title] {
        margin-bottom: 4px !important;
      }

      .print-group-clone [data-print-setup-box],
      .print-group-clone [data-print-step-box] {
        padding: 10px 12px !important;
        border-radius: 10px !important;
      }

      .print-group-clone [data-print-step-header] {
        margin-bottom: 4px !important;
      }

      .print-group-clone [data-print-tiles-row] {
        min-width: 0 !important;
        flex-wrap: wrap !important;
        gap: 10px !important;
        padding-bottom: 0 !important;
      }

      .print-page-footer {
        margin-top: auto;
        padding-top: 2mm;
        text-align: right;
        font-size: 10px;
        color: #64748b;
      }

      /* Disable hover & transition animations in print */
      * {
        transition: none !important;
        animation: none !important;
        box-shadow: none !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }

      @media print {
        @page { size: A4; margin: 6mm 5mm; }
        .print-page { padding: 0; min-height: auto; }
      }
    `;
    pw.document.head.appendChild(printStyle);

    /* 6. Append all pages into the popup body */
    pw.document.body.appendChild(pageContainer);

    /* 7. Trigger print after stylesheets load */
    setTimeout(() => { try { pw.print(); } catch {} }, 1000);
  };

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
  }, [cutResult]);
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

        {(engineeringGroups as (EngineeringGroup & { inconsistent?: boolean })[]).map((grp) => (
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

            {/* TOP ROW: Cut Layout Images ONLY */}
            <div data-print-tiles-wrap={grp.engNo} className="p-5 border-b border-border/40 bg-slate-50/50">
              <div data-print-tiles-row={grp.engNo} className="flex flex-wrap gap-6 pb-2">
                {grp.patterns.map((pattern, pIdx) => {
                  const numLabel = indexToNumberStr(pIdx);
                  const nw = nominalStockWidthForBoard(pattern.sampleBoard);
                  const patternNeedsRip = nw != null && (nw - grp.boardWidth > 0.5);
                  
                  const stackBadge = pattern.boardCount > 1 && (
                    <span data-print-board-count className="ml-2 text-[11px] font-semibold text-blue-700">
                      ×{pattern.boardCount}
                    </span>
                  );

                  const patternLabel = `${mt("boardWord")} ${numLabel}`;

                  if (patternNeedsRip) {
                    return (
                      <div key={`${pIdx}-combined`} data-print-tile={`${grp.engNo}-${pIdx}`} className="flex flex-col items-center gap-2">
                        <div className="flex items-center">
                          <span className="text-[13px] font-bold text-slate-700">{`${mt("boardWord")} ${numLabel}-1`}</span>
                          <span className="mx-1 text-slate-300">→</span>
                          <span className="text-[13px] font-bold text-slate-700">{`${mt("boardWord")} ${numLabel}-2`}</span>
                          {stackBadge}
                        </div>
                        <div className="flex gap-4 items-end">
                          {/* Step 1: Width rip (rotated, full board) */}
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-slate-400 font-medium">{mt("widthRipBadge")}</span>
                            <BoardTile 
                              board={pattern.sampleBoard}
                              index={pIdx}
                              color={{ bg: "#fad2a4", border: "#f47820", text: "#c2410c", light: "#ffffff" }}
                              stackInfo={{ groupSize: pattern.boardCount, stackOf: pattern.boardCount, isLeader: true }}
                              onClick={() => {}}
                              disableHover={true}
                              isRotated={true}
                              hideUtilization={true}
                              showDimensions={true}
                              hideStackBadge={true}
                              hidePreviousStripShade={true}
                            />
                          </div>
                          {/* Arrow between steps */}
                          <div className="flex items-center pb-8 text-slate-300">
                            <span className="text-[18px]">→</span>
                          </div>
                          {/* Step 2: Cross-cut (not rotated, width waste removed) */}
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-slate-400 font-medium">{mt("cutLength").split(" ")[0]}</span>
                            <BoardTile 
                              board={pattern.sampleBoard}
                              index={pIdx}
                              color={{ bg: "#fad2a4", border: "#f47820", text: "#c2410c", light: "#ffffff" }}
                              stackInfo={{ groupSize: pattern.boardCount, stackOf: pattern.boardCount, isLeader: true }}
                              onClick={() => {}}
                              disableHover={true}
                              hideWidthWaste={true}
                              isRotated={false}
                              hideUtilization={true}
                              showDimensions={true}
                              hideStackBadge={true}
                              hidePreviousStripShade={true}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <div key={`${pIdx}-final`} data-print-tile={`${grp.engNo}-${pIdx}`} className="flex flex-col items-center gap-2">
                        <div className="flex items-center">
                          <span className="text-[13px] font-bold text-slate-700">{patternLabel}</span>
                          {stackBadge}
                        </div>
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
                        />
                      </div>
                    );
                  }
                })}
              </div>
            </div>

            {/* CONTENT SECTION */}
            <div data-print-content className="p-5 space-y-6">
              {/* Step 1: Machine Setup */}
              <div data-print-setup={grp.engNo}>
                <h4 data-print-step-title className="text-[15px] font-bold text-slate-800 mb-2">{mt("step1Title")}</h4>
                <div data-print-setup-box className="text-[13px] text-slate-600 bg-black/[0.02] p-4 rounded-xl border border-black/[0.05]">
                  <p>
                    {mt("step1Desc1")} <strong className="text-black font-semibold">{grp.boardType}</strong>{mt("step1Desc2")} <strong className="text-black font-semibold">{grp.totalLength} mm</strong>{mt("step1Desc3")} <strong className="text-black font-semibold">{grp.boardWidth} mm</strong>{mt("step1Desc4")} <strong className="text-black font-semibold">{grp.trimSetting} mm</strong>。
                  </p>
                  {grp.needsWidthRip && grp.ripStockWidthMm != null && (
                    <div className="mt-3 bg-white p-3 rounded-xl border border-border/60">

                      <table className="w-full text-[13px] rounded-lg overflow-hidden border border-border/40">
                        <thead>
                          <tr className="bg-black/[0.03] border-b border-border/40">
                            <th className="text-center py-2 px-4 font-semibold text-apple-gray w-24">{mt("rowNo")}</th>
                            <th className="text-center py-2 px-4 font-semibold text-apple-gray w-48">{mt("cutLength")}</th>
                            <th className="text-center py-2 px-4 font-semibold text-apple-gray w-36">{mt("pieceCount")}</th>
                            <th className="py-2 px-4"></th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="hover:bg-black/[0.01]">
                            <td className="text-center py-2.5 px-4 text-apple-gray">1</td>
                            <td className="text-center py-2.5 px-4 font-mono text-[15px]">{grp.boardWidth}</td>
                            <td className="text-center py-2.5 px-4 text-[15px]">1</td>
                            <td className="py-2.5 px-4"></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 2+: Cutting steps */}
              {grp.patterns.map((pattern, pIdx) => {
                const stepNum = pIdx + 2;
                const numLabel = indexToNumberStr(pIdx);
                
                const nw = nominalStockWidthForBoard(pattern.sampleBoard);
                const patternNeedsRip = nw != null && (nw - grp.boardWidth > 0.5);
                
                const boardLabel = `${mt("boardWord")} ${numLabel}`;
                
                const badgeText = pattern.boardCount === 1
                  ? mt("singleSheet")
                  : `${pattern.boardCount} ${mt("sheetsUnit")}`;

                return (
                  <div key={pIdx} data-print-step={`${grp.engNo}-${pIdx}`}>
                    <div data-print-step-header className="mb-2">
                      <h4 data-print-step-title className="text-[15px] font-bold text-slate-800">
                        {mt("stepCutTitle").replace("{stepNum}", String(stepNum)).replace("{patternNo}", boardLabel)}
                        <span data-print-board-count className="ml-3 text-[14px] font-semibold text-red-600 align-baseline">
                          {badgeText}
                        </span>
                      </h4>
                    </div>
                    <div data-print-step-box className="bg-blue-50/40 p-4 rounded-xl border border-blue-100">
                      
                      <div className="overflow-x-auto">
                        <table className="w-full text-[13px] bg-white rounded-lg overflow-hidden border border-border/40">
                          <thead>
                            <tr className="bg-black/[0.03] border-b border-border/40">
                              <th className="text-center py-3 px-4 font-semibold text-apple-gray w-24">{mt("rowNo")}</th>
                              <th className="text-center py-3 px-4 font-semibold text-apple-gray w-48">{mt("cutLength")}</th>
                              <th className="text-center py-3 px-4 font-semibold text-apple-gray w-36">{mt("pieceCount")}</th>
                              <th className="py-3 px-4"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {pattern.cutRows.map((row, ri) => (
                              <tr key={ri} className="border-b border-border/10 last:border-0 hover:bg-black/[0.01]">
                                <td className="text-center py-2.5 px-4 text-apple-gray">{ri + 1}</td>
                                <td className="text-center py-2.5 px-4 font-mono text-[15px]">{row.cutLength}</td>
                                <td className="text-center py-2.5 px-4 text-[15px]">{row.pieces}</td>
                                <td className="py-2.5 px-4"></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
          </MachineCutErrorBoundary>
        ))}
      </div>
    </MachineCutErrorBoundary>
  );
}
