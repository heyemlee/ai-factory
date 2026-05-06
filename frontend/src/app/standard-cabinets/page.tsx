"use client";

import type { ReactNode } from "react";
import { useMemo, useState, Fragment, useEffect } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Layers3,
  Search,
  Send,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import readXlsxFile from "read-excel-file/browser";
import writeXlsxFile from "write-excel-file/browser";
import type { SheetData } from "write-excel-file/browser";
import {
  CabinetCatalogRecord,
  cabinetCatalog,
  cabinetCategories,
  resolveCabinetDimensions,
} from "@/lib/cabinet_catalog";
import { submitOrder, UploadSettings } from "@/lib/order_actions";
import CutSettingsModal from "@/features/orders/components/CutSettingsModal";

type ResolvedOrderStatus = "ready" | "skip" | "error";

interface ResolvedOrderRow {
  rowNumber: number;
  abcItem: string;
  width: number | "";
  height: number | "";
  depth: number | "";
  qty: number;
  adjustableShelfQty: number;
  fixedShelfQty: number;
  boxColor: string;
  type: string;
  source: string;
  status: ResolvedOrderStatus;
  message: string;
}

function formatInches(value: number | null) {
  if (value === null) return "N/A";
  return `${Number.isInteger(value) ? value : Number(value.toFixed(3))}"`;
}

function formatQty(value: number | null) {
  return value === null ? "N/A" : String(value);
}

function formatMoney(value: number | null) {
  if (value === null) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function shelvesTotal(record: CabinetCatalogRecord) {
  return (record.adjustableShelfQty ?? 0) + (record.fixedShelfQty ?? 0);
}

function formatNumber(value: number | null) {
  if (value === null) return "N/A";
  return String(Number(value.toFixed(2)));
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[\s"'._-]+/g, "");
}

function readCell(row: Record<string, unknown>, aliases: string[]) {
  const wanted = new Set(aliases.map(normalizeHeader));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normalizeHeader(key))) return value;
  }
  return "";
}

function asText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asQty(value: unknown) {
  const parsed = Number(asText(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.max(1, Math.floor(parsed));
}

function asOptionalNumber(value: unknown) {
  const text = asText(value);
  if (!text) return { hasValue: false, value: null };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { hasValue: false, value: null };
  return { hasValue: true, value: parsed };
}

function displayDimension(value: number | "") {
  return value === "" ? "N/A" : value;
}

function resolveOrderRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row, index): ResolvedOrderRow => {
      const abcItem = asText(readCell(row, ["ABC Item", "ABCItem", "Item", "SKU"]));
      const qty = asQty(readCell(row, ["Qty", "Quantity", "Count", "数量"]));
      const boxColor = asText(readCell(row, ["Box Color", "BoxColor", "Color", "颜色", "箱体颜色"])) || "WhiteBirch";
      const inputWidth = asOptionalNumber(readCell(row, ["W", "W\"", "Width", "宽", "宽度"]));
      const inputHeight = asOptionalNumber(readCell(row, ["H", "H\"", "Height", "高", "高度"]));
      const inputDepth = asOptionalNumber(readCell(row, ["D", "D\"", "Depth", "深", "深度"]));

      if (!abcItem) {
        return {
          rowNumber: index + 2,
          abcItem: "",
          width: "",
          height: "",
          depth: "",
          qty,
          adjustableShelfQty: 0,
          fixedShelfQty: 0,
          boxColor,
          type: "",
          source: "",
          status: "error",
          message: "Missing ABC Item",
        };
      }

      if (inputDepth.hasValue && inputDepth.value === 0) {
        return {
          rowNumber: index + 2,
          abcItem,
          width: inputWidth.value ?? "",
          height: inputHeight.value ?? "",
          depth: 0,
          qty,
          adjustableShelfQty: 0,
          fixedShelfQty: 0,
          boxColor,
          type: "skip",
          source: "input",
          status: "skip",
          message: "D=0",
        };
      }

      const resolution = resolveCabinetDimensions(abcItem);
      if (!resolution.resolved) {
        return {
          rowNumber: index + 2,
          abcItem: resolution.normalizedItem || abcItem,
          width: "",
          height: "",
          depth: "",
          qty,
          adjustableShelfQty: 0,
          fixedShelfQty: 0,
          boxColor,
          type: "",
          source: "",
          status: "error",
          message: resolution.error,
        };
      }

      return {
        rowNumber: index + 2,
        abcItem: resolution.abcItem,
        width: inputWidth.value ?? resolution.width,
        height: inputHeight.value ?? resolution.height,
        depth: inputDepth.value ?? resolution.depth ?? "",
        qty,
        adjustableShelfQty: resolution.record?.adjustableShelfQty ?? 0,
        fixedShelfQty: resolution.record?.fixedShelfQty ?? 0,
        boxColor,
        type: resolution.type ?? "",
        source: resolution.source,
        status: resolution.type === "skip" ? "skip" : "ready",
        message: resolution.type === "skip" ? "Non-cabinet item" : "",
      };
    })
    .filter((row) => row.abcItem || row.status === "error");
}

function toExportRows(rows: ResolvedOrderRow[]) {
  return rows.map((row) => ({
    "ABC Item": row.abcItem,
    W: row.width,
    H: row.height,
    D: row.depth,
    Qty: row.qty,
    "Adjustable Shelf Qty": row.adjustableShelfQty,
    "Fixed Shelf Qty": row.fixedShelfQty,
    "Box Color": row.boxColor,
    Type: row.type,
  }));
}

const RESOLVED_SHEET_HEADERS = [
  "ABC Item",
  "W",
  "H",
  "D",
  "Qty",
  "Adjustable Shelf Qty",
  "Fixed Shelf Qty",
  "Box Color",
  "Type",
];

const RESOLVED_SHEET_COLUMNS = [
  { width: 18 },
  { width: 8 },
  { width: 8 },
  { width: 8 },
  { width: 8 },
  { width: 22 },
  { width: 18 },
  { width: 16 },
  { width: 10 },
];

const CATALOG_EXPORT_COLUMNS: Array<{
  header: string;
  width: number;
  value: (record: CabinetCatalogRecord) => string | number | null;
}> = [
  { header: "Category", width: 24, value: (record) => record.category },
  { header: "ABC Item", width: 18, value: (record) => record.abcItem },
  { header: "Type", width: 10, value: (record) => record.type },
  { header: "W", width: 8, value: (record) => record.width },
  { header: "H", width: 8, value: (record) => record.height },
  { header: "D", width: 8, value: (record) => record.depth },
  { header: "List Price", width: 12, value: (record) => record.listPrice },
  { header: "Door Qty", width: 10, value: (record) => record.doorQty },
  { header: "Hinge Qty", width: 11, value: (record) => record.hingeQty },
  { header: "Adjustable Shelf Qty", width: 22, value: (record) => record.adjustableShelfQty },
  { header: "Fixed Shelf Qty", width: 18, value: (record) => record.fixedShelfQty },
  { header: "Drawer Qty", width: 11, value: (record) => record.drawerQty },
  { header: "Door Plank Area", width: 17, value: (record) => record.doorPlankArea },
  { header: "Left Panel Area", width: 17, value: (record) => record.leftPanelArea },
  { header: "Right Panel Area", width: 18, value: (record) => record.rightPanelArea },
  { header: "Top Panel Area", width: 16, value: (record) => record.topPanelArea },
  { header: "Base Panel Area", width: 17, value: (record) => record.basePanelArea },
  { header: "Backboard Area", width: 16, value: (record) => record.backboardArea },
  { header: "Laminate Area", width: 16, value: (record) => record.laminateArea },
  { header: "Box Face Area", width: 16, value: (record) => record.boxFaceArea },
  { header: "Door Edge Banding Length", width: 26, value: (record) => record.doorEdgeBandingLength },
  { header: "Cabinet Edge Banding Length", width: 29, value: (record) => record.cabinetEdgeBandingLength },
  { header: "Straight Blind Hinge", width: 21, value: (record) => record.straightBlindHinge },
  { header: "155 Hinge", width: 12, value: (record) => record.lazySusan155Hinge },
  { header: "Pie Cut Hinge", width: 15, value: (record) => record.lazySusanPieCut },
  { header: "Pentagon Hinge", width: 16, value: (record) => record.pentagonHinge },
];

function buildResolvedSheetData(rows: ResolvedOrderRow[]): SheetData {
  return [
    RESOLVED_SHEET_HEADERS,
    ...toExportRows(rows).map((row) => [
      row["ABC Item"],
      row.W === "" ? null : row.W,
      row.H === "" ? null : row.H,
      row.D === "" ? null : row.D,
      row.Qty,
      row["Adjustable Shelf Qty"],
      row["Fixed Shelf Qty"],
      row["Box Color"],
      row.Type,
    ]),
  ];
}

function buildCatalogSheetData(): SheetData {
  return [
    CATALOG_EXPORT_COLUMNS.map((column) => column.header),
    ...cabinetCatalog.map((record) =>
      CATALOG_EXPORT_COLUMNS.map((column) => column.value(record))
    ),
  ];
}


export default function StandardCabinetsPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 150;
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [resolvedRows, setResolvedRows] = useState<ResolvedOrderRow[]>([]);
  const [uploadName, setUploadName] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null);

  const trimmedQuery = query.trim();

  useEffect(() => {
    setCurrentPage(1);
  }, [query, selectedCategory]);
  const resolution = useMemo(
    () => (trimmedQuery ? resolveCabinetDimensions(trimmedQuery) : null),
    [trimmedQuery]
  );

  const filteredRecords = useMemo(() => {
    const normalizedQuery = trimmedQuery.toLowerCase();

    return cabinetCatalog.filter((record) => {
      const categoryMatch = selectedCategory === "all" || record.category === selectedCategory;
      const queryMatch =
        !normalizedQuery ||
        record.abcItem.toLowerCase().includes(normalizedQuery) ||
        record.category.toLowerCase().includes(normalizedQuery);

      return categoryMatch && queryMatch;
    });
  }, [selectedCategory, trimmedQuery]);

  const totalPages = Math.ceil(filteredRecords.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const visibleRecords = filteredRecords.slice(startIndex, startIndex + rowsPerPage);
  const uploadStats = useMemo(() => {
    return resolvedRows.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.status] += 1;
        return acc;
      },
      { total: 0, ready: 0, skip: 0, error: 0 }
    );
  }, [resolvedRows]);

  const handleOrderUpload = async (file: File | null) => {
    if (!file) return;
    setUploadError(null);
    setUploadName(file.name);

    try {
      const sheets = await readXlsxFile(file);
      const sheetRows = sheets[0]?.data ?? [];
      const [headerRow, ...bodyRows] = sheetRows;
      if (!headerRow) throw new Error("No worksheet found");

      const headers = headerRow.map((cell) => asText(cell));
      const rows = bodyRows.reduce<Record<string, unknown>[]>((acc, row) => {
        const record: Record<string, unknown> = {};
        let hasValue = false;
        headers.forEach((header, index) => {
          if (!header) return;
          const value = asText(row[index]);
          record[header] = value;
          if (value) hasValue = true;
        });
        if (hasValue) acc.push(record);
        return acc;
      }, []);

      const resolved = resolveOrderRows(rows);
      if (resolved.length === 0) throw new Error("No rows found");
      setResolvedRows(resolved);
    } catch (error) {
      setResolvedRows([]);
      setUploadError(error instanceof Error ? error.message : "Unable to read Excel file");
    }
  };

  const handleExportResolvedRows = async () => {
    if (resolvedRows.length === 0) return;
    const baseName = uploadName.replace(/\.(xlsx|xls|csv)$/i, "") || "resolved_order";
    await writeXlsxFile(buildResolvedSheetData(resolvedRows), {
      sheet: "Resolved Order",
      columns: RESOLVED_SHEET_COLUMNS,
    }).toFile(`${baseName}_standard_cabinets.xlsx`);
  };

  const openSubmitModal = () => {
    if (resolvedRows.length === 0) return;
    if (uploadStats.error > 0) {
      const proceed = window.confirm(
        `${uploadStats.error} 行未能解析尺寸,这些行会以原值进入流水线,可能导致后端报错。继续提交吗?`
      );
      if (!proceed) return;
    }
    setSubmitError(null);
    setSubmitOpen(true);
  };

  const handleSubmitToPipeline = async (settings: UploadSettings) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const blob = await writeXlsxFile(buildResolvedSheetData(resolvedRows), {
        sheet: "Resolved Order",
        columns: RESOLVED_SHEET_COLUMNS,
      }).toBlob();

      const baseName = uploadName.replace(/\.(xlsx|xls|csv)$/i, "") || "resolved_order";
      const ts = new Date();
      const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, "0")}${String(ts.getDate()).padStart(2, "0")}-${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}`;
      const filename = `standard_cabinets_${baseName}_${stamp}.xlsx`;

      const result = await submitOrder({ blob, filename, settings });
      setSubmitOpen(false);
      setSubmittedJobId(result.jobId);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    const data: SheetData = [
      ["ABC Item", "Qty", "Box Color"],
      ["FDB24R", 1, "WhiteBirch"],
      ["W3030L", 2, "WhiteBirch"],
    ];
    await writeXlsxFile(data, {
      sheet: "Order Input",
      columns: [
        { width: 18 },
        { width: 8 },
        { width: 16 },
      ],
    }).toFile("standard_cabinet_order_template.xlsx");
  };

  const handleDownloadAllData = async () => {
    await writeXlsxFile(buildCatalogSheetData(), {
      sheet: "Standard Cabinets",
      columns: CATALOG_EXPORT_COLUMNS.map((column) => ({ width: column.width })),
    }).toFile("standard_cabinets_all_data.xlsx");
  };

  return (
    <div className="w-full space-y-6 py-4">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-[32px] font-semibold tracking-tight">Standard Cabinets Database</h1>
          <p className="text-apple-gray text-[15px]">
            ABC Item dimensions, prices, and production parameters.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleDownloadAllData()}
          className="h-10 px-4 rounded-lg bg-apple-blue text-white text-[13px] font-medium flex items-center justify-center gap-2 transition-colors hover:bg-apple-blue/90 lg:mt-1"
        >
          <Download size={16} />
          Download All Data
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard icon={Database} label="Database Items" value={cabinetCatalog.length.toLocaleString()} />
        <MetricCard icon={Layers3} label="Category" value={cabinetCategories.length.toLocaleString()} />
      </div>

      <div className="bg-card rounded-xl shadow-apple border border-border overflow-hidden">
        <div className="p-5 border-b border-border flex flex-col xl:flex-row gap-4 xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-apple-blue/10 text-apple-blue flex items-center justify-center shrink-0">
              <FileSpreadsheet size={19} />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight">Order Excel Resolver</h2>
              <div className="text-[13px] text-apple-gray mt-0.5">
                ABC Item, Qty, Box Color
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => void handleDownloadTemplate()}
              className="h-10 px-4 rounded-lg bg-black/[0.04] hover:bg-black/[0.08] text-[13px] font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <Download size={16} />
              Template
            </button>
            <label className="h-10 px-4 rounded-lg bg-apple-blue text-white text-[13px] font-medium flex items-center justify-center gap-2 cursor-pointer hover:bg-apple-blue/90 transition-colors">
              <Upload size={16} />
              Upload Excel
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(event) => {
                  void handleOrderUpload(event.target.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => void handleExportResolvedRows()}
              disabled={resolvedRows.length === 0 || uploadStats.error > 0}
              className="h-10 px-4 rounded-lg bg-apple-green text-white text-[13px] font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Download size={16} />
              Export Result
            </button>
            <button
              type="button"
              onClick={openSubmitModal}
              disabled={resolvedRows.length === 0}
              className="h-10 px-4 rounded-lg bg-apple-blue text-white text-[13px] font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Send size={16} />
              Submit to Pipeline
            </button>
          </div>
        </div>

        {(resolvedRows.length > 0 || uploadError) && (
          <div className="p-5 space-y-4">
            {uploadError && (
              <div className="rounded-lg border border-apple-red/20 bg-apple-red/5 p-3 text-[13px] text-apple-red flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            {submittedJobId && (
              <div className="rounded-lg border border-apple-blue/20 bg-apple-blue/5 p-3 text-[13px] flex items-start gap-2">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-apple-blue" />
                <div className="flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="text-foreground">
                    Order submitted: <span className="font-mono font-semibold">{submittedJobId}</span>
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => router.push("/orders")}
                      className="h-7 px-3 rounded-md bg-apple-blue text-white text-[12px] font-medium hover:bg-apple-blue/90 transition-colors"
                    >
                      View in Orders
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubmittedJobId(null)}
                      className="h-7 px-3 rounded-md bg-black/[0.05] text-apple-gray text-[12px] font-medium hover:bg-black/[0.1] transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            {resolvedRows.length > 0 && (
              <>
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  <div className="text-[13px] text-apple-gray">
                    {uploadName || "Uploaded file"}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatPill label="Rows" value={uploadStats.total} />
                    <StatPill label="Ready" value={uploadStats.ready} tone="green" />
                    <StatPill label="Skip" value={uploadStats.skip} tone="gray" />
                    <StatPill label="Error" value={uploadStats.error} tone="red" />
                  </div>
                </div>

                <div className="overflow-x-auto border border-border rounded-lg">
                  <table className="w-full min-w-[1040px] text-left">
                    <thead className="bg-black/[0.02] border-b border-border">
                      <tr>
                        <TableHeader>ABC Item</TableHeader>
                        <TableHeader align="right">W</TableHeader>
                        <TableHeader align="right">H</TableHeader>
                        <TableHeader align="right">D</TableHeader>
                        <TableHeader align="right">Qty</TableHeader>
                        <TableHeader align="right">Adj Shelf</TableHeader>
                        <TableHeader align="right">Fixed Shelf</TableHeader>
                        <TableHeader>Box Color</TableHeader>
                        <TableHeader>Type</TableHeader>
                        <TableHeader>Status</TableHeader>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {resolvedRows.slice(0, 80).map((row) => (
                        <tr key={`${row.rowNumber}-${row.abcItem}`} className="hover:bg-black/[0.015]">
                          <td className="py-3 px-4 font-mono text-[13px] font-semibold whitespace-nowrap">
                            {row.abcItem || `Row ${row.rowNumber}`}
                          </td>
                          <td className="py-3 px-4 text-[13px] text-right">{displayDimension(row.width)}</td>
                          <td className="py-3 px-4 text-[13px] text-right">{displayDimension(row.height)}</td>
                          <td className="py-3 px-4 text-[13px] text-right">{displayDimension(row.depth)}</td>
                          <td className="py-3 px-4 text-[13px] text-right">{row.qty}</td>
                          <td className="py-3 px-4 text-[13px] text-right">{row.adjustableShelfQty}</td>
                          <td className="py-3 px-4 text-[13px] text-right">{row.fixedShelfQty}</td>
                          <td className="py-3 px-4 text-[13px] whitespace-nowrap">{row.boxColor}</td>
                          <td className="py-3 px-4 text-[13px] whitespace-nowrap">{row.type || "N/A"}</td>
                          <td className="py-3 px-4 text-[13px]">
                            <StatusBadge status={row.status} source={row.source} message={row.message} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {resolvedRows.length > 80 && (
                  <div className="text-[13px] text-apple-gray">
                    Showing first 80 of {resolvedRows.length.toLocaleString()} resolved rows.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="bg-card rounded-xl shadow-apple border border-border overflow-hidden">
        <div className="p-5 border-b border-border flex flex-col xl:flex-row gap-4 xl:items-center xl:justify-between">
          <div className="relative w-full xl:max-w-xl">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-apple-gray" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search ABC Item / Category"
              className="w-full h-11 rounded-lg border border-border bg-white pl-11 pr-4 text-[14px] outline-none focus:border-apple-blue"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
              className="h-11 rounded-lg border border-border bg-white px-4 text-[14px] outline-none focus:border-apple-blue"
            >
              <option value="all">All categories</option>
              {cabinetCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <div className="h-11 rounded-lg bg-black/[0.04] px-4 text-[13px] font-medium text-apple-gray flex items-center">
              {filteredRecords.length.toLocaleString()} rows
            </div>
          </div>
        </div>

        {resolution && (
          <div
            className={clsx(
              "mx-5 mt-5 rounded-xl border p-4",
              resolution.resolved
                ? "border-apple-green/20 bg-apple-green/5"
                : "border-apple-red/20 bg-apple-red/5"
            )}
          >
            {resolution.resolved ? (
              <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-apple-green/10 text-apple-green flex items-center justify-center shrink-0">
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[15px] font-semibold">{resolution.abcItem}</span>
                      <span
                        className={clsx(
                          "px-2 py-1 rounded-md text-[11px] font-semibold uppercase",
                          resolution.source === "database"
                            ? "bg-apple-blue/10 text-apple-blue"
                            : "bg-apple-orange/10 text-apple-orange"
                        )}
                      >
                        {resolution.source === "database" ? "database" : "inferred"}
                      </span>
                    </div>
                    <div className="text-[13px] text-apple-gray mt-1">{resolution.category}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 min-w-full xl:min-w-[420px]">
                  <DimensionCell label="W" value={formatInches(resolution.width)} />
                  <DimensionCell label="H" value={formatInches(resolution.height)} />
                  <DimensionCell label="D" value={formatInches(resolution.depth)} />
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 text-apple-red">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-mono text-[14px] font-semibold">{resolution.normalizedItem || query}</div>
                  <div className="text-[13px] mt-1">{resolution.error}</div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="overflow-x-auto mt-5">
          <table className="w-full min-w-[1080px] text-left">
            <thead className="bg-black/[0.02] border-y border-border">
              <tr>
                <TableHeader>ABC Item</TableHeader>
                <TableHeader>Category</TableHeader>
                <TableHeader>Type</TableHeader>
                <TableHeader align="right">W</TableHeader>
                <TableHeader align="right">H</TableHeader>
                <TableHeader align="right">D</TableHeader>
                <TableHeader align="right">Door</TableHeader>
                <TableHeader align="right">Drawer</TableHeader>
                <TableHeader align="right">Shelf</TableHeader>
                <TableHeader align="right">Hinge</TableHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleRecords.map((record) => (
                <Fragment key={record.abcItem}>
                  <tr 
                    onClick={() => setExpandedItem(expandedItem === record.abcItem ? null : record.abcItem)}
                    className="hover:bg-black/[0.02] cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-mono text-[13px] font-semibold whitespace-nowrap">
                      {record.abcItem}
                    </td>
                    <td className="py-3 px-4 text-[13px] text-foreground/80">{record.category}</td>
                    <td className="py-3 px-4 text-[13px] text-foreground/80 uppercase">{record.type}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatInches(record.width)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatInches(record.height)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatInches(record.depth)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatQty(record.doorQty)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatQty(record.drawerQty)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{shelvesTotal(record)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatQty(record.hingeQty)}</td>
                  </tr>
                  {expandedItem === record.abcItem && (
                    <tr className="bg-black/[0.01]">
                      <td colSpan={10} className="px-4 py-6 border-b border-border shadow-inner">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-y-6 gap-x-4">
                          <DetailItem label="List Price" value={formatMoney(record.listPrice)} />
                          <DetailItem label="Adj. Shelf Qty" value={formatQty(record.adjustableShelfQty)} />
                          <DetailItem label="Fixed Shelf Qty" value={formatQty(record.fixedShelfQty)} />
                          <DetailItem label="Door Plank Area" value={formatNumber(record.doorPlankArea)} />
                          <DetailItem label="Left Panel Area" value={formatNumber(record.leftPanelArea)} />
                          <DetailItem label="Right Panel Area" value={formatNumber(record.rightPanelArea)} />
                          <DetailItem label="Top Panel Area" value={formatNumber(record.topPanelArea)} />
                          <DetailItem label="Base Panel Area" value={formatNumber(record.basePanelArea)} />
                          <DetailItem label="Backboard Area" value={formatNumber(record.backboardArea)} />
                          <DetailItem label="Laminate Area" value={formatNumber(record.laminateArea)} />
                          <DetailItem label="Box Face Area" value={formatNumber(record.boxFaceArea)} />
                          <DetailItem label="Door Edge Banding" value={formatNumber(record.doorEdgeBandingLength)} />
                          <DetailItem label="Cabinet Edge Banding" value={formatNumber(record.cabinetEdgeBandingLength)} />
                          <DetailItem label="Straight Blind Hinge" value={formatQty(record.straightBlindHinge)} />
                          <DetailItem label="155° Hinge" value={formatQty(record.lazySusan155Hinge)} />
                          <DetailItem label="Pie Cut Hinge" value={formatQty(record.lazySusanPieCut)} />
                          <DetailItem label="Pentagon Hinge" value={formatQty(record.pentagonHinge)} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}

              {visibleRecords.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-12 px-4 text-center text-[14px] text-apple-gray">
                    No matching cabinet items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-5 py-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="text-[13px] text-apple-gray">
              Showing {startIndex + 1} to {Math.min(startIndex + rowsPerPage, filteredRecords.length)} of {filteredRecords.length.toLocaleString()} entries
            </span>
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 h-8 rounded-lg text-[13px] font-medium flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-black/[0.04] hover:bg-black/[0.08] text-foreground"
              >
                Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={clsx(
                    "w-8 h-8 rounded-lg text-[13px] font-medium flex items-center justify-center transition-colors cursor-pointer",
                    currentPage === page
                      ? "bg-apple-blue text-white"
                      : "bg-black/[0.04] hover:bg-black/[0.08] text-foreground"
                  )}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 h-8 rounded-lg text-[13px] font-medium flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-black/[0.04] hover:bg-black/[0.08] text-foreground"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {submitOpen && (
        <CutSettingsModal
          filename={uploadName || "resolved_order.xlsx"}
          submitting={submitting}
          error={submitError}
          onCancel={() => { if (!submitting) setSubmitOpen(false); }}
          onConfirm={handleSubmitToPipeline}
        />
      )}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  accent = "blue",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent?: "blue" | "green";
}) {
  return (
    <div className="bg-card rounded-xl p-5 shadow-apple border border-border">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-apple-gray">{label}</p>
          <div className="text-[28px] font-semibold tracking-tight mt-1">{value}</div>
        </div>
        <div
          className={clsx(
            "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
            accent === "green" ? "bg-apple-green/10 text-apple-green" : "bg-apple-blue/10 text-apple-blue"
          )}
        >
          <Icon size={19} />
        </div>
      </div>
    </div>
  );
}

function DimensionCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white border border-border px-4 py-3">
      <div className="text-[11px] uppercase text-apple-gray font-semibold">{label}</div>
      <div className="text-[18px] font-semibold mt-1">{value}</div>
    </div>
  );
}

function TableHeader({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={clsx(
        "py-3 px-4 text-[11px] uppercase tracking-wide text-apple-gray font-semibold whitespace-nowrap",
        align === "right" && "text-right"
      )}
    >
      {children}
    </th>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-apple-gray font-semibold uppercase">{label}</span>
      <span className="text-[13px] text-foreground font-medium mt-0.5">{value}</span>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone = "gray",
}: {
  label: string;
  value: number;
  tone?: "gray" | "green" | "red";
}) {
  return (
    <div
      className={clsx(
        "h-8 px-3 rounded-lg text-[12px] font-semibold flex items-center gap-2",
        tone === "green" && "bg-apple-green/10 text-apple-green",
        tone === "red" && "bg-apple-red/10 text-apple-red",
        tone === "gray" && "bg-black/[0.04] text-apple-gray"
      )}
    >
      <span>{label}</span>
      <span>{value.toLocaleString()}</span>
    </div>
  );
}

function StatusBadge({
  status,
  source,
  message,
}: {
  status: ResolvedOrderStatus;
  source: string;
  message: string;
}) {
  const label = status === "ready" ? source || "ready" : status;
  return (
    <span
      title={message || label}
      className={clsx(
        "inline-flex max-w-[180px] items-center rounded-md px-2 py-1 text-[11px] font-semibold uppercase",
        status === "ready" && "bg-apple-green/10 text-apple-green",
        status === "skip" && "bg-black/[0.05] text-apple-gray",
        status === "error" && "bg-apple-red/10 text-apple-red"
      )}
    >
      <span className="truncate">{message || label}</span>
    </span>
  );
}
