"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import clsx from "clsx";
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
  board_size: string;
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
}

interface CutResult {
  summary: {
    boards_used: number;
    total_parts_placed: number;
    overall_utilization: number;
    total_waste: number;
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

/* ── Color palette for parts ────────────── */
const PART_COLORS = [
  "#0071e3", "#5856d6", "#34c759", "#ff9500", "#ff3b30",
  "#5ac8fa", "#af52de", "#ff2d55", "#64d2ff", "#30d158",
  "#007aff", "#ff6482", "#a2845e", "#8e8e93", "#48dc6a",
];

export default function OrderDetail() {
  const params = useParams();
  const id = params?.id || "N/A";

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBoard, setSelectedBoard] = useState(0);
  const [tab, setTab] = useState<"layout" | "details">("layout");

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
  const currentBoard = boards[selectedBoard];

  /* ── Parse board dimensions from board_size "609.6 × 2438.4" ── */
  const boardDims = useMemo(() => {
    if (!currentBoard) return { width: 0, height: 0 };
    const parts = currentBoard.board_size.split("×").map((s) => parseFloat(s.trim()));
    return { width: parts[0] || 0, height: parts[1] || 0 };
  }, [currentBoard]);

  /* ── Build strip layout positions for parts on the board ── */
  const partLayout = useMemo(() => {
    if (!currentBoard || !boardDims.height) return [];
    const bH = boardDims.height;
    const bW = boardDims.width;
    const trim = currentBoard.trim_loss;
    const kerf = currentBoard.saw_kerf;

    // Parts are packed along height axis (FFD). Start after trim.
    let y = trim;
    return currentBoard.parts.map((p, idx) => {
      const pH = p.cut_length;
      const pW = p.Width;
      const top = (y / bH) * 100;
      const height = (pH / bH) * 100;
      const width = (pW / bW) * 100;
      y += pH + kerf;
      return { ...p, top, height, width, left: 0, idx };
    });
  }, [currentBoard, boardDims]);

  /* ── Waste strip at bottom ── */
  const wasteTop = useMemo(() => {
    if (!partLayout.length) return 100;
    const last = partLayout[partLayout.length - 1];
    return last.top + last.height + 0.5;
  }, [partLayout]);

  if (loading) {
    return (
      <div className="w-full py-4 flex items-center justify-center h-[60vh]">
        <p className="text-apple-gray text-[15px]">加载订单数据...</p>
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
    <div className="w-full py-4 space-y-8 flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between shrink-0 gap-4">
        <div className="flex items-center gap-4">
          <Link href="/orders" className="p-2 bg-black/[0.04] rounded-full hover:bg-black/[0.08] transition-colors shrink-0">
            <ArrowLeft size={20} className="text-foreground" />
          </Link>
          <div>
            <h1 className="text-[32px] font-semibold tracking-tight">Order #{id as string}</h1>
            <p className="text-apple-gray text-[15px] mt-1">
              {order.cabinets_summary || "Smart Cutting Layout"} · {summary?.boards_used || 0} boards · {(summary?.overall_utilization || 0) * 100}% utilization
            </p>
          </div>
        </div>

        <div className="flex gap-3 shrink-0">
          <span className={clsx(
            "px-4 py-2 rounded-full text-[13px] font-medium capitalize",
            order.status === "completed" ? "bg-apple-green/10 text-apple-green" :
            order.status === "processing" ? "bg-apple-blue/10 text-apple-blue" :
            order.status === "failed" ? "bg-red-100 text-red-600" :
            "bg-black/5 text-apple-gray"
          )}>
            {order.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 flex-1 min-h-0">
        {/* ── Left: Board List ── */}
        <div className="lg:col-span-1 space-y-8 overflow-y-auto pr-4">
          <div>
            <h3 className="text-[13px] font-medium uppercase tracking-wider text-apple-gray mb-4">Board Details</h3>
            {currentBoard && (
              <div className="bg-card rounded-2xl p-6 shadow-apple space-y-4">
                <div>
                  <p className="text-[14px] text-apple-gray mb-1">板型</p>
                  <p className="font-medium text-[16px]">{currentBoard.board}</p>
                </div>
                <div className="w-full h-px bg-border my-2" />
                <div>
                  <p className="text-[14px] text-apple-gray mb-1">尺寸</p>
                  <p className="font-medium text-[15px] font-mono">{currentBoard.board_size} mm</p>
                </div>
                <div className="w-full h-px bg-border my-2" />
                <div>
                  <p className="text-[14px] text-apple-gray mb-1">零件</p>
                  <p className="font-medium text-[15px]">{currentBoard.parts.length} 个</p>
                </div>
                <div className="w-full h-px bg-border my-2" />
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-[14px] text-apple-gray">利用率</p>
                    <span className="font-semibold text-[15px] text-apple-blue">
                      {(currentBoard.utilization * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-black/5 rounded-full h-1.5">
                    <div className="bg-apple-blue h-1.5 rounded-full transition-all" style={{ width: `${currentBoard.utilization * 100}%` }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-[13px] font-medium uppercase tracking-wider text-apple-gray mb-4">Boards ({boards.length})</h3>
            <div className="space-y-3">
              {boards.map((board, idx) => (
                <div
                  key={board.board_id}
                  onClick={() => setSelectedBoard(idx)}
                  className={clsx(
                    "p-4 rounded-xl cursor-pointer transition-colors flex justify-between items-center",
                    idx === selectedBoard ? "bg-apple-blue/10" : "bg-card shadow-sm hover:shadow-apple"
                  )}
                >
                  <div>
                    <span className={clsx("text-[15px] font-medium", idx === selectedBoard ? "text-apple-blue" : "text-foreground")}>
                      {board.board_id}
                    </span>
                    <p className="text-[12px] text-apple-gray mt-0.5">{board.parts.length} parts</p>
                  </div>
                  <span className="text-[14px] text-apple-gray">{(board.utilization * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Canvas ── */}
        <div className="lg:col-span-3 bg-white border border-border/60 rounded-3xl flex flex-col overflow-hidden shadow-apple">
          <div className="p-4 border-b border-border/60 flex justify-between items-center bg-white/80 backdrop-blur z-10 w-full">
            <div className="flex bg-black/[0.04] p-1 rounded-xl">
              <button
                onClick={() => setTab("layout")}
                className={clsx("px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors",
                  tab === "layout" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground")}
              >Layout</button>
              <button
                onClick={() => setTab("details")}
                className={clsx("px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors",
                  tab === "details" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground")}
              >Details</button>
            </div>
            {currentBoard && (
              <div className="text-[13px] text-apple-gray font-mono flex gap-4">
                <span>W: {boardDims.width}mm</span>
                <span>H: {boardDims.height}mm</span>
              </div>
            )}
          </div>

          {tab === "layout" ? (
            <div className="flex-1 bg-[#f5f5f7] p-8 flex items-center justify-center overflow-auto">
              {currentBoard ? (
                <div
                  className="bg-white border-2 border-[#d2d2d7] relative shadow-sm rounded-sm"
                  style={{ width: "800px", height: `${800 * (boardDims.height / boardDims.width)}px`, maxHeight: "500px" }}
                >
                  {partLayout.map((p) => (
                    <div
                      key={p.part_id}
                      className="absolute border hover:opacity-80 transition-opacity cursor-pointer flex items-center justify-center"
                      title={`${p.part_id}\n${p.component}\n${p.Width}×${p.Height}mm`}
                      style={{
                        top: `${p.top}%`,
                        left: `0`,
                        width: `${p.width}%`,
                        height: `${p.height}%`,
                        backgroundColor: `${PART_COLORS[p.idx % PART_COLORS.length]}15`,
                        borderColor: PART_COLORS[p.idx % PART_COLORS.length],
                        borderWidth: "2px",
                      }}
                    >
                      <div className="text-center">
                        <span className="text-[11px] font-semibold block" style={{ color: PART_COLORS[p.idx % PART_COLORS.length] }}>
                          {p.part_id}
                        </span>
                        <span className="text-[9px] block text-apple-gray">{p.Width}×{p.Height}</span>
                      </div>
                    </div>
                  ))}
                  {/* Waste area */}
                  {wasteTop < 100 && (
                    <div
                      className="absolute left-0 w-full bg-[#f2f2f7] flex items-center justify-center"
                      style={{ top: `${wasteTop}%`, height: `${100 - wasteTop}%`, borderTop: "1px dashed #d2d2d7" }}
                    >
                      <span className="text-[10px] text-[#86868b] uppercase font-bold tracking-widest">Waste {currentBoard.waste.toFixed(0)}mm</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-apple-gray text-[15px]">选择一块板材查看布局</p>
              )}
            </div>
          ) : (
            /* ── Details Tab: precise data table ── */
            <div className="flex-1 overflow-auto p-6">
              {currentBoard ? (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2.5 px-3 font-semibold text-apple-gray">#</th>
                      <th className="text-left py-2.5 px-3 font-semibold text-apple-gray">Part ID</th>
                      <th className="text-left py-2.5 px-3 font-semibold text-apple-gray">Component</th>
                      <th className="text-left py-2.5 px-3 font-semibold text-apple-gray">Cabinet</th>
                      <th className="text-right py-2.5 px-3 font-semibold text-apple-gray">Height (mm)</th>
                      <th className="text-right py-2.5 px-3 font-semibold text-apple-gray">Width (mm)</th>
                      <th className="text-right py-2.5 px-3 font-semibold text-apple-gray">Cut Length (mm)</th>
                      <th className="text-center py-2.5 px-3 font-semibold text-apple-gray">Rotated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentBoard.parts.map((p, idx) => (
                      <tr key={p.part_id} className="border-b border-border/40 hover:bg-black/[0.02] transition-colors">
                        <td className="py-2.5 px-3 text-apple-gray">{idx + 1}</td>
                        <td className="py-2.5 px-3 font-mono font-medium">{p.part_id}</td>
                        <td className="py-2.5 px-3 text-apple-gray">{p.component}</td>
                        <td className="py-2.5 px-3 text-apple-gray">{p.cab_id}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{p.Height}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{p.Width}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{p.cut_length}</td>
                        <td className="py-2.5 px-3 text-center">{p.rotated ? "🔄" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold">
                      <td colSpan={4} className="py-2.5 px-3">
                        Total: {currentBoard.parts.length} parts · Kerf: {currentBoard.kerf_total}mm · Waste: {currentBoard.waste.toFixed(1)}mm
                      </td>
                      <td colSpan={4} className="py-2.5 px-3 text-right">
                        Utilization: {(currentBoard.utilization * 100).toFixed(1)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <p className="text-apple-gray text-center py-12">选择一块板材查看详情</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
