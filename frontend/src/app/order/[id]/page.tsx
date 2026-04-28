"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Layers, Package, BarChart3, Scissors, AlertTriangle, Table2, LayoutGrid, Box, Printer, CheckCircle2, RefreshCw } from "lucide-react";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { revertCut } from "@/lib/order_actions";
import dynamic from "next/dynamic";
import { useLanguage } from "@/lib/i18n";
import { colorLabel, DEFAULT_BOX_COLOR, useBoxColors } from "@/lib/box_colors";

/* ── Component imports ── */
import type { Part, Board, CutResult, Order, Cabinet, PatternNumbering } from "./components/types";
import { SIZE_COLORS } from "./components/constants";
import { boardFingerprint, nominalStockWidthForBoard } from "./components/utils";
import { StatCard } from "./components/StatCard";
import { BoardTile } from "./components/BoardTile";
import { T0SheetCard } from "./components/T0SheetCard";
import { BoardDetailModal } from "./components/BoardDetailModal";
import { ConfirmCutModal } from "./components/ConfirmCutModal";
import { MachineCutPlan } from "./components/MachineCutPlan";
import { CabinetReconciliation } from "./components/CabinetReconciliation";

const CabinetCanvas = dynamic(() => import("@/components/CabinetViewer"), { ssr: false });

export default function OrderDetail() {
  const { t, locale } = useLanguage();
  const { getColor } = useBoxColors();
  const params = useParams();
  const id = params?.id || "N/A";

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [viewMode, setViewMode] = useState<"layout" | "table" | "cabinets" | "machine">("layout");
  const [machineLang, setMachineLang] = useState<"zh" | "en" | "es">("zh");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [isRequestingT0Start, setIsRequestingT0Start] = useState(false);
  const [selectedCabinetId, setSelectedCabinetId] = useState<string | null>(null);
  const [hoveredPartId, setHoveredPartId] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>(DEFAULT_BOX_COLOR);


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
  const allBoards = cutResult?.boards || [];
  const boards = useMemo(
    () => allBoards.filter((b) => (b.color || DEFAULT_BOX_COLOR) === selectedColor),
    [allBoards, selectedColor]
  );
  const summary = cutResult?.summary;
  const shortages = summary?.inventory_shortage || [];
  const orderDisplayName = order?.filename?.replace(/\.(xlsx|xls)$/i, "") || (id as string);

  const colorOptions = useMemo(() => {
    const stats: Record<string, { colorKey: string; cabinets: number; boards: number; parts: number }> = {};
    const ensure = (colorKey: string) => {
      if (!stats[colorKey]) stats[colorKey] = { colorKey, cabinets: 0, boards: 0, parts: 0 };
      return stats[colorKey];
    };

    for (const b of allBoards) {
      const color = b.color || DEFAULT_BOX_COLOR;
      const stat = ensure(color);
      stat.boards += 1;
      stat.parts += b.parts?.length || 0;
    }
    for (const color of Object.keys(summary?.by_color || {})) {
      ensure(color);
    }
    for (const entry of Object.values(cutResult?.cabinet_breakdown || {})) {
      const color = entry.color || DEFAULT_BOX_COLOR;
      const stat = ensure(color);
      stat.cabinets += 1;
      if (stat.parts === 0) stat.parts += entry.parts?.length || 0;
    }
    for (const shortage of shortages) {
      const color = shortage.color || DEFAULT_BOX_COLOR;
      ensure(color);
    }
    return Object.values(stats).sort((a, b) => a.colorKey.localeCompare(b.colorKey));
  }, [allBoards, cutResult?.cabinet_breakdown, shortages, summary?.by_color]);

  useEffect(() => {
    if (colorOptions.length > 0 && !colorOptions.some((option) => option.colorKey === selectedColor)) {
      setSelectedColor(colorOptions[0].colorKey);
    }
  }, [colorOptions, selectedColor]);

  const selectedColorSummary = summary?.by_color?.[selectedColor];
  const selectedBoardsUsed = selectedColorSummary?.boards_used ?? boards.length;
  const selectedPartsPlaced = selectedColorSummary?.total_parts_placed ?? selectedColorSummary?.parts_placed ?? boards.reduce((sum, b) => sum + b.parts.length, 0);
  const selectedUtilization = selectedColorSummary?.overall_utilization ?? (
    boards.length > 0
      ? boards.reduce((sum, b) => sum + b.utilization, 0) / boards.length
      : 0
  );
  const selectedCutResult = useMemo<CutResult | null>(() => {
    if (!cutResult) return null;
    const cabinet_breakdown = cutResult.cabinet_breakdown
      ? Object.fromEntries(
          Object.entries(cutResult.cabinet_breakdown).filter(([, entry]) => (entry.color || DEFAULT_BOX_COLOR) === selectedColor)
        )
      : undefined;
    return {
      ...cutResult,
      boards,
      cabinet_breakdown,
      recovered_inventory: cutResult.recovered_inventory?.filter((r) => (r.color || DEFAULT_BOX_COLOR) === selectedColor),
      t0_plan: cutResult.t0_plan ? {
        ...cutResult.t0_plan,
        t0_sheets: cutResult.t0_plan.t0_sheets?.filter((s) => ((s as { color?: string }).color || DEFAULT_BOX_COLOR) === selectedColor),
      } : undefined,
    };
  }, [cutResult, boards, selectedColor]);
  const selectedColorStats = colorOptions.find((option) => option.colorKey === selectedColor);
  const selectedExpectedParts = selectedColorStats?.parts || 0;
  const selectedHasLegacyMissingCutData = boards.length === 0 && selectedExpectedParts > 0;

  useEffect(() => {
    document.title = `${t("orderDetail.title")} #${orderDisplayName}`;
  }, [orderDisplayName, t]);

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
      const fp = `${b.color || DEFAULT_BOX_COLOR}|${boardFingerprint(b)}`;
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

  /* ── Shared pattern numbering for consistent labels across Layout & Machine Cut Plan ── */
  /* Computed once from boards using the same grouping logic as MachineCutPlan */
  const patternNumbering = useMemo(() => {
    // Group boards by strip_width + board_type (same as Machine Cut Plan engineering groups)
    const groupMap: Record<string, Board[]> = {};
    for (const b of boards) {
      const w = b.strip_width || 0;
      const key = `${b.color || DEFAULT_BOX_COLOR}|||${w}|||${b.board}|||${b.board_size}`;
      if (!groupMap[key]) groupMap[key] = [];
      groupMap[key].push(b);
    }

    // Sort: T1 first, then non-rip, then rip boards last (MUST match MachineCutPlan sort)
    const sortedEntries = Object.entries(groupMap).sort(([keyA, boardsA], [keyB, boardsB]) => {
      const typeA = boardsA[0]?.board || "";
      const typeB = boardsB[0]?.board || "";
      const isT1A = typeA.toUpperCase().includes("T1");
      const isT1B = typeB.toUpperCase().includes("T1");
      if (isT1A !== isT1B) return isT1A ? -1 : 1;

      const wA = parseFloat(keyA.split("|||")[1]);
      const wB = parseFloat(keyB.split("|||")[1]);
      const nwA = nominalStockWidthForBoard(boardsA[0]);
      const nwB = nominalStockWidthForBoard(boardsB[0]);
      const needsRipA = nwA != null && (nwA - wA > 0.5);
      const needsRipB = nwB != null && (nwB - wB > 0.5);
      if (needsRipA !== needsRipB) return needsRipA ? 1 : -1;

      if (Math.abs(wB - wA) > 0.01) return wB - wA;
      return keyA.localeCompare(keyB);
    });

    // Build flat pattern numbering by sub-grouping each engineering group by fingerprint
    const byIndex: Record<number, number> = {};
    const byFingerprint: Record<string, number> = {};
    let nextNo = 1;

    for (const [, grpBoards] of sortedEntries) {
      // Sub-group by fingerprint (same logic as MachineCutPlan patterns)
      const fpMap: Record<string, Board[]> = {};
      for (const b of grpBoards) {
        const fp = boardFingerprint(b);
        if (!fpMap[fp]) fpMap[fp] = [];
        fpMap[fp].push(b);
      }
      for (const [fp] of Object.entries(fpMap)) {
        byFingerprint[fp] = nextNo;
        // Map all boards with this fingerprint to this pattern number
        for (let i = 0; i < boards.length; i++) {
          if (`${boards[i].color || DEFAULT_BOX_COLOR}|${boardFingerprint(boards[i])}` === fp) {
            byIndex[i] = nextNo;
          }
        }
        nextNo++;
      }
    }

    return { byIndex, byFingerprint, total: nextNo - 1 };
  }, [boards]);

  /* ── Group parts into cabinets ── */
  const cabinets = useMemo(() => {
    const cabMap: Record<string, Cabinet> = {};

    if (cutResult?.cabinet_breakdown && Object.keys(cutResult.cabinet_breakdown).length > 0) {
      for (const [cabId, cabData] of Object.entries(cutResult.cabinet_breakdown)) {
        if (!cabId || cabId === "?" || cabId === "Unknown") continue;
        const cabColor = cabData.color || DEFAULT_BOX_COLOR;
        if (cabColor !== selectedColor) continue;
        cabMap[cabId] = {
          cab_id: cabId,
          cab_type: cabData.cab_type || "Unknown",
          color: cabColor,
          parts: cabData.parts.map((p): Part => ({
            ...p,
            cut_length: p.Height,
            cab_id: cabId,
            cab_type: cabData.cab_type || "Unknown",
            color: cabColor,
          })),
          dimensions: { width: 0, height: 0, depth: 0 }
        };
      }
    } else {
      for (const b of boards) {
        for (const p of b.parts) {
          if (!p.cab_id || p.cab_id === "?" || p.cab_id === "Unknown") continue;
          if (!cabMap[p.cab_id]) {
            cabMap[p.cab_id] = {
              cab_id: p.cab_id,
              cab_type: p.cab_type || "Unknown",
              color: p.color || DEFAULT_BOX_COLOR,
              parts: [],
              dimensions: { width: 0, height: 0, depth: 0 }
            };
          }
          cabMap[p.cab_id].parts.push(p);
        }
      }
    }

    // Heuristically calculate dimensions
    return Object.values(cabMap).map(cab => {
      let maxH = 0, maxW = 0, maxD = 0;
      cab.parts.forEach(p => {
        const h = p.rotated ? p.Width : p.Height;
        const w = p.rotated ? p.Height : p.Width;
        const c = (p.component || "").toLowerCase();
        if (c.includes("side") || c.includes("侧板")) {
          // 侧板: Height=柜高, Width=柜深
          maxH = Math.max(maxH, h);
          maxD = Math.max(maxD, w);
        } else if (c.includes("top") || c.includes("bottom") || c.includes("顶板") || c.includes("底板")) {
          // 顶板/底板: Height=柜宽-36, Width=柜深-18 → 补回扣减值
          maxW = Math.max(maxW, h + 36);
          maxD = Math.max(maxD, w + 18);
        } else if (c.includes("back") || c.includes("背板")) {
          // 背板: 智能对应. 判断 h 和 w 哪个更接近已知的柜高 (maxH)
          if (maxH > 0) {
            if (Math.abs(h - maxH) < Math.abs(w - maxH)) {
              maxH = Math.max(maxH, h);
              maxW = Math.max(maxW, w + 30);
            } else {
              maxH = Math.max(maxH, w);
              maxW = Math.max(maxW, h + 30);
            }
          } else {
            // 如果还不知道柜高，默认长边为高
            if (h > w) {
              maxH = Math.max(maxH, h);
              maxW = Math.max(maxW, w + 30);
            } else {
              maxH = Math.max(maxH, w);
              maxW = Math.max(maxW, h + 30);
            }
          }
        }
      });
      // Fallbacks if heuristics fail
      if (maxH === 0) maxH = 720;
      if (maxW === 0) maxW = 600;
      if (maxD === 0) maxD = 560;
      
      cab.dimensions = { width: maxW, height: maxH, depth: maxD };
      return cab;
    }).sort((a, b) => a.cab_id.localeCompare(b.cab_id));
  }, [boards, cutResult?.cabinet_breakdown, selectedColor]);

  // Set default selected cabinet when switching to cabinets view
  useEffect(() => {
    if (viewMode === "cabinets" && cabinets.length > 0 && !selectedCabinetId) {
      setSelectedCabinetId(cabinets[0].cab_id);
    }
  }, [viewMode, cabinets, selectedCabinetId]);

  useEffect(() => {
    if (selectedCabinetId && !cabinets.some((cab) => cab.cab_id === selectedCabinetId)) {
      setSelectedCabinetId(cabinets[0]?.cab_id || null);
    }
  }, [cabinets, selectedCabinetId]);


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

  const handleRequestT0Start = async () => {
    if (!order) return;
    if (!confirm(t("orderDetail.t0StartConfirm"))) return;
    setIsRequestingT0Start(true);
    try {
      const { error } = await supabase
        .from("orders")
        .update({
          status: "pending",
          cut_mode: "t0_start",
          cut_result_json: null,
          utilization: null,
          boards_used: null,
          total_parts: null,
          completed_at: null,
          cut_confirmed_at: null,
          t0_start_requested_at: new Date().toISOString(),
          extra_boards_used: [],
        })
        .eq("id", order.id);
      if (error) throw error;
      setOrder({
        ...order,
        status: "pending",
        cut_mode: "t0_start",
        cut_result_json: null,
      });
    } catch (e) {
      alert(t("orderDetail.t0StartFailed") + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsRequestingT0Start(false);
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
  const isT0Start = order.cut_mode === "t0_start" || cutResult.cut_mode === "t0_start" || summary?.cut_mode === "t0_start";

  return (
    <div className="w-full py-4 space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/orders" className="p-2.5 bg-black/[0.04] rounded-full hover:bg-black/[0.08] transition-colors shrink-0">
            <ArrowLeft size={20} className="text-foreground" />
          </Link>
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">{t("orderDetail.title")} #{orderDisplayName}</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
            <>
              {!isT0Start && (
                <button
                  onClick={handleRequestT0Start}
                  disabled={isRequestingT0Start}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={14} className={isRequestingT0Start ? "animate-spin" : ""} /> {t("orderDetail.t0Start")}
                </button>
              )}
              {isT0Start && (
                <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-medium bg-orange-50 text-orange-700">
                  <Scissors size={14} /> T0 Start
                </span>
              )}
              <button
                onClick={() => setShowConfirmModal(true)}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-[13px] font-medium bg-apple-blue text-white hover:bg-apple-blue/90 shadow-sm transition-colors"
              >
                <CheckCircle2 size={14} /> {t("orderDetail.confirmCut")}
              </button>
            </>
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
                <span key={`${s.board_type}-${s.color || DEFAULT_BOX_COLOR}`} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-100 text-amber-800 text-[12px] font-medium">
                  {s.board_type} [{colorLabel(getColor(s.color), locale)}]: {t("orderDetail.need")}{s.needed} / {t("orderDetail.stock")}{s.stock} / {t("orderDetail.missing")}{s.shortage}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {colorOptions.length > 0 && (
        <div className="bg-card rounded-xl shadow-apple border border-border/40 p-4 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="text-[12px] font-semibold uppercase tracking-wide text-apple-gray mb-2">{t("orderDetail.boxColor")}</div>
              <div className="flex flex-wrap items-center gap-2">
                {colorOptions.map((option) => {
                  const colorKey = option.colorKey;
                  const boxColor = getColor(colorKey);
                  return (
                    <button
                      key={colorKey}
                      onClick={() => {
                        setSelectedColor(colorKey);
                        setSelectedBoard(null);
                      }}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${selectedColor === colorKey ? "bg-foreground text-white" : "bg-black/[0.04] text-foreground hover:bg-black/[0.07]"}`}
                    >
                      <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: boxColor.hex_color }} />
                      {colorLabel(boxColor, locale)} ({option.cabinets || option.boards})
                      {option.boards === 0 && option.parts > 0 && (
                        <span className="ml-1 text-[10px] opacity-70">needs reprocess</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex bg-black/[0.04] p-1 rounded-xl overflow-x-auto">
              <button onClick={() => setViewMode("layout")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${viewMode === "layout" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"}`}>
                <LayoutGrid size={14} /> {t("orderDetail.layout")}
              </button>
              <button onClick={() => setViewMode("table")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${viewMode === "table" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"}`}>
                <Table2 size={14} /> {t("orderDetail.dataTable")}
              </button>
              <button onClick={() => setViewMode("cabinets")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${viewMode === "cabinets" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"}`}>
                <Box size={14} /> {t("orderDetail.cabinetView")}
              </button>
              <button onClick={() => setViewMode("machine")} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${viewMode === "machine" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground"}`}>
                <Scissors size={14} /> {t("machine.tabLabel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedHasLegacyMissingCutData && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-semibold text-amber-800">
              {colorLabel(getColor(selectedColor), locale)} cut layout was not generated for this saved result.
            </p>
            <p className="text-[13px] text-amber-700 mt-1">
              This order was processed before the no-inventory color fix, so it has cabinet data for this color but no board layout. Reprocess the order to generate this color&apos;s Cutting Layout, Data Table, and Machine Cut Plan.
            </p>
          </div>
        </div>
      )}

      {/* ── Table View Data / Summary ── */}
      {viewMode === "table" && (
        <>
          {/* ── Summary Stats ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard icon={<Layers size={18} />} label={t("orderDetail.boardsCount")} value={String(selectedBoardsUsed)} color="#3b82f6" />
            <StatCard icon={<Package size={18} />} label={t("orderDetail.partsCount")} value={String(selectedPartsPlaced)} color="#8b5cf6" />
            <StatCard icon={<BarChart3 size={18} />} label={t("orderDetail.overallUtil")} value={`${(selectedUtilization * 100).toFixed(1)}%`} color="#10b981" />
          </div>

          {summary?.by_color?.[selectedColor] && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(summary.by_color).filter(([colorKey]) => colorKey === selectedColor).map(([colorKey, data]) => {
                const boxColor = getColor(colorKey);
                return (
                  <div key={colorKey} className="bg-card rounded-xl border border-border/40 p-4 shadow-apple">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: boxColor.hex_color }} />
                      <span className="text-[13px] font-semibold">{colorLabel(boxColor, locale)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[12px] text-apple-gray">
                      <span>{data.boards_used} {t("orderDetail.boardsCount")}</span>
                      <span>{data.total_parts_placed ?? data.parts_placed ?? 0} {t("orderDetail.thParts")}</span>
                      <span>{((data.overall_utilization || 0) * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}


        </>
      )}

      {/* ── Layout View: Split layout for T1 and T0 ── */}
      {viewMode === "layout" && !selectedHasLegacyMissingCutData && (
        <div className="mb-3">
          <CabinetReconciliation cutResult={selectedCutResult} />
        </div>
      )}
      {viewMode === "layout" && selectedHasLegacyMissingCutData && (
        <div className="bg-card rounded-xl shadow-apple border border-border/30 p-12 text-center text-apple-gray text-[15px]">
          Reprocess this order to generate {colorLabel(getColor(selectedColor), locale)} cutting layout data.
        </div>
      )}
      {viewMode === "layout" && !selectedHasLegacyMissingCutData && (() => {
        const typeGroups = boards.reduce((acc, b, idx) => {
          const type = b.board || b.board_type || "Unknown";
          const color = b.color || DEFAULT_BOX_COLOR;
          const key = `${color}|||${type}`;
          if (!acc[key]) acc[key] = [];
          acc[key].push(idx);
          return acc;
        }, {} as Record<string, number[]>);

        const getTypeFromKey = (key: string) => key.split("|||")[1] || key;
        const getColorFromKey = (key: string) => key.split("|||")[0] || DEFAULT_BOX_COLOR;
        const t1Entries = Object.entries(typeGroups).filter(([key]) => getTypeFromKey(key).toUpperCase().includes("T1")).sort(([a], [b]) => a.localeCompare(b));
        const t0Entries = Object.entries(typeGroups).filter(([key]) => !getTypeFromKey(key).toUpperCase().includes("T1")).sort(([a], [b]) => a.localeCompare(b));

        /* Group T0 boards by t0_sheet_id for visual grouping */
        const t0SheetGroups: Record<string, { board: Board; index: number }[]> = {};
        const t0Ungrouped: { board: Board; index: number }[] = [];
        for (const [, indices] of t0Entries) {
          for (const idx of indices) {
            const b = boards[idx];
            if (b.t0_sheet_id) {
              if (!t0SheetGroups[b.t0_sheet_id]) t0SheetGroups[b.t0_sheet_id] = [];
              t0SheetGroups[b.t0_sheet_id].push({ board: b, index: idx });
            } else {
              t0Ungrouped.push({ board: b, index: idx });
            }
          }
        }
        // Sort strips within each sheet by position
        for (const strips of Object.values(t0SheetGroups)) {
          strips.sort((a, b) => (a.board.t0_sheet_index ?? 0) - (b.board.t0_sheet_index ?? 0));
        }

        const MAX_BOARDS_PER_COL = 4;
        const renderColumns = ([typeKey, indices]: [string, number[]]) => {
          const type = getTypeFromKey(typeKey);
          const colorKey = getColorFromKey(typeKey);
          const boxColor = getColor(colorKey);
          const leaders = indices.filter((idx) => stackGroups.lookup[idx]?.isLeader);
          if (leaders.length === 0) return null;

          // Sort leaders by pattern number for consistent sequential display
          leaders.sort((a, b) => {
            const aPNo = patternNumbering.byIndex[a] ?? 999;
            const bPNo = patternNumbering.byIndex[b] ?? 999;
            return aPNo - bPNo;
          });

          const cols = [];
          for (let i = 0; i < leaders.length; i += MAX_BOARDS_PER_COL) {
            const chunk = leaders.slice(i, i + MAX_BOARDS_PER_COL);
            const isFirstCol = i === 0;

            cols.push(
              <div key={`${typeKey}-${i}`} className="flex flex-col gap-y-5 shrink-0">
                <div className="text-left px-2" style={{ visibility: isFirstCol ? 'visible' : 'hidden' }}>
                  <h3 className="text-[16px] font-bold text-foreground inline-flex items-center gap-2">
                    {isFirstCol ? (
                      <>
                        <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: boxColor.hex_color }} />
                        {type}
                      </>
                    ) : "\u00A0"}
                  </h3>
                  <p className="text-[13px] text-apple-gray font-medium">
                    {isFirstCol ? `${colorLabel(boxColor, locale)} · ${indices.length} ${t("orderDetail.boardsCount")}` : "\u00A0"}
                  </p>
                </div>
                <div className="flex flex-col gap-y-6 pb-0">
                  {chunk.map((idx) => {
                    const board = boards[idx];
                    const stackInfo = stackGroups.lookup[idx];
                    return (
                      <div key={`${board.board_id}-${idx}`} className="space-y-1">
                        <BoardTile
                          board={board}
                          index={idx}
                          color={sizeColorMap[board.board_size]}
                          stackInfo={stackInfo}
                          onClick={() => setSelectedBoard(board)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }
          return cols;
        };

        /* Count total T0 boards (sheets, not strips) */
        const t0SheetCount = Object.keys(t0SheetGroups).length + t0Ungrouped.length;

        return (
          <div className="flex flex-col w-full pt-8 pb-12 min-h-[60vh]">
            {/* Top Area (T1) */}
            <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 content-start gap-x-10 gap-y-10 px-6 pb-12 border-b border-border/40">
              {t1Entries.length > 0 ? t1Entries.flatMap(renderColumns) : (
                <div className="w-full h-32 flex items-center justify-center text-apple-gray/50 text-[14px] col-span-full">
                  T1 {t("orderDetail.notFound")}
                </div>
              )}
            </div>

            {/* Bottom Area (T0) */}
            <div className="w-full px-6 pt-10">
              {t0SheetCount > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-start">
                  {/* T0 Sheet Groups */}
                  {Object.entries(t0SheetGroups).map(([sheetId, strips]) => {
                    const sheetPlan = selectedCutResult?.t0_plan?.t0_sheets?.find((s) => s.sheet_id === sheetId);
                    const recoveredStrips = sheetPlan?.recovered_strips || [];
                    return (
                      <T0SheetCard
                        key={sheetId}
                        sheetId={sheetId}
                        strips={strips}
                        sizeColorMap={sizeColorMap}
                        onBoardClick={(b) => setSelectedBoard(b)}
                        recoveredStrips={recoveredStrips}
                        patternNumbering={patternNumbering}
                      />
                    );
                  })}
                  {/* Ungrouped T0 boards (no t0_sheet_id — legacy data) */}
                  {t0Ungrouped.length > 0 && (
                    <div className="flex flex-col gap-y-3">
                      {t0Ungrouped.map(({ board, index: idx }) => {
                        const stackInfo = stackGroups.lookup[idx];
                        if (stackInfo && !stackInfo.isLeader) return null;
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
                  )}
                </div>
              ) : (
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
                  <th className="text-left py-3 px-4 font-semibold text-apple-gray">{t("orderDetail.boxColor")}</th>
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
                {boards.map((board, idx) => ({ board, idx }))
                  .filter(({ idx }) => {
                    const si = stackGroups.lookup[idx];
                    return !si || si.isLeader;
                  })
                  .map(({ board, idx }, mappedIdx) => {
                  const c = sizeColorMap[board.board_size];
                  const utilPct = (board.utilization * 100).toFixed(1);
                  const utilNum = parseFloat(utilPct);
                  const si = stackGroups.lookup[idx];
                  return (
                    <tr key={`${board.board_id}-${idx}`} className="border-b border-border/20 hover:bg-black/[0.01]">
                      <td className="py-2.5 px-4 text-apple-gray">{mappedIdx + 1}</td>
                      <td className="py-2.5 px-4">
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                          <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: getColor(board.color).hex_color }} />
                          <span className="text-[12px] text-apple-gray">{colorLabel(getColor(board.color), locale)}</span>
                        </span>
                      </td>
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
                          {(() => {
                            const partGroups: Record<string, { label: string; rotated: boolean; count: number }> = {};
                            for (const p of board.parts) {
                              const label = p.component || p.part_id;
                              const key = `${label}_${p.rotated ? 'rot' : 'norm'}`;
                              if (!partGroups[key]) {
                                partGroups[key] = { label, rotated: !!p.rotated, count: 0 };
                              }
                              partGroups[key].count++;
                            }
                            return Object.values(partGroups).map((g, gi) => (
                              <span key={gi} className="text-[10px] px-1.5 py-0.5 rounded bg-black/[0.03] text-apple-gray whitespace-nowrap">
                                {g.label}
                                {g.rotated && <span className="ml-0.5" title="Rotated">🔄</span>}
                                {g.count > 1 && <span className="ml-1 text-black/40 font-bold">×{g.count}</span>}
                              </span>
                            ));
                          })()}
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
                    <div className="font-medium text-[14px] leading-tight flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: getColor(cab.color).hex_color }} />
                      {cab.cab_id}
                    </div>
                    <div className={`text-[11px] mt-0.5 ${selectedCabinetId === cab.cab_id ? "text-blue-100" : "text-apple-gray"}`}>
                      {cab.cab_type} · {cab.parts.length}{t("orderDetail.cabParts")} · {colorLabel(getColor(cab.color), locale)}
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
                  boxColorHex={getColor(cabinets.find(c => c.cab_id === selectedCabinetId)?.color).hex_color}
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
                      <span className="inline-flex items-center gap-1"><span className="text-black/40 font-sans">H</span>{p.rotated ? p.Width : p.Height}</span>
                      <span className="text-black/20 font-sans">×</span>
                      <span className="inline-flex items-center gap-1"><span className="text-black/40 font-sans">W</span>{p.rotated ? p.Height : p.Width}</span>
                      {p.rotated && <span className="ml-2 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-200 inline-flex items-center gap-1">🔄</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── Machine Cut Plan View ── */}
      {viewMode === "machine" && selectedHasLegacyMissingCutData && (
        <div className="bg-card rounded-xl shadow-apple border border-border/30 p-12 text-center text-apple-gray text-[15px]">
          Reprocess this order to generate {colorLabel(getColor(selectedColor), locale)} machine cut plan data.
        </div>
      )}
      {viewMode === "machine" && !selectedHasLegacyMissingCutData && (
        <>
          <div className="mb-3">
            <CabinetReconciliation cutResult={selectedCutResult} />
          </div>
          <MachineCutPlan boards={boards} orderLabel={orderDisplayName} machineLang={machineLang} setMachineLang={setMachineLang} patternNumbering={patternNumbering} cutResult={selectedCutResult} />
        </>
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
          onConfirmed={handleCutConfirmed}
          onClose={() => setShowConfirmModal(false)}
        />
      )}
    </div>
  );
}
