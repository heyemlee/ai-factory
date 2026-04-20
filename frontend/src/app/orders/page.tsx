"use client";
import { useState, useEffect, useCallback } from "react";
import { UploadCloud, PieChart, Trash2, AlertOctagon } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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
}

export default function Orders() {
  const [isDragging, setIsDragging] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openDeleteModal = useCallback((order: Order) => {
    setDeleteError(null);
    setDeleteTarget(order);
  }, []);

  const closeDeleteModal = useCallback(() => {
    setDeleteTarget(null);
    setDeleteError(null);
    setDeleting(false);
  }, []);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      // Delete related bom_history first (foreign key on job_id)
      await supabase.from("bom_history").delete().eq("job_id", deleteTarget.job_id);
      // Then delete the order itself
      const { error } = await supabase.from("orders").delete().eq("id", deleteTarget.id);
      if (error) {
        setDeleteError(error.message);
        setDeleting(false);
        return;
      }
      setOrders(prev => prev.filter(o => o.id !== deleteTarget.id));
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
    fetchOrders();
  }, [fetchOrders]);

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
    const now = new Date();
    const jobId = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}_${String(now.getHours()).padStart(2,"0")}`;
    const storagePath = `orders/${jobId}_${file.name}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("order-files")
      .upload(storagePath, file);

    if (uploadError) {
      // Storage bucket might not exist — create a row anyway
      console.warn("Storage upload failed (bucket may not exist):", uploadError.message);
    }

    const fileUrl = uploadError ? null :
      supabase.storage.from("order-files").getPublicUrl(storagePath).data.publicUrl;

    // Insert order row
    const { error: insertError } = await supabase
      .from("orders")
      .insert({
        job_id: jobId,
        filename: file.name,
        status: "pending",
        file_url: fileUrl,
      });

    if (insertError) {
      alert(`Error creating order: ${insertError.message}`);
    } else {
      await fetchOrders();
    }
    setUploading(false);
  };

  return (
    <div className="w-full space-y-10 py-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight">Orders</h1>
          <p className="text-apple-gray text-[15px] mt-1">Upload and track cabinet production orders.</p>
        </div>
        <div className="bg-white rounded-2xl px-6 py-4 sm:px-8 sm:py-5 shadow-apple flex items-center gap-6 shrink-0">
          <div className="p-3 bg-apple-blue/10 rounded-xl text-apple-blue shrink-0">
            <PieChart size={24} />
          </div>
          <div className="shrink-0">
            <p className="text-[13px] font-medium text-apple-gray">Avg Utilization</p>
            <p className="text-[28px] border-none font-bold text-foreground leading-none">{overallUtil}{overallUtil !== "—" ? "%" : ""}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <div className="bg-card rounded-2xl p-8 shadow-apple h-full flex flex-col">
            <h2 className="text-xl font-semibold mb-6">New Order</h2>

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
              <h3 className="text-[15px] font-semibold mb-1">
                {uploading ? "Uploading..." : "Upload File"}
              </h3>
              <p className="text-[13px] text-apple-gray text-center mb-6">
                .xlsx format supported
              </p>
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
            <div className="px-8 py-6 border-b border-border">
              <h2 className="text-xl font-semibold">Order History</h2>
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
                    <th className="py-3 px-8 text-[13px] font-medium text-apple-gray uppercase tracking-wide">Order ID</th>
                    <th className="py-3 px-8 text-[13px] font-medium text-apple-gray uppercase tracking-wide">Cabinets</th>
                    <th className="py-3 px-8 text-[13px] font-medium text-apple-gray uppercase tracking-wide">Boards</th>
                    <th className="py-3 px-8 text-[13px] font-medium text-apple-gray uppercase tracking-wide">Status</th>
                    <th className="py-3 px-8 text-[13px] font-medium text-apple-gray uppercase tracking-wide">Utilization</th>
                    <th className="py-3 px-8 text-[13px] font-medium text-apple-gray uppercase tracking-wide text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map(order => (
                    <OrderRow key={order.id} order={order} onDelete={openDeleteModal} />
                  ))}
                </tbody>
              </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
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
            <h3 className="text-[20px] font-semibold text-center mb-2 tracking-tight">Delete Order?</h3>
            <p className="text-[14px] text-apple-gray text-center leading-relaxed">
              This will permanently remove <span className="font-semibold text-foreground">{deleteTarget.job_id}</span> and all related production history.
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

function OrderRow({ order, onDelete }: { order: Order, onDelete: (order: Order) => void }) {
  const isCompleted = order.status === "completed";
  const isCutDone = order.status === "cut_done";
  const isFailed = order.status === "failed";
  const hasLayout = isCompleted || isCutDone;
  const utilStr = order.utilization ? `${(order.utilization * 100).toFixed(1)}%` : "—";
  const boardsStr = order.boards_used ? String(order.boards_used) : "—";
  const cabStr = order.cabinets_summary || "—";

  const statusLabel = isCutDone ? "已裁切" : order.status.charAt(0).toUpperCase() + order.status.slice(1);
  const statusColor = isCutDone ? "text-apple-green" : isCompleted ? "text-apple-blue" : isFailed ? "text-apple-red" : "text-apple-blue";

  return (
    <tr className="hover:bg-black/[0.01] transition-colors">
      <td className="py-4 px-8 text-[15px] font-medium text-foreground align-middle">
        <Link href={`/order/${order.job_id}`} className="hover:text-apple-blue transition-colors">
          {order.job_id}
        </Link>
      </td>
      <td className="py-4 px-8 text-[14px] text-apple-gray align-middle">{cabStr}</td>
      <td className="py-4 px-8 text-[14px] text-foreground font-medium align-middle">{boardsStr}</td>
      <td className="py-4 px-8 align-middle">
        <span className={`inline-flex items-center text-[14px] font-medium ${statusColor}`}>
          {order.status === "processing" && <span className="w-1.5 h-1.5 rounded-full bg-apple-blue animate-pulse mr-2"></span>}
          {order.status === "pending" && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse mr-2"></span>}
          {isCutDone && <span className="mr-1">✅</span>}
          {statusLabel}
        </span>
      </td>
      <td className="py-4 px-8 text-[15px] font-medium text-foreground align-middle">{utilStr}</td>
      <td className="py-4 px-8 align-middle text-right">
        <div className="flex items-center justify-end gap-3">
          {hasLayout ? (
            <Link href={`/order/${order.job_id}`} className="text-apple-blue text-[14px] font-medium hover:underline px-3 py-1 bg-apple-blue/5 rounded-lg shrink-0 whitespace-nowrap">View</Link>
          ) : (
            <span className="text-apple-gray text-[14px] shrink-0 whitespace-nowrap">{order.status === "pending" ? "Pending" : order.status === "processing" ? "In Progress" : "—"}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(order); }}
            className="p-2 rounded-full text-apple-gray hover:text-apple-red hover:bg-apple-red/10 transition-colors shrink-0"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}
