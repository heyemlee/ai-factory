"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Layers, Package, BarChart3, Scissors, X, AlertTriangle, Table2, LayoutGrid } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

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
  id: number;
  job_id: string;
  status: string;
  cut_result_json: CutResult | null;
  cabinets_summary: string;
}

/*
 * Board size color palette — max 5 distinct colors.
 * Each unique board_size gets ONE consistent color.
 */
const SIZE_COLORS = [
  { bg: "#dbeafe", border: "#3b82f6", text: "#1d4ed8", light: "#eff6ff" },   // blue
  { bg: "#f3e8ff", border: "#8b5cf6", text: "#6d28d9", light: "#faf5ff" },   // purple
  { bg: "#d1fae5", border: "#10b981", text: "#047857", light: "#ecfdf5" },   // green
  { bg: "#ffedd5", border: "#f97316", text: "#c2410c", light: "#fff7ed" },   // orange
  { bg: "#fce7f3", border: "#ec4899", text: "#be185d", light: "#fdf2f8" },   // pink
];

export default function OrderDetail() {
  const params = useParams();
  const id = params?.id || "N/A";

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [viewMode, setViewMode] = useState<"layout" | "table">("layout");

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

  /* Build a stable size→color map (max 5 colors) */
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

  /* Group boards by board_size for the legend */
  const sizeGroups = useMemo(() => {
    const groups: Record<string, Board[]> = {};
    for (const b of boards) {
      if (!groups[b.board_size]) groups[b.board_size] = [];
      groups[b.board_size].push(b);
    }
    return Object.entries(groups);
  }, [boards]);

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
            <button
              onClick={() => setViewMode("layout")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                viewMode === "layout" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"
              }`}
            >
              <LayoutGrid size={14} /> 裁切图
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                viewMode === "table" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"
              }`}
            >
              <Table2 size={14} /> 数据表
            </button>
          </div>
          <span className={`px-4 py-2 rounded-full text-[13px] font-medium capitalize ${
            order.status === "completed" ? "bg-apple-green/10 text-apple-green" :
            order.status === "failed" ? "bg-red-100 text-red-600" :
            "bg-apple-blue/10 text-apple-blue"
          }`}>{order.status}</span>
        </div>
      </div>

      {/* ── Inventory Shortage Warning ── */}
      {shortages.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-semibold text-amber-800">⚠️ 库存不足</p>
            <p className="text-[13px] text-amber-700 mt-1">
              以下板材库存不足，裁切方案仍按当前规格出具，请及时补货：
            </p>
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

      {/* ── Board Size Legend (color key) ── */}
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
        <div className="flex flex-wrap gap-4">
          {boards.map((board, idx) => (
            <BoardTile
              key={board.board_id}
              board={board}
              index={idx}
              color={sizeColorMap[board.board_size]}
              onClick={() => setSelectedBoard(board)}
            />
          ))}
        </div>
      )}

      {/* ── Table View: All cutting data ── */}
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
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">零件明细</th>
                </tr>
              </thead>
              <tbody>
                {boards.map((board, idx) => {
                  const c = sizeColorMap[board.board_size];
                  const utilPct = (board.utilization * 100).toFixed(1);
                  const utilNum = parseFloat(utilPct);
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
                      <td className="py-2.5 px-4 text-right font-bold" style={{
                        color: utilNum > 80 ? "#10b981" : utilNum > 60 ? "#f59e0b" : "#ef4444",
                      }}>{utilPct}%</td>
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

      {/* ── Board Detail Modal ── */}
      {selectedBoard && (
        <BoardDetailModal
          board={selectedBoard}
          color={sizeColorMap[selectedBoard.board_size]}
          onClose={() => setSelectedBoard(null)}
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

/* ======================================================
   BoardTile — Small tile for the flat grid overview
   Each board is its own natural size, no T0 reference frame.
   Wider proportions for narrow boards.
   ====================================================== */
function BoardTile({ board, index, color, onClick }: {
  board: Board;
  index: number;
  color: typeof SIZE_COLORS[0];
  onClick: () => void;
}) {
  /* Parse board dimensions */
  const boardDims = useMemo(() => {
    const p = board.board_size.split("×").map((s) => parseFloat(s.trim()));
    return { width: p[0] || 0, height: p[1] || 0 };
  }, [board.board_size]);

  /*
   * Visual sizing: board is its own size (no T0 background).
   * 48" horizontal = 1219.2mm, 96" vertical = 2438.4mm.
   * We scale proportionally but ensure narrow boards are still readable.
   * Target: ~120px wide for a 609.6mm board, ~80px for 304.8mm, ~160px for 1219.2mm.
   * Aspect ratio maintained with a slight width stretch for narrow boards.
   */
  const TILE_BASE_H = 200; // visual height for 96" board
  const widthRatio = boardDims.width / boardDims.height;
  // Apply width multiplier: narrow boards get 1.8x stretch, wide boards 1.2x
  const stretchFactor = widthRatio < 0.3 ? 1.8 : widthRatio < 0.5 ? 1.4 : 1.2;
  const tileW = Math.max(60, Math.round(TILE_BASE_H * widthRatio * stretchFactor));
  const tileH = TILE_BASE_H;

  /* Build part layout positions */
  const partLayout = useMemo(() => {
    if (!boardDims.height) return [];
    const bH = boardDims.height;
    const bW = boardDims.width;
    const trim = board.trim_loss;
    const kerf = board.saw_kerf;

    let y = trim;
    return board.parts.map((p, idx) => {
      const pH = p.cut_length || p.Height;
      const pW = p.Width;
      const top = (y / bH) * 100;
      const height = (pH / bH) * 100;
      const width = Math.min((pW / bW) * 100, 100);
      y += pH + kerf;
      return { ...p, top, height, width, idx };
    });
  }, [board, boardDims]);

  /* Waste position */
  const wasteTop = useMemo(() => {
    if (!partLayout.length) return 100;
    const last = partLayout[partLayout.length - 1];
    return last.top + last.height + 0.2;
  }, [partLayout]);

  const utilPct = (board.utilization * 100).toFixed(1);
  const utilNum = parseFloat(utilPct);
  const utilColor = utilNum > 80 ? "#10b981" : utilNum > 60 ? "#f59e0b" : "#ef4444";

  return (
    <div
      className="bg-card rounded-xl shadow-sm border overflow-hidden cursor-pointer hover:shadow-apple hover:-translate-y-0.5 transition-all group"
      style={{ borderColor: color.border + "30", width: `${tileW + 24}px` }}
      onClick={onClick}
    >
      {/* Board title */}
      <div className="px-2 pt-2 pb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-foreground truncate">{board.board_id}</span>
        <span className="text-[10px] font-bold tabular-nums" style={{ color: utilColor }}>{utilPct}%</span>
      </div>

      {/* Board visual */}
      <div className="px-2 pb-1 flex justify-center">
        <div
          className="relative rounded-sm overflow-hidden"
          style={{
            width: `${tileW}px`,
            height: `${tileH}px`,
            backgroundColor: color.light,
            border: `1.5px solid ${color.border}50`,
          }}
        >
          {/* Parts */}
          {partLayout.map((p) => (
            <div
              key={`${p.part_id}-${p.idx}`}
              className="absolute"
              style={{
                top: `${p.top}%`,
                left: `0%`,
                width: `${p.width}%`,
                height: `${p.height}%`,
                backgroundColor: color.bg,
                borderBottom: `1px solid ${color.border}60`,
                borderRight: p.width < 100 ? `1px solid ${color.border}60` : undefined,
              }}
            />
          ))}

          {/* Waste */}
          {wasteTop < 96 && (
            <div
              className="absolute left-0 w-full"
              style={{
                top: `${wasteTop}%`,
                height: `${Math.max(100 - wasteTop, 0)}%`,
                background: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
                borderTop: "1px dashed #ddd",
              }}
            />
          )}
        </div>
      </div>

      {/* Bottom info */}
      <div className="px-2 pb-2 pt-0.5 text-center">
        <span className="text-[9px] text-apple-gray">{board.parts.length}件 · {board.waste.toFixed(0)}mm废</span>
      </div>
    </div>
  );
}

/* ======================================================
   BoardDetailModal — Shows detailed info when clicking a tile
   ====================================================== */
function BoardDetailModal({ board, color, onClose }: {
  board: Board;
  color: typeof SIZE_COLORS[0];
  onClose: () => void;
}) {
  /* Parse board dimensions */
  const boardDims = useMemo(() => {
    const p = board.board_size.split("×").map((s) => parseFloat(s.trim()));
    return { width: p[0] || 0, height: p[1] || 0 };
  }, [board.board_size]);

  /* Visual sizing for modal — larger */
  const MODAL_H = 400;
  const widthRatio = boardDims.width / boardDims.height;
  const stretchFactor = widthRatio < 0.3 ? 2.2 : widthRatio < 0.5 ? 1.6 : 1.3;
  const modalVisualW = Math.max(100, Math.round(MODAL_H * widthRatio * stretchFactor));

  /* Build part layout */
  const partLayout = useMemo(() => {
    if (!boardDims.height) return [];
    const bH = boardDims.height;
    const bW = boardDims.width;
    const trim = board.trim_loss;
    const kerf = board.saw_kerf;

    let y = trim;
    return board.parts.map((p, idx) => {
      const pH = p.cut_length || p.Height;
      const pW = p.Width;
      const top = (y / bH) * 100;
      const height = (pH / bH) * 100;
      const width = Math.min((pW / bW) * 100, 100);
      y += pH + kerf;
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
      <div
        className="relative bg-white w-full max-w-3xl rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.15)] border border-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <style>{`@keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>

        {/* Modal Header */}
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
            <button onClick={onClose} className="p-2 rounded-full hover:bg-black/5 transition-colors">
              <X size={18} className="text-apple-gray" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex flex-col lg:flex-row">
          {/* Left: Board visual */}
          <div className="p-5 flex flex-col items-center justify-start lg:border-r border-border/30 bg-[#fafafa] shrink-0">
            {/* Width label */}
            <div className="flex items-center gap-1 mb-2">
              <div className="h-px bg-apple-gray/20" style={{ width: "16px" }} />
              <span className="text-[10px] text-apple-gray font-mono">{boardDims.width}mm</span>
              <div className="h-px bg-apple-gray/20" style={{ width: "16px" }} />
            </div>

            <div className="flex items-stretch gap-1.5">
              <div
                className="relative rounded-sm overflow-hidden"
                style={{
                  width: `${modalVisualW}px`,
                  height: `${MODAL_H}px`,
                  backgroundColor: color.light,
                  border: `2px solid ${color.border}60`,
                }}
              >
                {partLayout.map((p) => {
                  const partPxH = (p.height / 100) * MODAL_H;
                  const partPxW = (p.width / 100) * modalVisualW;
                  const showText = partPxH > 14 && partPxW > 35;
                  const showDims = partPxH > 26 && partPxW > 50;
                  return (
                    <div
                      key={`${p.part_id}-${p.idx}`}
                      className="absolute flex items-center justify-center overflow-hidden"
                      style={{
                        top: `${p.top}%`,
                        left: `0%`,
                        width: `${p.width}%`,
                        height: `${p.height}%`,
                        backgroundColor: color.bg,
                        borderBottom: `1px solid ${color.border}70`,
                        borderRight: p.width < 100 ? `1px solid ${color.border}70` : undefined,
                      }}
                    >
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
                  <div
                    className="absolute left-0 w-full flex items-center justify-center"
                    style={{
                      top: `${wasteTop}%`,
                      height: `${Math.max(100 - wasteTop, 0)}%`,
                      background: "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.02) 3px, rgba(0,0,0,0.02) 6px)",
                      borderTop: "1px dashed #ddd",
                    }}
                  >
                    {(100 - wasteTop) > 6 && (
                      <span className="text-[8px] text-gray-400 font-bold">废料 {board.waste.toFixed(0)}mm</span>
                    )}
                  </div>
                )}
              </div>

              {/* Height label */}
              <div className="flex flex-col items-center justify-center">
                <div className="text-[10px] text-apple-gray font-mono" style={{ writingMode: "vertical-rl" }}>
                  {boardDims.height}mm
                </div>
              </div>
            </div>

            {/* Utilization bar */}
            <div className="w-full mt-3" style={{ maxWidth: `${modalVisualW + 20}px` }}>
              <div className="w-full bg-black/[0.04] rounded-full h-2 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${utilPct}%`, backgroundColor: utilColor, transition: "width 0.5s" }} />
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-apple-gray">
                <span>锯缝 {board.kerf_total}mm</span>
                <span>废料 {board.waste.toFixed(0)}mm</span>
              </div>
            </div>
          </div>

          {/* Right: Parts table */}
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
