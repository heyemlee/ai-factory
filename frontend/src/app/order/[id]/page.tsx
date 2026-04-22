"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Layers, Package, BarChart3, Scissors, X, AlertTriangle, Table2, LayoutGrid, CheckCircle2, Plus, Minus, Loader2, Box, Printer } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { revertCut } from "@/lib/order_actions";
import dynamic from "next/dynamic";
import { useLanguage } from "@/lib/i18n";

const CabinetCanvas = dynamic(() => import("@/components/CabinetViewer"), { ssr: false });


/* ── types ──────────────────────────────── */
interface Part {
  part_id: string;
  Height: number;
  Width: number;
  cut_length: number;
  component: string;
  cab_id: string;
  cab_type: string;
  rotated?: boolean;
}

interface Board {
  board_id: string;
  board: string;
  board_type: string;
  board_size: string;
  strip_width: number;
  parts: Part[];
  trim_loss: number;
  saw_kerf: number;
  cuts: number;
  parts_total_length: number;
  parts_total_area: number;
  board_area: number;
  kerf_total: number;
  usable_length: number;
  waste: number;
  utilization: number;
  source?: string;
}

interface InventoryShortage {
  board_type: string;
  needed: number;
  stock: number;
  shortage: number;
}

interface CutResult {
  summary: {
    boards_used: number;
    total_parts_placed: number;
    overall_utilization: number;
    total_waste: number;
    inventory_shortage?: InventoryShortage[];
    inventory_used?: Record<string, number>;
    board_type_breakdown?: Record<string, number>;
  };
  boards: Board[];
}

interface Order {
  id: string;
  job_id: string;
  status: string;
  cut_result_json: CutResult | null;
  cabinets_summary: string;
  extra_boards_used?: { board_type: string; count: number }[];
}

interface Cabinet {
  cab_id: string;
  cab_type: string;
  parts: Part[];
  dimensions: { width: number; height: number; depth: number };
}


/* Simple bright color palette for 5 distinct sizes */
const SIZE_COLORS = [
  { bg: "#bfdbfe", border: "#3b82f6", text: "#1d4ed8", light: "#ffffff" },
  { bg: "#e9d5ff", border: "#a855f7", text: "#6b21a8", light: "#ffffff" },
  { bg: "#a7f3d0", border: "#10b981", text: "#047857", light: "#ffffff" },
  { bg: "#fed7aa", border: "#f97316", text: "#c2410c", light: "#ffffff" },
  { bg: "#fbcfe8", border: "#ec4899", text: "#be185d", light: "#ffffff" },
];


/* ── Stack cutting: fingerprint a board by its cutting pattern ── */
function boardFingerprint(board: Board): string {
  const partSig = board.parts
    .map((p) => `${p.cut_length || p.Height}x${p.Width}`)
    .join(",");
  return `${board.board_size}|${partSig}`;
}

export default function OrderDetail() {
  const { t } = useLanguage();
  const params = useParams();
  const id = params?.id || "N/A";

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [viewMode, setViewMode] = useState<"layout" | "table" | "cabinets" | "machine">("layout");
  const [machineLang, setMachineLang] = useState<"zh" | "en" | "es">("zh");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [selectedCabinetId, setSelectedCabinetId] = useState<string | null>(null);
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null);


  useEffect(() => {
    supabase
      .from("orders")
      .select("*")
      .eq("job_id", id as string)
      .maybeSingle()
      .then(({ data, error }) => {
        if (data) setOrder(data as Order);
        if (error) console.error("Failed to load order:", error);
        setLoading(false);
      });
  }, [id]);

  const cutResult = order?.cut_result_json;
  const boards = cutResult?.boards || [];
  const summary = cutResult?.summary;
  const shortages = summary?.inventory_shortage || [];

  /* Build stable size → color map */
  const sizeColorMap = useMemo(() => {
    const uniqueSizes: string[] = [];
    for (const b of boards) {
      if (!uniqueSizes.includes(b.board_size)) uniqueSizes.push(b.board_size);
    }
    const map: Record<string, typeof SIZE_COLORS[0]> = {};
    uniqueSizes.forEach((size, i) => {
      map[size] = SIZE_COLORS[i % SIZE_COLORS.length];
    });
    return map;
  }, [boards]);

  /* Board size legend groups */
  const sizeGroups = useMemo(() => {
    const groups: Record<string, Board[]> = {};
    for (const b of boards) {
      if (!groups[b.board_size]) groups[b.board_size] = [];
      groups[b.board_size].push(b);
    }
    return Object.entries(groups);
  }, [boards]);

  /* ── Stack cutting analysis: group boards with identical cutting patterns ── */
  const stackGroups = useMemo(() => {
    const fpMap: Record<string, { board: Board; index: number }[]> = {};
    for (let i = 0; i < boards.length; i++) {
      const b = boards[i];
      const fp = boardFingerprint(b);
      if (!fpMap[fp]) fpMap[fp] = [];
      fpMap[fp].push({ board: b, index: i });
    }
    // Build a lookup: array_index → stack info
    const lookup: Record<number, { groupSize: number; stackOf: number; isLeader: boolean }> = {};
    for (const group of Object.values(fpMap)) {
      if (group.length < 2) {
        // No stacking possible
        for (const item of group) {
          lookup[item.index] = { groupSize: 1, stackOf: 1, isLeader: true };
        }
      } else {
        // Split into stacks of max 4
        let remaining = group.length;
        let idx = 0;
        while (remaining > 0) {
          const stackSize = Math.min(4, remaining);
          for (let i = 0; i < stackSize; i++) {
            lookup[group[idx].index] = { groupSize: group.length, stackOf: stackSize, isLeader: i === 0 };
            idx++;
          }
          remaining -= stackSize;
        }
      }
    }
    // Summary: how many actual cuts needed vs total boards
    const totalBoards = boards.length;
    let totalCuts = 0;
    for (const group of Object.values(fpMap)) {
      let remaining = group.length;
      while (remaining > 0) {
        totalCuts++;
        remaining -= Math.min(4, remaining);
      }
    }
    return { lookup, totalBoards, totalCuts, saved: totalBoards - totalCuts };
  }, [boards]);

  /* ── Group parts into cabinets ── */
  const cabinets = useMemo(() => {
    const cabMap: Record<string, Cabinet> = {};
    for (const b of boards) {
      for (const p of b.parts) {
        if (!p.cab_id || p.cab_id === "?" || p.cab_id === "Unknown") continue;
        if (!cabMap[p.cab_id]) {
          cabMap[p.cab_id] = {
            cab_id: p.cab_id,
            cab_type: p.cab_type || "Unknown",
            parts: [],
            dimensions: { width: 0, height: 0, depth: 0 }
          };
        }
        cabMap[p.cab_id].parts.push(p);
      }
    }
    // Heuristically calculate dimensions
    return Object.values(cabMap).map(cab => {
      let maxH = 0, maxW = 0, maxD = 0;
      cab.parts.forEach(p => {
        const c = (p.component || "").toLowerCase();
        if (c.includes("side") || c.includes("侧板")) {
          // 侧板: Height=柜高, Width=柜深
          maxH = Math.max(maxH, p.Height);
          maxD = Math.max(maxD, p.Width);
        } else if (c.includes("top") || c.includes("bottom") || c.includes("顶板") || c.includes("底板")) {
          // 顶板/底板: Height=柜宽-36, Width=柜深-18 → 补回扣减值
          maxW = Math.max(maxW, p.Height + 36);
          maxD = Math.max(maxD, p.Width + 18);
        } else if (c.includes("back") || c.includes("背板")) {
          // 背板: Height=柜宽-30, Width=柜高 → 注意Height和Width的含义
          maxW = Math.max(maxW, p.Height + 30);
          maxH = Math.max(maxH, p.Width);
        }
      });
      // Fallbacks if heuristics fail
      if (maxH === 0) maxH = 720;
      if (maxW === 0) maxW = 600;
      if (maxD === 0) maxD = 560;
      
      cab.dimensions = { width: maxW, height: maxH, depth: maxD };
      return cab;
    }).sort((a, b) => a.cab_id.localeCompare(b.cab_id));
  }, [boards]);

  // Set default selected cabinet when switching to cabinets view
  useEffect(() => {
    if (viewMode === "cabinets" && cabinets.length > 0 && !selectedCabinetId) {
      setSelectedCabinetId(cabinets[0].cab_id);
    }
  }, [viewMode, cabinets, selectedCabinetId]);


  const handleCutConfirmed = useCallback(() => {
    // Refetch order to reflect new status
    supabase
      .from("orders")
      .select("*")
      .eq("job_id", id as string)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setOrder(data as Order);
      });
    setShowConfirmModal(false);
  }, [id]);

  const handleRevertCut = async () => {
    if (!order) return;
    if (!confirm(t("orderDetail.revertConfirm"))) return;
    setIsReverting(true);
    try {
      await revertCut(order);
      // Refetch
      const { data } = await supabase.from("orders").select("*").eq("job_id", id as string).maybeSingle();
      if (data) setOrder(data as Order);
    } catch (e) {
      alert(t("orderDetail.revertFailed") + e);
    } finally {
      setIsReverting(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full py-4 flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-apple-blue/30 border-t-apple-blue rounded-full animate-spin mx-auto" />
          <p className="text-apple-gray text-[15px]">{t("orderDetail.loadingData")}</p>
        </div>
      </div>
    );
  }

  if (!order || !cutResult) {
    return (
      <div className="w-full py-4 space-y-4">
        <Link href="/orders" className="inline-flex items-center gap-2 text-apple-blue text-[14px] font-medium hover:underline">
          <ArrowLeft size={16} /> {t("orderDetail.back")}
        </Link>
        <div className="bg-card rounded-2xl p-12 shadow-apple text-center">
          <p className="text-apple-gray text-[15px]">
            {order?.status === "pending" ? t("orderDetail.processingOrder") : t("orderDetail.notFound")}
          </p>
        </div>
      </div>
    );
  }

  const isCutDone = order.status === "cut_done";
  const isCompleted = order.status === "completed";

  return (
    <div className="w-full py-4 space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/orders" className="p-2.5 bg-black/[0.04] rounded-full hover:bg-black/[0.08] transition-colors shrink-0">
            <ArrowLeft size={20} className="text-foreground" />
          </Link>
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">{t("orderDetail.title")} #{id as string}</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="flex bg-black/[0.04] p-1 rounded-xl">
            <button onClick={() => setViewMode("layout")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${viewMode === "layout" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"}`}>
              <LayoutGrid size={14} /> {t("orderDetail.layout")}
            </button>
            <button onClick={() => setViewMode("table")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${viewMode === "table" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"}`}>
              <Table2 size={14} /> {t("orderDetail.dataTable")}
            </button>
            <button onClick={() => setViewMode("cabinets")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${viewMode === "cabinets" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"}`}>
              <Box size={14} /> {t("orderDetail.cabinetView")}
            </button>
            <button onClick={() => setViewMode("machine")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${viewMode === "machine" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"}`}>
              <Scissors size={14} /> {t("machine.tabLabel")}
            </button>
          </div>

          {/* Status / Confirm button */}
          {isCutDone ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium bg-apple-green/10 text-apple-green">
                <CheckCircle2 size={14} /> {t("orderDetail.confirmedCut")}
              </span>
              <button 
                onClick={handleRevertCut}
                disabled={isReverting}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-medium bg-apple-red/10 text-apple-red hover:bg-apple-red/20 transition-colors disabled:opacity-50"
              >
                {isReverting ? t("orderDetail.processing") : "撤回"}
              </button>
            </div>
          ) : isCompleted ? (
            <button
              onClick={() => setShowConfirmModal(true)}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-[13px] font-medium bg-apple-blue text-white hover:bg-apple-blue/90 shadow-sm transition-colors"
            >
              <CheckCircle2 size={14} /> {t("orderDetail.confirmCut")}
            </button>
          ) : (
            <span className={`px-4 py-2 rounded-full text-[13px] font-medium capitalize ${
              order.status === "failed" ? "bg-red-100 text-red-600" : "bg-apple-blue/10 text-apple-blue"
            }`}>{order.status}</span>
          )}
        </div>
      </div>

      {/* ── Inventory Shortage Warning ── */}
      {shortages.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-semibold text-amber-800">{t("orderDetail.shortageTitle")}</p>
            <p className="text-[13px] text-amber-700 mt-1">{t("orderDetail.shortageDesc")}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {shortages.map(s => (
                <span key={s.board_type} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-100 text-amber-800 text-[12px] font-medium">
                  {s.board_type}: {t("orderDetail.need")}{s.needed} / {t("orderDetail.stock")}{s.stock} / {t("orderDetail.missing")}{s.shortage}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Table View Data / Summary ── */}
      {viewMode === "table" && (
        <>
          {/* ── Summary Stats ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard icon={<Layers size={18} />} label={t("orderDetail.boardsCount")} value={String(summary?.boards_used || 0)} color="#3b82f6" />
            <StatCard icon={<Package size={18} />} label={t("orderDetail.partsCount")} value={String(summary?.total_parts_placed || 0)} color="#8b5cf6" />
            <StatCard icon={<BarChart3 size={18} />} label={t("orderDetail.overallUtil")} value={`${((summary?.overall_utilization || 0) * 100).toFixed(1)}%`} color="#10b981" />
          </div>


        </>
      )}

      {/* ── Layout View: Split layout for T1 and T0 ── */}
      {viewMode === "layout" && (() => {
        const typeGroups = boards.reduce((acc, b, idx) => {
          const type = b.board || b.board_type || "Unknown";
          if (!acc[type]) acc[type] = [];
          acc[type].push(idx);
          return acc;
        }, {} as Record<string, number[]>);

        const t1Entries = Object.entries(typeGroups).filter(([type]) => type.toUpperCase().includes("T1")).sort(([a], [b]) => b.localeCompare(a));
        const t0Entries = Object.entries(typeGroups).filter(([type]) => !type.toUpperCase().includes("T1")).sort(([a], [b]) => b.localeCompare(a));

        const renderColumn = ([type, indices]: [string, number[]]) => {
          const leaders = indices.filter((idx) => stackGroups.lookup[idx]?.isLeader);
          if (leaders.length === 0) return null;

          // Sort leaders within column by group size then stack size
          leaders.sort((a, b) => {
            const aInfo = stackGroups.lookup[a];
            const bInfo = stackGroups.lookup[b];
            const aGroup = aInfo?.groupSize || 1;
            const bGroup = bInfo?.groupSize || 1;
            if (bGroup !== aGroup) return bGroup - aGroup;
            
            const aStack = aInfo?.stackOf || 1;
            const bStack = bInfo?.stackOf || 1;
            if (bStack !== aStack) return bStack - aStack;

            return boards[b].utilization - boards[a].utilization;
          });

          return (
            <div key={type} className="flex flex-col gap-y-3 shrink-0">
              <div className="text-left px-2">
                <h3 className="text-[16px] font-bold text-foreground">{type}</h3>
                <p className="text-[13px] text-apple-gray font-medium">
                  {indices.length} {t("orderDetail.boardsCount")}
                </p>
              </div>
              <div className="flex flex-col gap-y-3 pb-8">
                {leaders.map((idx) => {
                  const board = boards[idx];
                  const stackInfo = stackGroups.lookup[idx];
                  return (
                    <BoardTile
                      key={`${board.board_id}-${idx}`}
                      board={board}
                      index={idx}
                      color={sizeColorMap[board.board_size]}
                      stackInfo={stackInfo}
                      onClick={() => setSelectedBoard(board)}
                    />
                  );
                })}
              </div>
            </div>
          );
        };

        return (
          <div className="flex flex-col md:flex-row w-full pt-8 pb-12 min-h-[60vh]">
            {/* Left Area (T1) - 3/5 width */}
            <div className="w-full md:w-[60%] flex flex-wrap items-start gap-x-16 gap-y-12 px-6 border-b md:border-b-0 md:border-r border-border/40 pb-8 md:pb-0">
              {t1Entries.length > 0 ? t1Entries.map(renderColumn) : (
                <div className="w-full h-32 flex items-center justify-center text-apple-gray/50 text-[14px]">
                  T1 {t("orderDetail.notFound")}
                </div>
              )}
            </div>

            {/* Right Area (T0) - 2/5 width */}
            <div className="w-full md:w-[40%] flex flex-wrap items-start gap-x-16 gap-y-12 px-6 pt-8 md:pt-0">
              {t0Entries.length > 0 ? t0Entries.map(renderColumn) : (
                <div className="w-full h-32 flex items-center justify-center text-apple-gray/50 text-[14px]">
                  T0 {t("orderDetail.notFound")}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Table View ── */}
      {viewMode === "table" && (
        <div className="bg-card rounded-xl shadow-apple border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-black/[0.02]">
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">#</th>
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">{t("orderDetail.thBoardId")}</th>
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">{t("orderDetail.thBoardType")}</th>
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">{t("orderDetail.thSize")}</th>
                  <th className="text-center py-3 px-4 font-semibold text-apple-gray">{t("orderDetail.thParts")}</th>
                  <th className="text-center py-3 px-4 font-semibold text-apple-gray">{t("orderDetail.thCuts")}</th>
                  <th className="text-right py-3 px-4 font-semibold text-apple-gray">{t("orderDetail.thUtil")}</th>
                  <th className="text-center py-3 px-4 font-semibold text-apple-gray">{t("orderDetail.thStack")}</th>
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">{t("orderDetail.thDetails")}</th>
                </tr>
              </thead>
              <tbody>
                {boards.map((board, idx) => {
                  const c = sizeColorMap[board.board_size];
                  const utilPct = (board.utilization * 100).toFixed(1);
                  const utilNum = parseFloat(utilPct);
                  const si = stackGroups.lookup[idx];
                  return (
                    <tr key={`${board.board_id}-${idx}`} className="border-b border-border/20 hover:bg-black/[0.01]">
                      <td className="py-2.5 px-4 text-apple-gray">{idx + 1}</td>
                      <td className="py-2.5 px-4 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: c.bg, border: `1.5px solid ${c.border}` }} />
                          {board.board_id}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-apple-gray">{board.board}</td>
                      <td className="py-2.5 px-4 font-mono text-[12px]">{board.board_size}mm</td>
                      <td className="py-2.5 px-4 text-center">{board.parts.length}</td>
                      <td className="py-2.5 px-4 text-center">{board.cuts}</td>
                      <td className="py-2.5 px-4 text-right font-bold" style={{ color: utilNum > 80 ? "#10b981" : utilNum > 60 ? "#f59e0b" : "#ef4444" }}>{utilPct}%</td>
                      <td className="py-2.5 px-4 text-center">
                        {si && si.stackOf > 1 ? (
                          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold">×{si.stackOf}</span>
                        ) : "—"}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex flex-wrap gap-1">
                          {board.parts.map((p, pi) => (
                            <span key={`${p.part_id}-${pi}`} className="text-[10px] px-1.5 py-0.5 rounded bg-black/[0.03] text-apple-gray">
                              {p.component || p.part_id}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Cabinets View ── */}
      {viewMode === "cabinets" && cabinets.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          
          {/* 1. Leftmost Area - Cabinet List (Sticky) */}
          <div className="w-full lg:w-64 flex flex-col bg-card rounded-2xl shadow-apple border border-border/30 overflow-hidden shrink-0 lg:sticky lg:top-4 h-[calc(100vh-140px)] max-h-[700px]">
            <div className="p-4 border-b border-border/40 bg-black/[0.02]">
              <h3 className="font-semibold text-[15px] flex items-center gap-2">
                <Box size={16} className="text-apple-blue" />
                {t("orderDetail.selectCabinet")} ({cabinets.length})
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {cabinets.map(cab => (
                <button
                  key={cab.cab_id}
                  onClick={() => setSelectedCabinetId(cab.cab_id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors flex items-center justify-between group ${
                    selectedCabinetId === cab.cab_id 
                      ? "bg-apple-blue text-white shadow-sm" 
                      : "hover:bg-black/[0.04] text-foreground"
                  }`}
                >
                  <div>
                    <div className="font-medium text-[14px] leading-tight">{cab.cab_id}</div>
                    <div className={`text-[11px] mt-0.5 ${selectedCabinetId === cab.cab_id ? "text-blue-100" : "text-apple-gray"}`}>
                      {cab.cab_type} · {cab.parts.length}{t("orderDetail.cabParts")}
                    </div>
                  </div>
                  <ArrowLeft size={14} className={`rotate-180 opacity-0 group-hover:opacity-100 transition-opacity ${selectedCabinetId === cab.cab_id ? "opacity-100" : ""}`} />
                </button>
              ))}
            </div>
          </div>

          {/* 2. Middle Area - 3D Viewer (Square) */}
          <div className="w-full lg:w-[420px] shrink-0 lg:sticky lg:top-4">
            <div className="w-full aspect-square bg-card rounded-2xl shadow-apple border border-border/30 relative overflow-hidden">
              {cabinets.find(c => c.cab_id === selectedCabinetId) && (
                <CabinetCanvas 
                  cabinet={cabinets.find(c => c.cab_id === selectedCabinetId)!} 
                  hoveredPartId={hoveredPartId}
                  setHoveredPartId={setHoveredPartId}
                />
              )}
            </div>
          </div>

          {/* 3. Right Area - Parts List (Natural Height, Page Scroll, Card Style) */}
          <div className="flex-1 min-w-0 flex flex-col bg-card rounded-2xl shadow-apple border border-border/30 overflow-hidden">
            <div className="p-4 border-b border-border/40 bg-black/[0.02] sticky top-0 z-10 backdrop-blur-md bg-white/95">
              <h3 className="font-semibold text-[15px] flex items-center gap-2 text-apple-gray">
                <Layers size={16} className="text-apple-blue" />
                {t("orderDetail.cabPartsList")}
              </h3>
            </div>
            <div className="p-2 space-y-1">
              {cabinets.find(c => c.cab_id === selectedCabinetId)?.parts.map((p, idx) => (
                <div 
                  key={p.part_id} 
                  className={`w-full text-left px-4 py-3 rounded-xl transition-colors flex items-center justify-between cursor-pointer ${
                    hoveredPartId === p.part_id ? "bg-blue-50/60 shadow-sm" : "hover:bg-black/[0.02]"
                  }`}
                  onMouseEnter={() => setHoveredPartId(p.part_id)}
                  onMouseLeave={() => setHoveredPartId(null)}
                >
                  <div>
                    <div className={`font-medium text-[14px] leading-tight ${hoveredPartId === p.part_id ? "text-apple-blue" : "text-foreground"}`}>
                      {p.component || t("orderDetail.unnamedPart")}
                    </div>
                    <div className="text-[12px] mt-1 text-apple-gray flex items-center gap-2 font-mono">
                      <span className="inline-flex items-center gap-1"><span className="text-black/40 font-sans">H</span>{p.Height}</span>
                      <span className="text-black/20 font-sans">×</span>
                      <span className="inline-flex items-center gap-1"><span className="text-black/40 font-sans">W</span>{p.Width}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── Machine Cut Plan View ── */}
      {viewMode === "machine" && (
        <MachineCutPlan boards={boards} orderId={id as string} machineLang={machineLang} setMachineLang={setMachineLang} />
      )}

      {/* ── Board Detail Modal ── */}
      {selectedBoard && (
        <BoardDetailModal
          board={selectedBoard}
          color={sizeColorMap[selectedBoard.board_size]}
          onClose={() => setSelectedBoard(null)}
        />
      )}

      {/* ── Confirm Cut Modal ── */}
      {showConfirmModal && order && cutResult && (
        <ConfirmCutModal
          order={order}
          boards={boards}
          onConfirmed={handleCutConfirmed}
          onClose={() => setShowConfirmModal(false)}
        />
      )}
    </div>
  );
}

/* ── Stat Card ── */
function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-card rounded-xl p-4 shadow-apple flex items-center gap-3">
      <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${color}12`, color }}>{icon}</div>
      <div>
        <p className="text-[11px] font-medium text-apple-gray uppercase tracking-wide">{label}</p>
        <p className="text-[20px] font-bold text-foreground leading-tight">{value}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   BoardTile — Small tile for flat grid overview
   ═══════════════════════════════════════════ */
function BoardTile({ board, index, color, stackInfo, onClick, disableHover = false }: {
  board: Board;
  index: number;
  color: typeof SIZE_COLORS[0];
  stackInfo?: { groupSize: number; stackOf: number; isLeader: boolean };
  onClick: () => void;
  disableHover?: boolean;
}) {
  const { t } = useLanguage();
  const [isHovered, setIsHovered] = useState(false);
  const activeHover = !disableHover && isHovered;

  const boardDims = useMemo(() => {
    const match = board.board.match(/(\d+(?:\.\d+)?)[x×*](\d+(?:\.\d+)?)/i);
    if (match) {
      return { width: parseFloat(match[1]), height: parseFloat(match[2]) };
    }
    const p = board.board_size.split("×").map((s) => parseFloat(s.trim()));
    return { width: p[0] || 0, height: p[1] || 0 };
  }, [board.board_size, board.board]);

  const TILE_BASE_W = 200;
  const heightRatio = boardDims.width / boardDims.height;
  const stretchFactor = heightRatio < 0.3 ? 1.8 : heightRatio < 0.5 ? 1.4 : 1.2;
  const tileH = Math.max(40, Math.round(TILE_BASE_W * heightRatio * stretchFactor));
  const tileW = TILE_BASE_W;

  const partLayout = useMemo(() => {
    if (!boardDims.height) return [];
    const bH = boardDims.height;
    const bW = boardDims.width;
    let x = board.trim_loss;
    return board.parts.map((p, idx) => {
      const pH = p.cut_length || p.Height;
      const pW = p.Width;
      const left = (x / bH) * 100;
      const width = (pH / bH) * 100;
      const height = Math.min((pW / bW) * 100, 100);
      x += pH + board.saw_kerf;
      return { ...p, top: 0, left, width, height, idx };
    });
  }, [board, boardDims]);

  const wasteLeft = useMemo(() => {
    if (!partLayout.length) return 100;
    const last = partLayout[partLayout.length - 1];
    return last.left + last.width + 0.2;
  }, [partLayout]);

  const utilPct = (board.utilization * 100).toFixed(1);
  const utilNum = parseFloat(utilPct);
  const utilColor = utilNum > 80 ? "#10b981" : utilNum > 60 ? "#f59e0b" : "#ef4444";

  const stackOf = stackInfo?.stackOf || 1;

  const tileContent = (
    <>
      <div className="px-2 pt-2 pb-1 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold text-foreground truncate">{board.board_id}</span>
        </div>
        <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color: utilColor }}>{utilPct}%</span>
      </div>

      <div className="px-2 pb-2 flex justify-center">
        <div className="relative rounded-sm overflow-hidden" style={{
          width: `${tileW}px`, height: `${tileH}px`,
          backgroundColor: color.light, border: `1.5px solid ${color.border}`,
        }}>
          {partLayout.map((p) => (
            <div key={`${p.part_id}-${p.idx}`} className="absolute" style={{
              left: `${p.left}%`, bottom: `0%`, width: `${p.width}%`, height: `${p.height}%`,
              backgroundColor: color.bg,
              borderRight: `1px solid ${color.border}`,
              borderTop: p.height < 100 ? `1px solid ${color.border}` : undefined,
            }} />
          ))}
          {wasteLeft < 96 && (
            <div className="absolute top-0 h-full" style={{
              left: `${wasteLeft}%`, width: `${Math.max(100 - wasteLeft, 0)}%`,
              backgroundColor: "#ffffff",
              backgroundImage: "repeating-linear-gradient(45deg, #ffffff, #ffffff 4px, #f8fafc 4px, #f8fafc 8px)",
              borderLeft: `1.5px dashed #94a3b8`,
            }} />
          )}
        </div>
      </div>
    </>
  );

  return (
    <div
      // elevate z-index massively so the hover popout spans over adjacent items without layout shift
      className={`relative transition-all duration-300 ${activeHover ? 'z-50' : 'z-0'} ${onClick.toString() === "() => {}" ? "" : "cursor-pointer"}`}
      style={{ width: `${tileW + 24}px`, height: `${tileH + 46}px` }}
      onClick={onClick.toString() === "() => {}" ? undefined : onClick}
      onMouseEnter={() => !disableHover && setIsHovered(true)}
      onMouseLeave={() => !disableHover && setIsHovered(false)}
    >
      {/* Floating Badge above the card */}
      {stackOf > 1 && (
        <div 
          className="absolute left-1/2 -translate-x-1/2 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] z-50 rounded-full px-2 py-0.5 pointer-events-none flex items-center shadow-lg border"
          style={{
             top: activeHover ? '-40px' : '-20px',
             background: color.bg, // Matches the size legend background color
             borderColor: color.border,
             color: color.text,
             transform: activeHover ? `translateX(-50%) scale(1.15)` : `translateX(-50%) scale(1)`,
             opacity: activeHover ? 0 : 1
          }}
        >
          <span className="font-bold text-[11px] whitespace-nowrap">×{stackOf} {t("orderDetail.stackCutBadge")}</span>
        </div>
      )}

      {/* Backdrops for stack effect (animated on hover to fan out like cards) */}
      {stackOf > 1 && Array.from({ length: stackOf - 1 }).map((_, domIndex) => {
        const depth = Math.min(stackOf - 1, 4) - domIndex; 
        
        const baseTransform = `translate(${depth * 4}px, ${depth * 4}px) rotate(0deg) scale(1)`;
        // Fully spread horizontally side-by-side
        const hoverTransform = `translate(${depth * (tileW + 16)}px, 0px) rotate(0deg) scale(1)`;
        
        return (
          <div 
            key={domIndex}
            className="absolute top-0 left-0 bg-white rounded-xl border transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-bottom-left"
            style={{ 
              borderColor: color.border + "30", 
              width: `100%`, 
              height: `100%`,
              transform: activeHover ? hoverTransform : baseTransform,
              boxShadow: activeHover ? 'inset 0 0 0 1px rgba(0,0,0,0.12), 0 8px 30px rgba(0,0,0,0.12)' : 'inset 0 0 0 1px rgba(0,0,0,0.08)',
              overflow: 'hidden',
              zIndex: activeHover ? -depth : 0
            }}
          >
             <div 
               className="w-full h-full transition-opacity duration-500" 
               style={{ opacity: activeHover ? 0.9 : 0.6 }} 
             >
               {tileContent}
             </div>
          </div>
        );
      })}

      {/* Main Tile */}
      <div
        className="absolute top-0 left-0 bg-card rounded-xl border overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-bottom-left bg-white"
        style={{ 
          borderColor: color.border + "30", 
          width: `100%`, 
          height: `100%`,
          transform: `translate(0px, 0px) rotate(0deg) scale(1)`,
          boxShadow: activeHover ? '0 20px 40px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.04)'
        }}
      >
        {tileContent}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   BoardDetailModal
   ═══════════════════════════════════════════ */
function BoardDetailModal({ board, color, onClose }: {
  board: Board; color: typeof SIZE_COLORS[0]; onClose: () => void;
}) {
  const { t } = useLanguage();
  const boardDims = useMemo(() => {
    const match = board.board.match(/(\d+(?:\.\d+)?)[x×*](\d+(?:\.\d+)?)/i);
    if (match) {
      return { width: parseFloat(match[1]), height: parseFloat(match[2]) };
    }
    const p = board.board_size.split("×").map((s) => parseFloat(s.trim()));
    return { width: p[0] || 0, height: p[1] || 0 };
  }, [board.board_size, board.board]);

  const MODAL_W = 400;
  const heightRatio = boardDims.width / boardDims.height;
  const stretchFactor = heightRatio < 0.3 ? 2.2 : heightRatio < 0.5 ? 1.6 : 1.3;
  const modalVisualH = Math.max(60, Math.round(MODAL_W * heightRatio * stretchFactor));

  const partLayout = useMemo(() => {
    if (!boardDims.height) return [];
    let x = board.trim_loss;
    return board.parts.map((p, idx) => {
      const pH = p.cut_length || p.Height;
      const pW = p.Width;
      const left = (x / boardDims.height) * 100;
      const width = (pH / boardDims.height) * 100;
      const height = Math.min((pW / boardDims.width) * 100, 100);
      x += pH + board.saw_kerf;
      return { ...p, top: 0, left, width, height, idx };
    });
  }, [board, boardDims]);

  const wasteLeft = useMemo(() => {
    if (!partLayout.length) return 100;
    const last = partLayout[partLayout.length - 1];
    return last.left + last.width + 0.2;
  }, [partLayout]);

  const utilPct = (board.utilization * 100).toFixed(1);
  const utilNum = parseFloat(utilPct);
  const utilColor = utilNum > 80 ? "#10b981" : utilNum > 60 ? "#f59e0b" : "#ef4444";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />
      <div className="relative bg-white w-full max-w-3xl rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.15)] border border-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()} style={{ animation: "modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)" }}>
        <style>{`@keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>

        <div className="p-5 border-b border-border/40 flex items-center justify-between" style={{ backgroundColor: color.light }}>
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded" style={{ backgroundColor: color.bg, border: `2px solid ${color.border}` }} />
            <div>
              <h3 className="text-[18px] font-semibold">{board.board_id}</h3>
              <p className="text-[13px] text-apple-gray">{board.board} · {board.board_size}mm · {board.parts.length} {t("orderDetail.thParts")} · {board.cuts} {t("orderDetail.thCuts")}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[18px] font-bold" style={{ color: utilColor }}>{utilPct}%</span>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-black/5 transition-colors"><X size={18} className="text-apple-gray" /></button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-col">
          <div className="p-5 flex flex-col items-center justify-start lg:border-b border-border/30 bg-[#fafafa] shrink-0">
            <div className="flex items-center gap-1 mb-2">
              <div className="h-px bg-apple-gray/20" style={{ width: "16px" }} />
              <span className="text-[10px] text-apple-gray font-mono">{boardDims.height}mm</span>
              <div className="h-px bg-apple-gray/20" style={{ width: "16px" }} />
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <div className="relative rounded-sm overflow-hidden" style={{
                width: `${MODAL_W}px`, height: `${modalVisualH}px`,
                backgroundColor: color.light, border: `2px solid ${color.border}`,
              }}>
                {partLayout.map((p) => {
                  const partPxW = (p.width / 100) * MODAL_W;
                  const partPxH = (p.height / 100) * modalVisualH;
                  const showText = partPxW > 35 && partPxH > 14;
                  const showDims = partPxW > 50 && partPxH > 26;
                  return (
                    <div key={`${p.part_id}-${p.idx}`} className="absolute flex items-center justify-center overflow-hidden" style={{
                      left: `${p.left}%`, bottom: `0%`, width: `${p.width}%`, height: `${p.height}%`,
                      backgroundColor: color.bg,
                      borderRight: `1px solid ${color.border}`,
                      borderTop: p.height < 100 ? `1px solid ${color.border}` : undefined,
                    }}>
                      {showText && (
                        <div className="text-center leading-tight select-none px-0.5">
                          <span className="text-[10px] font-bold block truncate" style={{ color: color.text }}>{p.component || p.part_id}</span>
                          {showDims && <span className="text-[9px] font-medium block truncate" style={{ color: color.text }}>{p.Height}×{p.Width}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {wasteLeft < 96 && (
                  <div className="absolute top-0 h-full flex items-center justify-center" style={{
                    left: `${wasteLeft}%`, width: `${Math.max(100 - wasteLeft, 0)}%`,
                    backgroundColor: "#ffffff",
                    backgroundImage: "repeating-linear-gradient(45deg, #ffffff, #ffffff 4px, #f8fafc 4px, #f8fafc 8px)",
                    borderLeft: `1.5px dashed #94a3b8`,
                  }}>
                    {(100 - wasteLeft) > 6 && <span className="text-[9px] font-bold text-slate-400">{t("orderDetail.modalWaste")} {board.waste.toFixed(0)}mm</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-center mt-1">
                <div className="text-[10px] text-apple-gray font-mono">{boardDims.width}mm</div>
              </div>
            </div>
            <div className="w-full mt-3" style={{ maxWidth: `${MODAL_W + 20}px` }}>
              <div className="w-full bg-black/[0.04] rounded-full h-2 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${utilPct}%`, backgroundColor: utilColor, transition: "width 0.5s" }} />
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-0 overflow-auto max-h-[500px]">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-white">
                <tr className="bg-black/[0.02]">
                  <th className="text-left py-2.5 px-4 font-semibold text-apple-gray">#</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-apple-gray">{t("orderDetail.modalPartId")}</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-apple-gray">{t("orderDetail.modalComponent")}</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-apple-gray">{t("orderDetail.modalCabinetId")}</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-apple-gray">Height</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-apple-gray">Width</th>
                </tr>
              </thead>
              <tbody>
                {board.parts.map((p, idx) => (
                  <tr key={`${p.part_id}-${idx}`} className="border-b border-border/15 hover:bg-black/[0.01]">
                    <td className="py-2 px-4 text-apple-gray">{idx + 1}</td>
                    <td className="py-2 px-4 font-mono font-medium text-[11px]">{p.part_id}</td>
                    <td className="py-2 px-4 text-apple-gray">{p.component || "—"}</td>
                    <td className="py-2 px-4 text-apple-gray">{p.cab_id || "—"}</td>
                    <td className="py-2 px-4 text-right font-mono">{p.Height}</td>
                    <td className="py-2 px-4 text-right font-mono">{p.Width}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border/40 bg-black/[0.01]">
                  <td colSpan={4} className="py-2.5 px-4 text-[11px] text-apple-gray font-medium">
                    {board.parts.length} {t("orderDetail.thParts")} · {board.cuts} {t("orderDetail.thCuts")} · {t("orderDetail.modalKerf")}{board.kerf_total}mm · {t("orderDetail.modalWaste")}{board.waste.toFixed(1)}mm
                  </td>
                  <td colSpan={2} className="py-2.5 px-4 text-right text-[13px] font-bold" style={{ color: utilColor }}>
                    {t("orderDetail.thUtil")} {utilPct}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ConfirmCutModal — Confirm cutting, adjust extra boards, deduct inventory
   ═══════════════════════════════════════════ */
function ConfirmCutModal({ order, boards, onConfirmed, onClose }: {
  order: Order;
  boards: Board[];
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  /* Compute board usage by board_type */
  const boardUsage = useMemo(() => {
    const usage: Record<string, number> = {};
    for (const b of boards) {
      const bt = b.board;
      usage[bt] = (usage[bt] || 0) + 1;
    }
    return Object.entries(usage).map(([board_type, count]) => ({
      board_type,
      planned: count,
    }));
  }, [boards]);

  const [extras, setExtras] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    boardUsage.forEach((u) => { init[u.board_type] = 0; });
    return init;
  });
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adjustExtra = (bt: string, delta: number) => {
    setExtras((prev) => ({
      ...prev,
      [bt]: Math.max(0, (prev[bt] || 0) + delta),
    }));
  };

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);

    try {
      // 1. Deduct inventory for each board_type (planned + extra)
      for (const u of boardUsage) {
        const totalUsed = u.planned + (extras[u.board_type] || 0);
        if (totalUsed <= 0) continue;

        // Get current stock
        const { data: invData } = await supabase
          .from("inventory")
          .select("stock")
          .eq("board_type", u.board_type)
          .single();

        if (invData) {
          const newStock = Math.max(0, invData.stock - totalUsed);
          await supabase
            .from("inventory")
            .update({ stock: newStock })
            .eq("board_type", u.board_type);
        }
      }

      // 2. Insert cutting_stats
      const cutResult = order.cut_result_json;
      if (cutResult) {
        const statsRows: Array<{
          job_id: string;
          board_type: string;
          t2_height: number;
          t2_width: number;
          component: string;
          cab_id: string;
          quantity: number;
        }> = [];
        for (const board of cutResult.boards) {
          for (const part of board.parts) {
            statsRows.push({
              job_id: order.job_id,
              board_type: board.board,
              t2_height: part.Height,
              t2_width: part.Width,
              component: part.component || "",
              cab_id: part.cab_id || "",
              quantity: 1,
            });
          }
        }
        if (statsRows.length > 0) {
          await supabase.from("cutting_stats").insert(statsRows);
        }
      }

      // 3. Build extra_boards_used array
      const extraBoardsUsed = Object.entries(extras)
        .filter(([, count]) => count > 0)
        .map(([board_type, count]) => ({ board_type, count }));

      // 4. Update order status → cut_done
      await supabase
        .from("orders")
        .update({
          status: "cut_done",
          cut_confirmed_at: new Date().toISOString(),
          extra_boards_used: extraBoardsUsed,
        })
        .eq("id", order.id);

      onConfirmed();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("orderDetail.modalConfirmFailed"));
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />
      <div
        className="relative bg-white w-full max-w-lg rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.15)] border border-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <style>{`@keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>

        {/* Header */}
        <div className="p-6 border-b border-border/40">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-apple-blue/10 text-apple-blue flex items-center justify-center">
              <CheckCircle2 size={22} />
            </div>
            <h3 className="text-[20px] font-semibold tracking-tight">{t("orderDetail.modalConfirmTitle")}</h3>
          </div>
          <p className="text-[13px] text-apple-gray leading-relaxed">
            {t("orderDetail.modalConfirmDesc")}
          </p>
        </div>

        {/* Board usage table */}
        <div className="p-6">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border/40">
                <th className="text-left py-2 font-semibold text-apple-gray">{t("orderDetail.modalThBoardType")}</th>
                <th className="text-center py-2 font-semibold text-apple-gray">{t("orderDetail.modalThPlanned")}</th>
                <th className="text-center py-2 font-semibold text-apple-gray">{t("orderDetail.modalThExtra")}</th>
                <th className="text-center py-2 font-semibold text-apple-gray">{t("orderDetail.modalThTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {boardUsage.map((u) => {
                const extra = extras[u.board_type] || 0;
                return (
                  <tr key={u.board_type} className="border-b border-border/20">
                    <td className="py-3 font-medium">{u.board_type}</td>
                    <td className="py-3 text-center text-apple-gray">{u.planned}</td>
                    <td className="py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => adjustExtra(u.board_type, -1)}
                          disabled={extra <= 0}
                          className="w-6 h-6 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-apple-gray disabled:opacity-30 transition-colors"
                        >
                          <Minus size={12} />
                        </button>
                        <span className={`w-6 text-center font-bold ${extra > 0 ? "text-amber-600" : "text-apple-gray"}`}>
                          {extra}
                        </span>
                        <button
                          onClick={() => adjustExtra(u.board_type, 1)}
                          className="w-6 h-6 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-apple-gray transition-colors"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>
                    <td className="py-3 text-center font-bold text-foreground">{u.planned + extra}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-4 p-3 rounded-xl bg-red-50 text-red-600 text-[13px] font-medium">{error}</div>
        )}

        {/* Actions */}
        <div className="p-6 border-t border-border/40 flex gap-3">
          <button
            onClick={onClose}
            disabled={confirming}
            className="flex-1 px-4 py-3 rounded-xl bg-black/5 text-foreground text-[15px] font-semibold hover:bg-black/10 transition-colors disabled:opacity-50"
          >
            {t("orderDetail.modalCancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="flex-1 px-4 py-3 rounded-xl bg-apple-blue text-white text-[15px] font-semibold hover:bg-apple-blue/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {confirming ? (
              <><Loader2 size={16} className="animate-spin" /> {t("orderDetail.processing")}</>
            ) : (
              <><CheckCircle2 size={16} /> {t("orderDetail.modalConfirmBtn")}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════
   Machine Cut Plan i18n lookup (independent of app locale)
   ═══════════════════════════════════════════ */
const machineI18n: Record<string, Record<string, string>> = {
  zh: {
    tabLabel: "机台裁切方案",
    engineeringNo: "工程",
    boardType: "板材型号",
    boardWidth: "板材宽度",
    totalLength: "总长度",
    trimSetting: "修边设置",
    sourceBoardCount: "来源板数",
    suggestedStack: "建议叠切",
    rowNo: "序号",
    cutLength: "裁切长度 (mm)",
    pieces: "件数",
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
  },
  en: {
    tabLabel: "Machine Cut Plan",
    engineeringNo: "Engineering",
    boardType: "Board Type",
    boardWidth: "Board Width",
    totalLength: "Total Length",
    trimSetting: "Trim Setting",
    sourceBoardCount: "Source Boards",
    suggestedStack: "Suggested Stack",
    rowNo: "Row",
    cutLength: "Cut Length (mm)",
    pieces: "Pieces",
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
  },
  es: {
    tabLabel: "Plan de Corte de Máquina",
    engineeringNo: "Ingeniería",
    boardType: "Tipo de Tablero",
    boardWidth: "Ancho del Tablero",
    totalLength: "Longitud Total",
    trimSetting: "Ajuste de Recorte",
    sourceBoardCount: "Tableros Fuente",
    suggestedStack: "Apilado Sugerido",
    rowNo: "Fila",
    cutLength: "Longitud de Corte (mm)",
    pieces: "Piezas",
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
  },
};


/* ═══════════════════════════════════════════
   MachineCutPlan — Worker-facing machine operation view
   ═══════════════════════════════════════════ */
interface EngineeringGroup {
  key: string;
  engNo: number;
  boardType: string;
  boardWidth: number;
  totalLength: number;
  trimSetting: number;
  sourceBoardCount: number;
  boards: Board[];
  cutRows: { cutLength: number; pieces: number }[];
  stackBatches: { batchNo: number; stackSize: number; coveredBoards: number; cutSequence: string; sampleBoard: Board }[];
}

function MachineCutPlan({ boards, orderId, machineLang, setMachineLang }: { boards: Board[], orderId: string, machineLang: "zh" | "en" | "es", setMachineLang: (l: "zh" | "en" | "es") => void }) {
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
    return 2438.4;
  };

  /* ── Build engineering groups: group by strip_width ── */
  const engineeringGroups = useMemo<EngineeringGroup[]>(() => {
    // Group boards by strip_width (the actual operational width for the machine)
    const groupMap: Record<number, Board[]> = {};
    for (const b of boards) {
      const w = b.strip_width || 0;
      if (!groupMap[w]) groupMap[w] = [];
      groupMap[w].push(b);
    }

    // Sort by width descending so wider groups appear first
    return Object.entries(groupMap)
      .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
      .map(([widthStr, grpBoards], idx) => {
      const width = parseFloat(widthStr);
      const sample = grpBoards[0];
      const totalLength = parseTotalLength(sample.board_size);
      const trimSetting = 5;

      // Collect all distinct board type names for the header
      const boardTypes = [...new Set(grpBoards.map(b => b.board))];
      const boardType = boardTypes.join(" / ");

      // Aggregate cut rows by cut_length
      const cutMap: Record<number, number> = {};
      for (const b of grpBoards) {
        for (const p of b.parts) {
          const cl = p.cut_length || p.Height;
          cutMap[cl] = (cutMap[cl] || 0) + 1;
        }
      }
      const cutRows = Object.entries(cutMap)
        .map(([len, qty]) => ({ cutLength: parseFloat(len), pieces: qty }))
        .sort((a, b) => a.cutLength - b.cutLength);

      // Stack batches: reuse boardFingerprint logic
      const fpMap: Record<string, { board: Board; index: number }[]> = {};
      for (let i = 0; i < grpBoards.length; i++) {
        const fp = boardFingerprint(grpBoards[i]);
        if (!fpMap[fp]) fpMap[fp] = [];
        fpMap[fp].push({ board: grpBoards[i], index: i });
      }
      const stackBatches: EngineeringGroup["stackBatches"] = [];
      let batchNo = 0;
      for (const group of Object.values(fpMap)) {
        let remaining = group.length;
        let gIdx = 0;
        while (remaining > 0) {
          const stackSize = Math.min(4, remaining);
          batchNo++;
          const sampleBoard = group[gIdx].board;
          const seq = sampleBoard.parts
            .map(p => (p.cut_length || p.Height).toFixed(1))
            .join(" → ");
          stackBatches.push({
            batchNo,
            stackSize,
            coveredBoards: stackSize,
            cutSequence: seq,
            sampleBoard,
          });
          gIdx += stackSize;
          remaining -= stackSize;
        }
      }

      return {
        key: `w${width}`,
        engNo: idx + 1,
        boardType,
        boardWidth: width,
        totalLength,
        trimSetting,
        sourceBoardCount: grpBoards.length,
        boards: grpBoards,
        cutRows,
        stackBatches,
      };
    });
  }, [boards]);

  const handlePrint = () => {
    window.print();
  };

  if (boards.length === 0) {
    return (
      <div className="bg-card rounded-xl shadow-apple border border-border/30 p-12 text-center">
        <p className="text-apple-gray text-[15px]">{mt("noData")}</p>
      </div>
    );
  }

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .machine-cut-plan, .machine-cut-plan * { visibility: visible !important; }
          .machine-cut-plan { position: absolute; top: 0; left: 0; width: 100%; }
          .machine-no-print { display: none !important; }
          .machine-eng-group { page-break-inside: avoid; break-inside: avoid; page-break-after: always; }
          .machine-eng-group:last-child { page-break-after: auto; }
          .machine-print-only { display: block !important; }
          .machine-eng-group details { display: block !important; }
          .machine-eng-group details > summary { display: none !important; }
          .machine-eng-group details > div, .machine-eng-group details > table { display: table !important; }
          @page { size: A4; margin: 12mm 10mm; }
        }
      `}</style>

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

        <div className="machine-print-only" style={{ display: "none" }}>
          <div style={{ textAlign: "center", marginBottom: "12px" }}>
            <h1 style={{ fontSize: "20px", fontWeight: 700 }}>{mt("printTitle")}</h1>
            <p style={{ fontSize: "13px", color: "#666" }}>{mt("orderNo")}: {orderId}</p>
          </div>
        </div>

        {engineeringGroups.map((grp) => (
          <div key={grp.key} className="bg-white rounded-xl shadow-sm border border-border overflow-hidden print:shadow-none print:border-none print:mb-12 print:break-after-page">
            
            <div className="bg-white text-slate-800 p-5 border-b border-border/60 print:p-0 print:border-b-2 print:border-black print:mb-6">
              <div className="flex items-center justify-between mb-4 print:mb-2">
                <h3 className="text-xl font-bold">{mt("engineeringNo")} {grp.engNo}</h3>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <div className="text-[11px] text-apple-gray uppercase font-semibold mb-1">{mt("boardWidth")}</div>
                  <div className="font-bold text-lg">{grp.boardWidth} mm</div>
                </div>
                <div>
                  <div className="text-[11px] text-apple-gray uppercase font-semibold mb-1">{mt("totalLength")}</div>
                  <div className="font-medium">{grp.totalLength} mm</div>
                </div>
                <div>
                  <div className="text-[11px] text-apple-gray uppercase font-semibold mb-1">{mt("trimSetting")}</div>
                  <div className="font-medium">{grp.trimSetting} mm</div>
                </div>
                <div>
                  <div className="text-[11px] text-apple-gray uppercase font-semibold mb-1">{mt("boardType")}</div>
                  <div className="font-medium truncate" title={grp.boardType}>{grp.boardType}</div>
                </div>
                <div>
                  <div className="text-[11px] text-apple-gray uppercase font-semibold mb-1">{mt("sourceBoardCount")}</div>
                  <div className="font-bold">{grp.sourceBoardCount} {mt("sheetsUnit")}</div>
                </div>
              </div>
            </div>

            <div className="p-5 border-b border-border/40 bg-slate-50/50 print:hidden overflow-x-auto">
              <div className="flex gap-4 min-w-max pb-2">
                {grp.stackBatches.map((batch, bIdx) => (
                  <BoardTile 
                    key={bIdx}
                    board={batch.sampleBoard}
                    index={bIdx}
                    color={sizeColorMap[batch.sampleBoard.board_size] || SIZE_COLORS[0]}
                    stackInfo={{ groupSize: batch.stackSize, stackOf: batch.stackSize, isLeader: true }}
                    onClick={() => {}}
                    disableHover={true}
                  />
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-black/[0.03]">
                    <th className="text-center py-3 px-4 font-semibold text-apple-gray w-16">{mt("rowNo")}</th>
                    <th className="text-center py-3 px-4 font-semibold text-apple-gray">{mt("cutLength")}</th>
                    <th className="text-center py-3 px-4 font-semibold text-apple-gray w-24">{mt("pieces")}</th>
                    <th className="text-left py-3 px-4 font-semibold text-apple-gray">{mt("notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {grp.cutRows.map((row, ri) => (
                    <tr key={ri} className="border-b border-border/20 hover:bg-black/[0.01]">
                      <td className="py-2.5 px-4 text-center text-apple-gray">{ri + 1}</td>
                      <td className="py-2.5 px-4 text-center font-mono font-bold text-[15px]">{row.cutLength}</td>
                      <td className="py-2.5 px-4 text-center font-bold text-[15px]">{row.pieces}</td>
                      <td className="py-2.5 px-4 text-apple-gray">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Stack Suggestions (always visible if >1 board) */}
            {grp.sourceBoardCount > 1 && grp.stackBatches.length > 0 && (
              <div className="border-t border-border/30 bg-blue-50/50 p-4">
                <h4 className="flex items-center gap-2 mb-3 text-[14px] font-bold text-blue-800 machine-no-print">
                  <span className="bg-blue-600 text-white px-2 py-0.5 rounded text-[11px]">需叠切</span>
                  {mt("stackSuggestions")} ({grp.stackBatches.length})
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-white/50 border-b border-blue-200">
                        <th className="text-center py-2 px-3 font-semibold text-blue-900">{mt("stackBatch")}</th>
                        <th className="text-center py-2 px-3 font-semibold text-blue-900">{mt("suggestedStack")}</th>
                        <th className="text-center py-2 px-3 font-semibold text-blue-900">{mt("stackBoards")}</th>
                        <th className="text-left py-2 px-3 font-semibold text-blue-900">{mt("stackSequence")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grp.stackBatches.map((sb) => (
                        <tr key={sb.batchNo} className="border-b border-blue-100 last:border-0">
                          <td className="py-2 px-3 text-center font-medium text-blue-900">{sb.batchNo}</td>
                          <td className="py-2 px-3 text-center">
                            <span className="px-2 py-0.5 rounded bg-blue-200 text-blue-800 text-[11px] font-bold shadow-sm">
                              {sb.stackSize} {mt("stackSize")}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center font-medium text-blue-900">{sb.coveredBoards} {mt("sheetsUnit")}</td>
                          <td className="py-2 px-3 font-mono text-[11px] text-blue-800">{sb.cutSequence}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Print-only Stack Suggestions (Hidden if only 1 board) */}
            {grp.sourceBoardCount > 1 && grp.stackBatches.length > 0 && (
              <div className="hidden print:block mt-4 px-5 pb-5 text-[11px]">
                <h4 className="font-bold mb-2 text-black">📦 {mt("stackSuggestions")}</h4>
                <table className="w-full text-left border-collapse border border-black">
                  <thead>
                    <tr>
                      <th className="border border-black p-1 text-black">批次</th>
                      <th className="border border-black p-1 text-black">张/叠</th>
                      <th className="border border-black p-1 text-black">裁切顺序 (mm)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grp.stackBatches.map(b => (
                      <tr key={b.batchNo}>
                        <td className="border border-black p-1 text-black">#{b.batchNo}</td>
                        <td className="border border-black p-1 text-black">{b.stackSize}</td>
                        <td className="border border-black p-1 font-mono text-black">{b.cutSequence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}


            {/* Print-only: Operator fields */}
            <div className="machine-print-only" style={{ display: "none", padding: "16px", borderTop: "1px solid #e5e7eb" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", fontSize: "13px" }}>
                <div style={{ borderBottom: "1px solid #ccc", paddingBottom: "8px" }}>
                  <strong>{mt("operator")}:</strong> _______________
                </div>
                <div style={{ borderBottom: "1px solid #ccc", paddingBottom: "8px" }}>
                  <strong>{mt("firstPieceCheck")}:</strong> _______________
                </div>
                <div style={{ borderBottom: "1px solid #ccc", paddingBottom: "8px" }}>
                  <strong>{mt("completionCheck")}:</strong> _______________
                </div>
                <div style={{ borderBottom: "1px solid #ccc", paddingBottom: "8px" }}>
                  <strong>{mt("printNotes")}:</strong> _______________
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
