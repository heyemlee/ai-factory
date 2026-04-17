"use client";

import { useState, useEffect } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface InvItem {
  name: string;
  stock: number;
  threshold: number;
}

export default function Home() {
  const [inventoryData, setInventoryData] = useState<InvItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [recentOps, setRecentOps] = useState<any[]>([]);

  useEffect(() => {
    // Fetch main materials for chart
    supabase
      .from("inventory")
      .select("name, stock, threshold")
      .eq("category", "main")
      .order("id")
      .then(({ data }) => {
        if (data) setInventoryData(data as InvItem[]);
      });

    // Fetch pending order count
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then(({ count }) => {
        setPendingCount(count || 0);
      });
      
    // Fetch recent operations (latest completed orders)
    supabase
      .from("orders")
      .select("job_id, utilization, completed_at, created_at, boards_used")
      .eq("status", "completed")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(4)
      .then(({ data }) => {
        if (data) setRecentOps(data);
      });
  }, []);

  const lowStockCount = inventoryData.filter(item => item.stock < item.threshold).length;

  return (
    <div className="w-full space-y-10 py-4">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight">Overview</h1>
        <p className="text-apple-gray text-[15px] mt-1">Real-time factory metrics and system status.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <MetricCard title="Pending Orders" value={String(pendingCount)} trend="Queue" positive />
        <MetricCard title="Board Types in Stock" value={String(inventoryData.length)} trend="Main materials" positive />
        <MetricCard title="Low Stock Alerts" value={String(lowStockCount)} trend={lowStockCount > 0 ? "Action needed" : "All good"} positive={lowStockCount === 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart: Inventory Status */}
        <div className="lg:col-span-2 bg-card rounded-2xl p-8 shadow-apple hover:shadow-apple-hover">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
            <div className="flex flex-wrap items-center gap-4">
              <h2 className="text-xl font-semibold">Main Materials Inventory</h2>
              {lowStockCount > 0 && (
                <div className="flex items-center gap-1.5 bg-apple-red/10 text-apple-red px-3 py-1 rounded-full text-[13px] font-medium shrink-0 whitespace-nowrap">
                  <AlertCircle size={14} />
                  <span>{lowStockCount} below threshold</span>
                </div>
              )}
            </div>
            <Link href="/inventory" className="text-[14px] text-apple-blue font-medium hover:underline shrink-0 whitespace-nowrap">
              Manage Inventory
            </Link>
          </div>
          <div className="h-[300px] w-full">
            {inventoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={inventoryData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }} barSize={40}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5ea" />
                <XAxis dataKey="name" stroke="#86868b" fontSize={13} tickLine={false} axisLine={false} dy={10} />
                <YAxis stroke="#86868b" fontSize={13} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                  contentStyle={{ border: 'none', borderRadius: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}
                />
                <Bar dataKey="stock" radius={[6, 6, 0, 0]}>
                  {inventoryData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.stock < entry.threshold ? '#ff3b30' : '#0071e3'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-apple-gray text-[15px]">Loading inventory data...</div>
            )}
          </div>
        </div>

        {/* Activity List */}
        <div className="bg-card rounded-2xl p-8 shadow-apple hover:shadow-apple-hover flex flex-col">
          <h2 className="text-xl font-semibold mb-6">Recent Operations</h2>
          <div className="flex-1 space-y-6">
            {recentOps.length > 0 ? recentOps.map((op, idx) => {
              const util = op.utilization ? (op.utilization * 100).toFixed(1) : "—";
              // Calculate elapsed time from created to completed (pseudo representation)
              let elapsedStr = "N/A";
              if (op.created_at && op.completed_at) {
                const diffTime = Math.abs(new Date(op.completed_at).getTime() - new Date(op.created_at).getTime());
                const diffSeconds = Math.ceil(diffTime / 1000);
                if (diffSeconds < 60) elapsedStr = `${diffSeconds}s elapsed`;
                else elapsedStr = `${Math.ceil(diffSeconds / 60)}m elapsed`;
              }
              
              return (
                <div key={idx} className="flex items-start gap-4">
                  <div className="w-2.5 h-2.5 rounded-full bg-apple-blue mt-1.5 shrink-0"></div>
                  <div>
                    <div className="text-[15px] font-semibold">Yield Optimization</div>
                    <div className="text-[14px] text-apple-gray mt-0.5">Order #{op.job_id} completed</div>
                    <div className="text-[13px] font-medium text-apple-gray mt-1 flex gap-3">
                      <span className="text-foreground">{util}% yield</span>
                      <span>{elapsedStr}</span>
                    </div>
                  </div>
                </div>
              );
            }) : (
              <div className="text-apple-gray text-[14px]">No recent completed operations.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, trend, positive }: { title: string, value: string, trend: string, positive: boolean }) {
  return (
    <div className="bg-card rounded-2xl p-6 shadow-apple hover:shadow-apple-hover">
      <p className="text-[15px] font-medium text-apple-gray">{title}</p>
      <h3 className="text-[34px] font-bold tracking-tight mt-2 text-foreground">{value}</h3>
      <div className="mt-2 text-[14px] font-medium">
        <span className={positive ? "text-apple-green" : "text-apple-red"}>{trend}</span>
      </div>
    </div>
  );
}
