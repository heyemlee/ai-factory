"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Layers, Package, BarChart3, Scissors, X, AlertTriangle, Table2, LayoutGrid, CheckCircle2, Plus, Minus, Loader2, Box } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import dynamic from "next/dynamic";

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


/* Board size color palette — max 5 distinct colors */
const SIZE_COLORS = [
  { bg: "#dbeafe", border: "#3b82f6", text: "#1d4ed8", light: "#eff6ff" },
  { bg: "#f3e8ff", border: "#8b5cf6", text: "#6d28d9", light: "#faf5ff" },
  { bg: "#d1fae5", border: "#10b981", text: "#047857", light: "#ecfdf5" },
  { bg: "#ffedd5", border: "#f97316", text: "#c2410c", light: "#fff7ed" },
  { bg: "#fce7f3", border: "#ec4899", text: "#be185d", light: "#fdf2f8" },
];

/* ── Stack cutting: fingerprint a board by its cutting pattern ── */
function boardFingerprint(board: Board): string {
  const partSig = board.parts
    .map((p) => `${p.cut_length || p.Height}x${p.Width}`)
    .join(",");
  return `${board.board_size}|${partSig}`;
}

export default function OrderDetail() {
  const params = useParams();
  const id = params?.id || "N/A";

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [viewMode, setViewMode] = useState<"layout" | "table" | "cabinets">("layout");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedCabinetId, setSelectedCabinetId] = useState<string | null>(null);
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null);


  useEffect(() => {
    supabase
      .from("orders")
      .select("*")
      .eq("job_id", id as string)
      .single()
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
    const fpMap: Record<string, Board[]> = {};
    for (const b of boards) {
      const fp = boardFingerprint(b);
      if (!fpMap[fp]) fpMap[fp] = [];
      fpMap[fp].push(b);
    }
    // Build a lookup: board_id → stack info
    const lookup: Record<string, { groupSize: number; stackOf: number; isLeader: boolean }> = {};
    for (const group of Object.values(fpMap)) {
      if (group.length < 2) {
        // No stacking possible
        for (const b of group) {
          lookup[b.board_id] = { groupSize: 1, stackOf: 1, isLeader: true };
        }
      } else {
        // Split into stacks of max 4
        let remaining = group.length;
        let idx = 0;
        while (remaining > 0) {
          const stackSize = Math.min(4, remaining);
          for (let i = 0; i < stackSize; i++) {
            lookup[group[idx].board_id] = { groupSize: group.length, stackOf: stackSize, isLeader: i === 0 };
            idx++;
          }
          remaining -= stackSize;
        }
      }
    }
    // Summary: how many actual cuts needed vs total boards
    const totalBoards = boards.length;
    let totalCuts = 0;
    const counted = new Set<string>();
    for (const group of Object.values(fpMap)) {
      if (counted.has(group[0].board_id)) continue;
      let remaining = group.length;
      while (remaining > 0) {
        totalCuts++;
        remaining -= Math.min(4, remaining);
      }
      for (const b of group) counted.add(b.board_id);
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
      .single()
      .then(({ data }) => {
        if (data) setOrder(data as Order);
      });
    setShowConfirmModal(false);
  }, [id]);

  if (loading) {
    return (
      <div className="w-full py-4 flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-apple-blue/30 border-t-apple-blue rounded-full animate-spin mx-auto" />
          <p className="text-apple-gray text-[15px]">加载裁切数据...</p>
        </div>
      </div>
    );
  }

  if (!order || !cutResult) {
    return (
      <div className="w-full py-4 space-y-4">
        <Link href="/orders" className="inline-flex items-center gap-2 text-apple-blue text-[14px] font-medium hover:underline">
          <ArrowLeft size={16} /> 返回订单
        </Link>
        <div className="bg-card rounded-2xl p-12 shadow-apple text-center">
          <p className="text-apple-gray text-[15px]">
            {order?.status === "pending" ? "订单处理中，请稍后刷新..." : "未找到裁切结果数据"}
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
            <h1 className="text-[26px] font-semibold tracking-tight">裁切方案 #{id as string}</h1>
            <p className="text-apple-gray text-[14px] mt-0.5">{order.cabinets_summary || "Cutting Layout"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="flex bg-black/[0.04] p-1 rounded-xl">
            <button onClick={() => setViewMode("layout")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${viewMode === "layout" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"}`}>
              <LayoutGrid size={14} /> 裁切图
            </button>
            <button onClick={() => setViewMode("table")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${viewMode === "table" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"}`}>
              <Table2 size={14} /> 数据表
            </button>
            <button onClick={() => setViewMode("cabinets")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${viewMode === "cabinets" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"}`}>
              <Box size={14} /> 柜体试图
            </button>
          </div>

          {/* Status / Confirm button */}
          {isCutDone ? (
            <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium bg-apple-green/10 text-apple-green">
              <CheckCircle2 size={14} /> 已确认裁切
            </span>
          ) : isCompleted ? (
            <button
              onClick={() => setShowConfirmModal(true)}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-[13px] font-medium bg-apple-blue text-white hover:bg-apple-blue/90 shadow-sm transition-colors"
            >
              <CheckCircle2 size={14} /> 确认裁切完成
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
            <p className="text-[14px] font-semibold text-amber-800">⚠️ 库存不足</p>
            <p className="text-[13px] text-amber-700 mt-1">以下板材库存不足，裁切方案仍按当前规格出具，请及时补货：</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {shortages.map(s => (
                <span key={s.board_type} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-100 text-amber-800 text-[12px] font-medium">
                  {s.board_type}: 需{s.needed}张 / 库存{s.stock}张 / 缺{s.shortage}张
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<Layers size={18} />} label="大板数量" value={String(summary?.boards_used || 0)} color="#3b82f6" />
        <StatCard icon={<Package size={18} />} label="零件总数" value={String(summary?.total_parts_placed || 0)} color="#8b5cf6" />
        <StatCard icon={<BarChart3 size={18} />} label="整体利用率" value={`${((summary?.overall_utilization || 0) * 100).toFixed(1)}%`} color="#10b981" />
        <StatCard icon={<Scissors size={18} />} label="总废料" value={`${((summary?.total_waste || 0) / 1000).toFixed(1)}m`} color="#f59e0b" />
      </div>

      {/* ── Stack Cutting Optimization Banner ── */}
      {stackGroups.saved > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <Layers size={20} className="text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-semibold text-blue-800">
              📦 叠切优化：可节省 {stackGroups.saved} 次裁切
            </p>
            <p className="text-[13px] text-blue-700 mt-1">
              {stackGroups.totalBoards}张板材 → 叠切后仅需裁切 {stackGroups.totalCuts} 次（最多4张叠切）。
              标记 <span className="inline-flex items-center px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold mx-0.5">×N</span> 的板材可叠在一起切。
            </p>
          </div>
        </div>
      )}

      {/* ── Board Size Legend ── */}
      <div className="flex flex-wrap gap-2">
        {sizeGroups.map(([size, boardList]) => {
          const c = sizeColorMap[size];
          return (
            <div key={size} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium border" style={{
              backgroundColor: c.light, borderColor: c.border + "40", color: c.text,
            }}>
              <span className="w-3 h-3 rounded" style={{ backgroundColor: c.bg, border: `1.5px solid ${c.border}` }} />
              {size}mm · {boardList.length}张
            </div>
          );
        })}
      </div>

      {/* ── Layout View: Flat tile grid ── */}
      {viewMode === "layout" && (
        <div className="flex flex-wrap gap-x-12 gap-y-16 pt-8 pb-12 pl-6 pr-6 justify-center sm:justify-start">
          {boards.filter(board => stackGroups.lookup[board.board_id]?.isLeader).map((board, idx) => (
            <BoardTile
              key={board.board_id}
              board={board}
              index={idx}
              color={sizeColorMap[board.board_size]}
              stackInfo={stackGroups.lookup[board.board_id]}
              onClick={() => setSelectedBoard(board)}
            />
          ))}
        </div>
      )}

      {/* ── Table View ── */}
      {viewMode === "table" && (
        <div className="bg-card rounded-xl shadow-apple border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-black/[0.02]">
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">#</th>
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">板材ID</th>
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">板材类型</th>
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">尺寸</th>
                  <th className="text-center py-3 px-4 font-semibold text-apple-gray">零件数</th>
                  <th className="text-center py-3 px-4 font-semibold text-apple-gray">刀数</th>
                  <th className="text-right py-3 px-4 font-semibold text-apple-gray">废料(mm)</th>
                  <th className="text-right py-3 px-4 font-semibold text-apple-gray">利用率</th>
                  <th className="text-center py-3 px-4 font-semibold text-apple-gray">叠切</th>
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">零件明细</th>
                </tr>
              </thead>
              <tbody>
                {boards.map((board, idx) => {
                  const c = sizeColorMap[board.board_size];
                  const utilPct = (board.utilization * 100).toFixed(1);
                  const utilNum = parseFloat(utilPct);
                  const si = stackGroups.lookup[board.board_id];
                  return (
                    <tr key={board.board_id} className="border-b border-border/20 hover:bg-black/[0.01]">
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
                      <td className="py-2.5 px-4 text-right font-mono">{board.waste.toFixed(0)}</td>
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
                选择柜体 ({cabinets.length})
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
                      {cab.cab_type} · {cab.parts.length}板件
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
                柜体零件清单
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
                      {p.component || "未命名部位"}
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
function BoardTile({ board, index, color, stackInfo, onClick }: {
  board: Board;
  index: number;
  color: typeof SIZE_COLORS[0];
  stackInfo?: { groupSize: number; stackOf: number; isLeader: boolean };
  onClick: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  const boardDims = useMemo(() => {
    const p = board.board_size.split("×").map((s) => parseFloat(s.trim()));
    return { width: p[0] || 0, height: p[1] || 0 };
  }, [board.board_size]);

  const TILE_BASE_H = 200;
  const widthRatio = boardDims.width / boardDims.height;
  const stretchFactor = widthRatio < 0.3 ? 1.8 : widthRatio < 0.5 ? 1.4 : 1.2;
  const tileW = Math.max(60, Math.round(TILE_BASE_H * widthRatio * stretchFactor));
  const tileH = TILE_BASE_H;

  const partLayout = useMemo(() => {
    if (!boardDims.height) return [];
    const bH = boardDims.height;
    const bW = boardDims.width;
    let y = board.trim_loss;
    return board.parts.map((p, idx) => {
      const pH = p.cut_length || p.Height;
      const pW = p.Width;
      const top = (y / bH) * 100;
      const height = (pH / bH) * 100;
      const width = Math.min((pW / bW) * 100, 100);
      y += pH + board.saw_kerf;
      return { ...p, top, height, width, idx };
    });
  }, [board, boardDims]);

  const wasteTop = useMemo(() => {
    if (!partLayout.length) return 100;
    const last = partLayout[partLayout.length - 1];
    return last.top + last.height + 0.2;
  }, [partLayout]);

  const utilPct = (board.utilization * 100).toFixed(1);
  const utilNum = parseFloat(utilPct);
  const utilColor = utilNum > 80 ? "#10b981" : utilNum > 60 ? "#f59e0b" : "#ef4444";

  const stackOf = stackInfo?.stackOf || 1;

  return (
    <div
      // elevate z-index massively so the hover popout spans over adjacent items without layout shift
      className={`relative cursor-pointer transition-all duration-300 ${isHovered ? 'z-50' : 'z-0'}`}
      style={{ width: `${tileW + 24}px`, height: `${tileH + 36}px` }}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Floating Badge above the card */}
      {stackOf > 1 && (
        <div 
          className="absolute left-1/2 -translate-x-1/2 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] z-50 rounded-full px-2 py-0.5 pointer-events-none flex items-center shadow-lg border"
          style={{
             top: isHovered ? '-40px' : '-20px',
             background: color.bg, // Matches the size legend background color
             borderColor: color.border,
             color: color.text,
             transform: isHovered ? `translateX(-50%) scale(1.15)` : `translateX(-50%) scale(1)`,
             opacity: 1
          }}
        >
          <span className="font-bold text-[11px] whitespace-nowrap">×{stackOf} 叠切</span>
        </div>
      )}

      {/* Backdrops for stack effect (animated on hover to fan out like cards) */}
      {stackOf > 1 && Array.from({ length: stackOf - 1 }).map((_, domIndex) => {
        const depth = Math.min(stackOf - 1, 4) - domIndex; 
        
        const direction = (depth % 2 !== 0) ? -1 : 1; 
        const currentSpread = Math.ceil(depth / 2); 
        
        const baseTransform = `translate(${depth * 4}px, ${depth * 4}px) rotate(0deg) scale(1)`;
        // Macbook pop effect: extreme pop scale and spaced left and right symmetrically
        const hoverTransform = `translate(${direction * currentSpread * 45}px, -15px) rotate(${direction * currentSpread * 6}deg) scale(1.15)`;
        
        return (
          <div 
            key={domIndex}
            className="absolute top-0 left-0 bg-white rounded-xl border transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-bottom-left"
            style={{ 
              borderColor: color.border + "30", 
              width: `100%`, 
              height: `100%`,
              transform: isHovered ? hoverTransform : baseTransform,
              boxShadow: isHovered ? 'inset 0 0 0 1px rgba(0,0,0,0.12), 0 8px 30px rgba(0,0,0,0.12)' : 'inset 0 0 0 1px rgba(0,0,0,0.08)'
            }}
          >
             <div 
               className="w-full h-full rounded-xl transition-opacity duration-500" 
               style={{ backgroundColor: color.light, opacity: isHovered ? 0.8 : 0.3 }} 
             />
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
          transform: isHovered ? `translate(0px, -20px) rotate(0deg) scale(1.25)` : `translate(0px, 0px) rotate(0deg) scale(1)`,
          boxShadow: isHovered ? '0 20px 40px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.04)'
        }}
      >
        {/* Board title without inline badge to keep it clean */}
        <div className="px-2 pt-2 pb-1 flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[10px] font-semibold text-foreground truncate">{board.board_id}</span>
          </div>
          <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color: utilColor }}>{utilPct}%</span>
        </div>

        {/* Board visual */}
        <div className="px-2 pb-2 flex justify-center">
          <div className="relative rounded-sm overflow-hidden" style={{
            width: `${tileW}px`, height: `${tileH}px`,
            backgroundColor: color.light, border: `1.5px solid ${color.border}50`,
          }}>
            {partLayout.map((p) => (
              <div key={`${p.part_id}-${p.idx}`} className="absolute" style={{
                top: `${p.top}%`, left: `0%`, width: `${p.width}%`, height: `${p.height}%`,
                backgroundColor: color.bg,
                borderBottom: `1px solid ${color.border}60`,
                borderRight: p.width < 100 ? `1px solid ${color.border}60` : undefined,
              }} />
            ))}
            {wasteTop < 96 && (
              <div className="absolute left-0 w-full" style={{
                top: `${wasteTop}%`, height: `${Math.max(100 - wasteTop, 0)}%`,
                background: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
                borderTop: "1px dashed #ddd",
              }} />
            )}
          </div>
        </div>
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
  const boardDims = useMemo(() => {
    const p = board.board_size.split("×").map((s) => parseFloat(s.trim()));
    return { width: p[0] || 0, height: p[1] || 0 };
  }, [board.board_size]);

  const MODAL_H = 400;
  const widthRatio = boardDims.width / boardDims.height;
  const stretchFactor = widthRatio < 0.3 ? 2.2 : widthRatio < 0.5 ? 1.6 : 1.3;
  const modalVisualW = Math.max(100, Math.round(MODAL_H * widthRatio * stretchFactor));

  const partLayout = useMemo(() => {
    if (!boardDims.height) return [];
    let y = board.trim_loss;
    return board.parts.map((p, idx) => {
      const pH = p.cut_length || p.Height;
      const pW = p.Width;
      const top = (y / boardDims.height) * 100;
      const height = (pH / boardDims.height) * 100;
      const width = Math.min((pW / boardDims.width) * 100, 100);
      y += pH + board.saw_kerf;
      return { ...p, top, height, width, idx };
    });
  }, [board, boardDims]);

  const wasteTop = useMemo(() => {
    if (!partLayout.length) return 100;
    const last = partLayout[partLayout.length - 1];
    return last.top + last.height + 0.2;
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
              <p className="text-[13px] text-apple-gray">{board.board} · {board.board_size}mm · {board.parts.length}零件 · {board.cuts}刀</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[18px] font-bold" style={{ color: utilColor }}>{utilPct}%</span>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-black/5 transition-colors"><X size={18} className="text-apple-gray" /></button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row">
          <div className="p-5 flex flex-col items-center justify-start lg:border-r border-border/30 bg-[#fafafa] shrink-0">
            <div className="flex items-center gap-1 mb-2">
              <div className="h-px bg-apple-gray/20" style={{ width: "16px" }} />
              <span className="text-[10px] text-apple-gray font-mono">{boardDims.width}mm</span>
              <div className="h-px bg-apple-gray/20" style={{ width: "16px" }} />
            </div>
            <div className="flex items-stretch gap-1.5">
              <div className="relative rounded-sm overflow-hidden" style={{
                width: `${modalVisualW}px`, height: `${MODAL_H}px`,
                backgroundColor: color.light, border: `2px solid ${color.border}60`,
              }}>
                {partLayout.map((p) => {
                  const partPxH = (p.height / 100) * MODAL_H;
                  const partPxW = (p.width / 100) * modalVisualW;
                  const showText = partPxH > 14 && partPxW > 35;
                  const showDims = partPxH > 26 && partPxW > 50;
                  return (
                    <div key={`${p.part_id}-${p.idx}`} className="absolute flex items-center justify-center overflow-hidden" style={{
                      top: `${p.top}%`, left: `0%`, width: `${p.width}%`, height: `${p.height}%`,
                      backgroundColor: color.bg,
                      borderBottom: `1px solid ${color.border}70`,
                      borderRight: p.width < 100 ? `1px solid ${color.border}70` : undefined,
                    }}>
                      {showText && (
                        <div className="text-center leading-tight select-none px-0.5">
                          <span className="text-[9px] font-bold block truncate" style={{ color: color.text }}>{p.component || p.part_id}</span>
                          {showDims && <span className="text-[8px] block truncate" style={{ color: color.text + "80" }}>{p.Width}×{p.Height}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {wasteTop < 96 && (
                  <div className="absolute left-0 w-full flex items-center justify-center" style={{
                    top: `${wasteTop}%`, height: `${Math.max(100 - wasteTop, 0)}%`,
                    background: "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.02) 3px, rgba(0,0,0,0.02) 6px)",
                    borderTop: "1px dashed #ddd",
                  }}>
                    {(100 - wasteTop) > 6 && <span className="text-[8px] text-gray-400 font-bold">废料 {board.waste.toFixed(0)}mm</span>}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-center justify-center">
                <div className="text-[10px] text-apple-gray font-mono" style={{ writingMode: "vertical-rl" }}>{boardDims.height}mm</div>
              </div>
            </div>
            <div className="w-full mt-3" style={{ maxWidth: `${modalVisualW + 20}px` }}>
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
                  <th className="text-left py-2.5 px-4 font-semibold text-apple-gray">零件ID</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-apple-gray">部位</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-apple-gray">柜号</th>
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
                    {board.parts.length}零件 · {board.cuts}刀 · 锯缝{board.kerf_total}mm · 废料{board.waste.toFixed(1)}mm
                  </td>
                  <td colSpan={2} className="py-2.5 px-4 text-right text-[13px] font-bold" style={{ color: utilColor }}>
                    利用率 {utilPct}%
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
      setError(e instanceof Error ? e.message : "确认失败");
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
            <h3 className="text-[20px] font-semibold tracking-tight">确认裁切完成</h3>
          </div>
          <p className="text-[13px] text-apple-gray leading-relaxed">
            确认后将扣减库存并记录裁切统计。如有板材损坏等额外消耗，请在下方调整。
          </p>
        </div>

        {/* Board usage table */}
        <div className="p-6">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border/40">
                <th className="text-left py-2 font-semibold text-apple-gray">板材类型</th>
                <th className="text-center py-2 font-semibold text-apple-gray">计划用量</th>
                <th className="text-center py-2 font-semibold text-apple-gray">额外消耗</th>
                <th className="text-center py-2 font-semibold text-apple-gray">总计扣减</th>
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
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="flex-1 px-4 py-3 rounded-xl bg-apple-blue text-white text-[15px] font-semibold hover:bg-apple-blue/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {confirming ? (
              <><Loader2 size={16} className="animate-spin" /> 处理中...</>
            ) : (
              <><CheckCircle2 size={16} /> 确认并扣减库存</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
