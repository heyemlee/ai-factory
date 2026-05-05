import type { Board, EngineeringGroup } from "./types";
import { PRINT_FONT_STACK, type MachineLanguage } from "./machineCutPlanCopy";
import { formatOrderInlineLabel, type MachineT0Sheet } from "./machineCutPlanModel";

export type MachineDisplayGroup = EngineeringGroup & {
  displayBoards: Board[];
  displayT0Sheets: MachineT0Sheet[];
};

interface OpenMachineCutPrintWindowArgs {
  displayGroups: MachineDisplayGroup[];
  machineLang: MachineLanguage;
  orderLabel: string;
  mt: (key: string) => string;
}

export function openMachineCutPrintWindow({ displayGroups, machineLang, orderLabel, mt }: OpenMachineCutPrintWindowArgs) {
    const printLang = machineLang === "zh" ? "zh-CN" : machineLang === "es" ? "es" : "en";
    const pw = window.open("", "_blank", "width=900,height=1100");
    if (!pw) { alert("Popup blocked — please allow popups for printing."); return; }
    const printOrderInline = formatOrderInlineLabel(machineLang, mt("orderNo"), orderLabel);

    /* 1. Copy ALL stylesheets from the current page so Tailwind classes resolve
       for BOTH layout (display, flex, padding, etc.) AND visuals (color, bg, etc.) */
    const styleSheets = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((el) => el.cloneNode(true) as HTMLElement);

    /* 2. Build a continuous layout — page breaks between groups, not forced per-group pages.
       This ensures content (header + Step A) flows together on the first page. */
    const pageContainer = document.createElement("div");
    pageContainer.className = "print-container";

    const totalGroups = displayGroups.length;
    let renderedCount = 0;

    for (const grp of displayGroups) {
      const groupEl = document.querySelector(`[data-print-group="${grp.engNo}"]`);
      if (!groupEl) continue;

      const groupClone = groupEl.cloneNode(true) as HTMLElement;
      groupClone.classList.add("print-group-clone");

      // Add page break before each group EXCEPT the first
      if (renderedCount > 0) {
        groupClone.style.pageBreakBefore = "always";
        (groupClone.style as unknown as Record<string, string>)["breakBefore"] = "page";
      }

      const titleEl = groupClone.querySelector("[data-print-group-title]");
      if (titleEl) {
        titleEl.textContent = `${mt("engineeringNo")} ${grp.engNo}${printOrderInline}`;
      }

      // Append a footer inside the group clone
      const footer = document.createElement("div");
      footer.className = "print-page-footer";
      renderedCount += 1;
      footer.textContent = `${renderedCount}/${totalGroups}`;
      groupClone.appendChild(footer);

      pageContainer.appendChild(groupClone);
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

      .print-container {
        padding: 4mm 5mm 3mm;
      }

      .print-group-clone {
        box-shadow: none !important;
        border-radius: 0 !important;
        overflow: visible !important;
        font-size: 18px !important;
      }

      /* Scale up all text in print for readability */
      .print-group-clone h3 {
        font-size: 26px !important;
      }
      .print-group-clone h4 {
        font-size: 22px !important;
      }
      .print-group-clone h5 {
        font-size: 20px !important;
      }
      .print-group-clone h6 {
        font-size: 18px !important;
      }
      .print-group-clone p,
      .print-group-clone span,
      .print-group-clone div {
        font-size: inherit;
      }
      .print-group-clone table {
        font-size: 18px !important;
      }
      .print-group-clone th {
        font-size: 16px !important;
        padding: 12px 14px !important;
      }
      .print-group-clone td {
        font-size: 20px !important;
        padding: 10px 14px !important;
      }
      .print-group-clone [data-print-board-count] {
        font-size: 19px !important;
      }

      table { page-break-inside: avoid; }

      /* Keep individual diagrams (T0SheetCard, BoardTile layout box) together.
         If a diagram would split across pages, push it to the next page instead. */
      .print-group-clone [data-print-keep],
      .print-group-clone [data-print-substep="setup"],
      .print-group-clone [data-print-substep="input"] {
        page-break-inside: avoid;
        break-inside: avoid;
      }
      /* Phase title must stay attached to its first sub-flow — never end a page on a bare phase heading. */
      .print-group-clone [data-print-phase] > h4,
      .print-group-clone [data-print-step-title] {
        page-break-after: avoid;
        break-after: avoid;
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

      .print-group-clone [data-print-step-title] {
        margin-bottom: 4px !important;
      }

      .print-group-clone [data-print-substep] {
        padding: 10px 12px !important;
        border-radius: 10px !important;
      }

      .print-group-clone [data-print-step-header] {
        margin-bottom: 4px !important;
      }

      .print-page-footer {
        margin-top: 12px;
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
        .print-container { padding: 0; }
      }
    `;
    pw.document.head.appendChild(printStyle);

    /* 6. Append all pages into the popup body */
    pw.document.body.appendChild(pageContainer);

    /* 7. Trigger print after stylesheets load */
    setTimeout(() => { try { pw.print(); } catch {} }, 1000);
}
