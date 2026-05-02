"use client";
import { useState, useEffect, useCallback } from "react";
import { UploadCloud, PieChart, Trash2, AlertOctagon, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { revertCut } from "@/lib/order_actions";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n";

interface Order {
  id: string;
  job_id: string;
  filename: string | null;
  status: string;
  cabinets_summary: string | null;
  utilization: number | null;
  boards_used: number | null;
  total_parts: number | null;
  created_at: string;
  cut_result_json: Record<string, unknown> | null;
}

export default function Orders() {
  const { t } = useLanguage();
  const [isDragging, setIsDragging] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<Order[] | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [isDeleteMode, setIsDeleteMode] = useState(false);

  const openDeleteModal = useCallback((ordersList: Order[]) => {
    setDeleteError(null);
    setDeleteTargets(ordersList);
  }, []);

  const closeDeleteModal = useCallback(() => {
    setDeleteTargets(null);
    setDeleteError(null);
    setDeleting(false);
  }, []);

  const confirmDelete = async () => {
    if (!deleteTargets || deleteTargets.length === 0) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const jobIds = deleteTargets.map(o => o.job_id);
      const ids = deleteTargets.map(o => o.id);

      // Revert any completed cuts first to restore inventory and clear stats
      for (const order of deleteTargets) {
        if (order.status === "cut_done") {
          await revertCut(order);
        }
      }

      // Delete any cutting_stats for these orders (covers edge cases beyond revertCut)
      await supabase.from("cutting_stats").delete().in("job_id", jobIds);
      // Delete related bom_history first (foreign key on job_id)
      await supabase.from("bom_history").delete().in("job_id", jobIds);
      // Then delete the orders
      const { error } = await supabase.from("orders").delete().in("id", ids);
      if (error) {
        setDeleteError(error.message);
        setDeleting(false);
        return;
      }
      setOrders(prev => prev.filter(o => !ids.includes(o.id)));
      setSelectedOrders(new Set());
      setIsDeleteMode(false);
      closeDeleteModal();
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : "Unknown error");
      setDeleting(false);
    }
  };

  const fetchOrders = useCallback(async () => {
    const { data } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setOrders(data as Order[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await fetchOrders();
    })();

    // Subscribe to realtime updates for orders table (INSERT/DELETE/status changes)
    const channel = supabase.channel("orders-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders]);

  // Poll every 5s when there are pending/processing orders so that
  // status changes (pending → completed) appear without a manual refresh.
  // This is a fallback in case Supabase Realtime replication is not enabled.
  useEffect(() => {
    const hasActive = orders.some(o => o.status === "pending" || o.status === "processing");
    if (!hasActive) return;

    const timer = setInterval(() => {
      fetchOrders();
    }, 5000);

    return () => clearInterval(timer);
  }, [orders, fetchOrders]);

  // Calculate overall utilization from completed orders
  const completedOrders = orders.filter(o => (o.status === "completed" || o.status === "cut_done") && o.utilization);
  const overallUtil = completedOrders.length > 0
    ? (completedOrders.reduce((sum, o) => sum + (o.utilization || 0), 0) / completedOrders.length * 100).toFixed(1)
    : "—";

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) await uploadFile(file);
  };

  const handleFileSelect = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) await uploadFile(file);
    };
    input.click();
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    const now = new Date();
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const jobId = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}_${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}${String(now.getSeconds()).padStart(2,"0")}_${randomSuffix}`;
    const uniqueSuffix = Date.now();
    // Sanitize filename for storage path: keep only ASCII-safe chars to avoid
    // encoding issues with Chinese / special-character filenames.
    const ext = file.name.replace(/^.*\./, ".") || ".xlsx";
    const safeName = file.name
      .replace(/\.[^.]+$/, "")            // strip extension
      .replace(/[^\w\s-]/g, "")           // drop non-ASCII / special chars
      .replace(/\s+/g, "_")              // spaces → underscores
      .substring(0, 60) || "order";       // length cap + fallback
    const storagePath = `orders/${jobId}_${uniqueSuffix}_${safeName}${ext}`;

    // Upload to Supabase Storage (upsert to avoid conflicts)
    const { error: storageError } = await supabase.storage
      .from("order-files")
      .upload(storagePath, file, { upsert: true });

    if (storageError) {
      console.error("Storage upload failed:", storageError.message);
      // Show error to user — the file won't be available for backend processing
      const friendlyMsg = storageError.message.includes("Bucket not found")
        ? `文件上传失败: Supabase Storage 中 "order-files" bucket 不存在。请在 Supabase Dashboard → Storage 中创建名为 "order-files" 的 bucket。`
        : `文件上传失败: ${storageError.message}`;
      setUploadError(friendlyMsg);
      setUploading(false);
      return;
    }

    const fileUrl = supabase.storage.from("order-files").getPublicUrl(storagePath).data.publicUrl;

    // Insert order row
    const { error: insertError } = await supabase
      .from("orders")
      .insert({
        job_id: jobId,
        filename: file.name,
        status: "pending",
        file_url: fileUrl,
        cut_mode: "t0_start",
      });

    if (insertError) {
      setUploadError(`订单创建失败: ${insertError.message}`);
    } else {
      await fetchOrders();
    }
    setUploading(false);
  };

  const toggleOrderSelection = (id: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="w-full space-y-10 py-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight">{t("orders.title")}</h1>
          <p className="text-apple-gray text-[15px] mt-1">{t("orders.subtitle")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <div className="bg-card rounded-2xl p-8 shadow-apple h-full flex flex-col">
            <h2 className="text-xl font-semibold mb-6">{t("orders.upload")}</h2>

            <div
              className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-8 transition-colors duration-200 ${
                isDragging
                  ? "border-apple-blue bg-apple-blue/5"
                  : "border-border bg-black/[0.02]"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
            >
              <UploadCloud size={40} className={isDragging ? "text-apple-blue mb-4" : "text-apple-gray mb-4"} />
              <h3 className="text-[15px] font-semibold mb-6">
                {uploading ? t("orders.uploading") : t("orders.upload")}
              </h3>
              {uploadError && (
                <div className="mb-4 p-3 rounded-xl bg-apple-red/10 text-apple-red text-[13px] text-center font-medium flex items-start gap-2 max-w-full">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}
              <button
                onClick={handleFileSelect}
                disabled={uploading}
                className="bg-apple-blue text-white px-6 py-2 rounded-full text-[14px] font-medium hover:bg-apple-blue/90 shadow-sm transition-colors disabled:opacity-50 shrink-0 whitespace-nowrap"
              >
                Browse Files
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-card rounded-2xl shadow-apple overflow-hidden">
            <div className="px-8 py-6 border-b border-border flex justify-between items-center">
              <h2 className="text-xl font-semibold">{t("orders.title")}</h2>
              {!isDeleteMode ? (
                <button
                  onClick={() => setIsDeleteMode(true)}
                  className="p-2 rounded-full text-apple-gray hover:text-apple-red hover:bg-apple-red/10 transition-colors"
                  title="Batch Delete"
                >
                  <Trash2 size={18} />
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setIsDeleteMode(false); setSelectedOrders(new Set()); }}
                    className="text-[13px] font-medium text-apple-gray hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-black/5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => openDeleteModal(orders.filter(o => selectedOrders.has(o.id)))}
                    disabled={selectedOrders.size === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-apple-red/10 text-apple-red rounded-lg text-[13px] font-medium hover:bg-apple-red/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} /> {t("orders.deleteSelected")} ({selectedOrders.size})
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center h-32 text-apple-gray text-[15px]">Loading...</div>
              ) : orders.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-apple-gray text-[15px]">No orders yet. Upload your first order above.</div>
              ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-black/[0.02]">
                    {isDeleteMode && (
                      <th className="py-3 px-6 w-12 text-center align-middle">
                        <input 
                          type="checkbox" 
                          checked={orders.length > 0 && selectedOrders.size === orders.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedOrders(new Set(orders.map(o => o.id)));
                            } else {
                              setSelectedOrders(new Set());
                            }
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-apple-blue focus:ring-apple-blue cursor-pointer"
                        />
                      </th>
                    )}
                    <th className="py-3 px-4 text-[13px] font-medium text-apple-gray uppercase tracking-wide text-center">{t("orders.table.file")}</th>
                    <th className="py-3 px-4 text-[13px] font-medium text-apple-gray uppercase tracking-wide text-center">Cabinets</th>
                    <th className="py-3 px-4 text-[13px] font-medium text-apple-gray uppercase tracking-wide text-center">Boards</th>
                    <th className="py-3 px-4 text-[13px] font-medium text-apple-gray uppercase tracking-wide text-center">{t("orders.table.status")}</th>
                    <th className="py-3 px-4 text-[13px] font-medium text-apple-gray uppercase tracking-wide text-center">{t("orders.table.yield")}</th>
                    <th className="py-3 px-4 text-[13px] font-medium text-apple-gray uppercase tracking-wide text-center">{t("orders.table.date")}</th>
                    <th className="py-3 px-4 text-[13px] font-medium text-apple-gray uppercase tracking-wide text-center">{t("orders.table.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map(order => (
                    <OrderRow 
                      key={order.id} 
                      order={order} 
                      isSelected={selectedOrders.has(order.id)}
                      isDeleteMode={isDeleteMode}
                      onToggle={toggleOrderSelection}
                    />
                  ))}
                </tbody>
              </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTargets && deleteTargets.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); closeDeleteModal(); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          {/* Modal Card */}
          <div
            className="relative bg-white w-full max-w-sm rounded-[24px] shadow-[0_8px_40px_rgba(0,0,0,0.16)] border border-black/5 p-8"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}
          >
            <style>{`
              @keyframes modalIn {
                from { opacity: 0; transform: scale(0.92) translateY(8px); }
                to   { opacity: 1; transform: scale(1) translateY(0); }
              }
            `}</style>
            <div className="w-14 h-14 rounded-full bg-apple-red/10 text-apple-red flex items-center justify-center mb-5 mx-auto">
              <AlertOctagon size={28} />
            </div>
            <h3 className="text-[20px] font-semibold text-center mb-2 tracking-tight">Delete Order(s)?</h3>
            <p className="text-[14px] text-apple-gray text-center leading-relaxed">
              This will permanently remove <span className="font-semibold text-foreground">{deleteTargets.length === 1 ? deleteTargets[0].job_id : `${deleteTargets.length} selected orders`}</span> and all related production history.
            </p>

            {deleteError && (
              <div className="mt-4 p-3 rounded-xl bg-apple-red/10 text-apple-red text-[13px] text-center font-medium">
                {deleteError}
              </div>
            )}

            <div className="flex gap-3 mt-8">
              <button
                onClick={(e) => { e.stopPropagation(); closeDeleteModal(); }}
                disabled={deleting}
                className="flex-1 px-4 py-3 rounded-xl bg-black/5 text-foreground text-[15px] font-semibold hover:bg-black/10 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); confirmDelete(); }}
                disabled={deleting}
                className="flex-1 px-4 py-3 rounded-xl bg-apple-red text-white text-[15px] font-semibold hover:bg-apple-red/90 transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderRow({ order, isSelected, isDeleteMode, onToggle }: { order: Order, isSelected: boolean, isDeleteMode: boolean, onToggle: (id: string) => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [showError, setShowError] = useState(false);
  const isCompleted = order.status === "completed";
  const isCutDone = order.status === "cut_done";
  const isFailed = order.status === "failed";
  const hasLayout = isCompleted || isCutDone;
  const utilStr = order.utilization ? `${(order.utilization * 100).toFixed(1)}%` : "—";
  const boardsStr = order.boards_used ? String(order.boards_used) : "—";
  const cabStr = order.cabinets_summary || "—";

  // Extract error message from cut_result_json when order failed
  const errorMessage = isFailed && order.cut_result_json
    ? (order.cut_result_json as Record<string, unknown>).error as string || null
    : null;

  const statusLabel = isCutDone ? t("orders.status.cutdone") : isCompleted ? t("orders.status.completed") : isFailed ? t("orders.status.failed") : order.status === "pending" ? t("orders.status.pending") : t("orders.status.processing");
  const statusColor = isCutDone ? "text-apple-green" : isCompleted ? "text-apple-blue" : isFailed ? "text-apple-red" : "text-apple-blue";

  const dateObj = new Date(order.created_at);
  const dateStr = `${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getDate()).padStart(2, '0')} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;

  return (
    <>
      <tr 
        className={`hover:bg-black/[0.03] transition-colors ${(hasLayout || isDeleteMode) ? 'cursor-pointer' : ''} ${isSelected ? 'bg-apple-blue/5' : ''}`}
        onClick={() => {
          if (isDeleteMode) {
            onToggle(order.id);
          } else if (hasLayout) {
            router.push(`/order/${order.job_id}`);
          }
        }}
      >
        {isDeleteMode && (
          <td className="py-4 px-6 w-12 text-center align-middle" onClick={(e) => { e.stopPropagation(); onToggle(order.id); }}>
            <input 
              type="checkbox" 
              checked={isSelected} 
              onChange={() => onToggle(order.id)} 
              className="w-4 h-4 rounded border-gray-300 text-apple-blue focus:ring-apple-blue cursor-pointer"
            />
          </td>
        )}
        <td className="py-4 px-4 text-[15px] font-medium text-foreground align-middle text-center max-w-[180px] truncate" title={order.filename?.replace(/\.(xlsx|xls)$/i, '') || order.job_id}>
          {order.filename?.replace(/\.(xlsx|xls)$/i, '') || order.job_id}
        </td>
        <td className="py-4 px-4 text-[14px] text-apple-gray align-middle text-center">{cabStr}</td>
        <td className="py-4 px-4 text-[14px] text-foreground font-medium align-middle text-center">{boardsStr}</td>
        <td className="py-4 px-4 align-middle text-center">
          <div className="flex flex-col items-center gap-1 w-full max-w-[200px] mx-auto">
            {order.status !== "pending" && order.status !== "processing" && (
              <span className={`inline-flex items-center text-[14px] font-medium ${statusColor}`}>
                {isCutDone && <span className="mr-1">✅</span>}
                {isFailed && <span className="mr-1">❌</span>}
                {statusLabel}
              </span>
            )}
            
            {(order.status === "processing" || order.status === "pending") && (
              <span className="inline-flex items-center text-[14px] font-medium text-apple-gray">
                {order.status === "pending" && <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse mr-2"></span>}
                {order.status === "processing" && <span className="w-2 h-2 rounded-full bg-apple-blue animate-pulse mr-2"></span>}
                {order.status === "pending" ? t("orders.status.pending") : t("orders.status.processing")}
              </span>
            )}

            {isFailed && errorMessage && (
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowError(!showError); }}
                className="inline-flex items-center gap-1 text-[12px] text-apple-red/70 hover:text-apple-red transition-colors"
              >
                {showError ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {t("orders.viewReason")}
              </button>
            )}
          </div>
        </td>
        <td className="py-4 px-4 text-[15px] font-medium text-foreground align-middle text-center">{utilStr}</td>
        <td className="py-4 px-4 text-[14px] text-apple-gray font-medium align-middle text-center">{dateStr}</td>
        <td className="py-4 px-4 align-middle text-center">
          <div className="flex items-center justify-center gap-3">
            {hasLayout ? (
              <span className="text-apple-blue text-[14px] font-medium px-3 py-1 bg-apple-blue/5 rounded-lg shrink-0 whitespace-nowrap group-hover:bg-apple-blue/10 transition-colors">{t("orders.action.view")}</span>
            ) : (
              <span className="text-apple-gray text-[14px] shrink-0 whitespace-nowrap">{order.status === "pending" ? t("orders.status.pending") : order.status === "processing" ? t("orders.status.processing") : "—"}</span>
            )}
          </div>
        </td>
      </tr>
      {isFailed && errorMessage && showError && (
        <tr>
          <td colSpan={8} className="px-8 pb-4 pt-0">
            <div className="p-3 rounded-xl bg-apple-red/5 border border-apple-red/10 text-[13px] text-apple-red/80 flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="font-semibold text-apple-red">{t("orders.failReason")}: </span>
                <span className="break-all">{errorMessage}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
