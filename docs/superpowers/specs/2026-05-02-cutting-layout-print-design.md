# Cutting Layout Print — Design

**Date:** 2026-05-02
**Scope:** Order detail page (`frontend/src/app/order/[id]/`)

## Goal

Add print buttons to two views in the order detail page:

1. **Layout tab** (`viewMode === "layout"`) — print all board tiles + T0 sheet cards for the currently selected color, multi-page natural flow.
2. **BoardDetailModal** — print only the board visualization (no parts table).

A third change refactors the existing `MachineCutPlan.handlePrint` so all three print flows share one helper.

## Non-goals

- Print buttons for Table / Cabinets tabs.
- Multi-color combined print (single color only).
- Custom print layout — printed content mirrors the on-screen layout.
- Per-board page-break in Layout (boards flow naturally; each board is kept whole, but multiple boards per page is fine).

## Architecture

### Shared helper

New file: `frontend/src/app/order/[id]/components/printUtils.ts`

Exports:

```ts
openPrintWindow(opts: {
  title: string;          // window <title> + tab title
  lang: "zh" | "en" | "es";  // controls <html lang>
  contentNode: HTMLElement;  // node to clone into the print window
  extraCss?: string;         // optional injected <style>
}): void
```

Behavior:
1. `window.open("", "_blank", "width=900,height=1100")` — alert + return on popup-blocked.
2. Clone every `link[rel="stylesheet"]` and `<style>` from the current document into the popup `<head>` (so Tailwind utilities resolve).
3. Inject a base `<style>` block: same `:root` CSS custom properties, font stack, and `* { transition: none; animation: none; -webkit-print-color-adjust: exact; }` rules currently in `MachineCutPlan.handlePrint`.
4. Append a `print-container` wrapper to body, append the cloned `contentNode` inside it.
5. Append `extraCss` (if given) as the last `<style>` so per-caller rules override the base.
6. `setTimeout(() => pw.print(), 1000)`.

`MachineCutPlan.handlePrint` is refactored to call `openPrintWindow`, moving its per-call CSS (page-break rules, `.print-group-clone` font scaling, footer styles) into its `extraCss` argument.

### Layout tab print

**File:** `frontend/src/app/order/[id]/page.tsx`

UI:
- A "🖨 打印" button is added next to the existing layout-mode controls. Visible only when `viewMode === "layout" && !selectedHasLegacyMissingCutData && boards.length > 0`.
- Button has class `print-hidden` so it's removed from the cloned node in print.
- Uses `lucide-react` `Printer` icon (already imported on this file).

Print container marker:
- The outermost div of the layout view (the `<div className="flex flex-col w-full pt-8 pb-12 min-h-[60vh]">` returned by the `viewMode === "layout"` IIFE) gets a `data-print-layout` attribute and a `ref` so the handler can find it.

Handler `handlePrintLayout`:
- Find `[data-print-layout]` node, clone it.
- Strip all elements matching `.print-hidden`, `.machine-no-print` from the clone.
- Title: `"裁切布局 — {orderLabel}"` (locale-aware via existing `t()` — add new i18n key `orderDetail.printLayoutTitle`).
- `extraCss` for Layout:
  ```css
  @page { size: A3 landscape; margin: 8mm; }
  .print-container { padding: 0; }
  /* Each board stays intact */
  [data-board-tile], [data-t0-sheet-card] { page-break-inside: avoid; break-inside: avoid; }
  /* T1 / T0 section titles don't get orphaned at the bottom of a page */
  h3 { page-break-after: avoid; break-after: avoid; }
  ```
- Page size A3 landscape because BoardTile widths are tuned for desktop columns; A3 fits 3-4 tiles per row legibly. User can override in their browser print dialog.

DOM markers added:
- `BoardTile` root element — add `data-board-tile` attribute (in `BoardTile.tsx`).
- `T0SheetCard` root element — add `data-t0-sheet-card` attribute (in `T0SheetCard.tsx`).

### BoardDetailModal print

**File:** `frontend/src/app/order/[id]/components/BoardDetailModal.tsx`

UI:
- Add a `🖨` icon button in the modal header, immediately left of the close `X` button.
- Same `Printer` icon from `lucide-react`.

Print container marker:
- Wrap the existing visualization block (the `<div className="p-5 flex flex-col items-center justify-start ...">` containing the board canvas) with a `ref` and `data-print-board-vis` attribute. Do not include the parts table.

Handler `handlePrintBoardVis`:
- Clone the visualization node.
- Also clone the modal header `<div className="p-5 border-b ...">` (so `board_id`, board type, size, color label, parts/cuts count, and utilization % appear at the top of the print). Strip `.print-hidden` (the print + close buttons).
- Title: `"板材 {board.board_id} — {orderLabel?}"` — `orderLabel` is not currently passed into the modal; pass it as a new prop.
- `extraCss` for board vis:
  ```css
  @page { size: A4 landscape; margin: 10mm; }
  .print-container { padding: 0; }
  [data-print-board-vis] { page-break-inside: avoid; }
  ```
- Locale: pass current `locale` via `useLanguage()`.

### i18n

Add to `frontend/src/lib/i18n.tsx` translations dictionary:

| Key | zh | en | es |
|---|---|---|---|
| `orderDetail.printBtn` | 打印 | Print | Imprimir |
| `orderDetail.printLayoutTitle` | 裁切布局 | Cutting Layout | Plano de Corte |
| `orderDetail.printBoardTitle` | 板材 | Board | Tablero |

(If any of these keys already exist, reuse instead of adding.)

## Component changes summary

| File | Change |
|---|---|
| `components/printUtils.ts` | **NEW** — `openPrintWindow()` helper |
| `components/MachineCutPlan.tsx` | Refactor `handlePrint` to call `openPrintWindow` |
| `components/BoardTile.tsx` | Add `data-board-tile` to root element |
| `components/T0SheetCard.tsx` | Add `data-t0-sheet-card` to root element |
| `components/BoardDetailModal.tsx` | Add print button in header; add `data-print-board-vis` on visualization wrapper; accept new `orderLabel` prop; implement `handlePrintBoardVis` |
| `page.tsx` | Add print button on Layout view; add `data-print-layout` marker; implement `handlePrintLayout`; pass `orderLabel` to `BoardDetailModal` |
| `lib/i18n.tsx` | Add `orderDetail.printLayoutTitle`, `orderDetail.printBoardTitle` keys (and `orderDetail.printBtn` if missing) |

## Behavior / edge cases

- **Popup blocked** — `openPrintWindow` shows the same `alert("Popup blocked …")` `MachineCutPlan` already uses.
- **Empty Layout** — print button is hidden when `boards.length === 0` for the selected color (the existing `selectedHasLegacyMissingCutData` empty-state path).
- **Long part lists in modal** — not relevant: parts table is excluded from the print.
- **Stack badges, hover overlays in BoardTile** — these are part of the on-screen tile and will appear in print as-is. Acceptable per "printed content mirrors on-screen layout".
- **Cloned node references** — clone via `cloneNode(true)` then mutate the clone (remove `.print-hidden` children). Never mutate the live DOM.

## Testing

Manual verification (no automated tests for print flow):

1. Open an order, switch to Layout view, click 打印 → popup opens, browser print dialog shows multi-page A3 landscape preview, no board is split across pages.
2. Click any BoardTile → modal opens → click 🖨 → popup shows just the board visualization with header info, no parts table, A4 landscape.
3. Switch language to English / Español, repeat 1–2, verify titles are translated.
4. Verify Machine Cut Plan print still works after the refactor (regression check).
5. Verify `print-hidden` / `machine-no-print` elements (toolbar buttons, language switcher) do not appear in any print output.
