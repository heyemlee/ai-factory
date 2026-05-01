"use client";

import type { ReactNode } from "react";
import { useMemo, useState, Fragment, useEffect } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Layers3,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import {
  CabinetCatalogRecord,
  cabinetCatalog,
  cabinetCategories,
  resolveCabinetDimensions,
} from "@/lib/cabinet_catalog";

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

export default function StandardCabinetsPage() {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 150;
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

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

  return (
    <div className="w-full space-y-6 py-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-[32px] font-semibold tracking-tight">Standard Cabinets Database</h1>
        <p className="text-apple-gray text-[15px]">
          ABC Item dimensions, prices, and production parameters.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard icon={Database} label="Database Items" value={cabinetCatalog.length.toLocaleString()} />
        <MetricCard icon={Layers3} label="Category" value={cabinetCategories.length.toLocaleString()} />
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
                <TableHeader align="right">W</TableHeader>
                <TableHeader align="right">H</TableHeader>
                <TableHeader align="right">D</TableHeader>
                <TableHeader align="right">List Price</TableHeader>
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
                    <td className="py-3 px-4 text-[13px] text-right">{formatInches(record.width)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatInches(record.height)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatInches(record.depth)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatMoney(record.listPrice)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatQty(record.doorQty)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatQty(record.drawerQty)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{shelvesTotal(record)}</td>
                    <td className="py-3 px-4 text-[13px] text-right">{formatQty(record.hingeQty)}</td>
                  </tr>
                  {expandedItem === record.abcItem && (
                    <tr className="bg-black/[0.01]">
                      <td colSpan={10} className="px-4 py-6 border-b border-border shadow-inner">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-y-6 gap-x-4">
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
