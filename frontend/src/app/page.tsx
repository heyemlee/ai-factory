"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

const inventoryData = [
  { name: 'T0 Full Sheet (1219×2438)', stock: 50, threshold: 10 },
  { name: 'T1 Wall 305×2438', stock: 100, threshold: 30 },
  { name: 'T1 Base 610×2438', stock: 100, threshold: 30 },
];

export default function Home() {
  const lowStockCount = inventoryData.filter(item => item.stock < item.threshold).length;

  return (
    <div className="w-full space-y-10 py-4">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight">Overview</h1>
        <p className="text-apple-gray text-[15px] mt-1">Real-time factory metrics and system status.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <MetricCard title="Active Orders Processing" value="12" trend="Steady" positive />
        <MetricCard title="Boards Consumed (7d)" value="3,450" trend="-1.2%" positive={false} />
        <MetricCard title="AI Pipeline Speed" value="1.2s" trend="-0.3s" positive />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart: Inventory Status */}
        <div className="lg:col-span-2 bg-card rounded-2xl p-8 shadow-apple hover:shadow-apple-hover">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-semibold">Main Materials Inventory</h2>
              {lowStockCount > 0 && (
                <div className="flex items-center gap-1.5 bg-apple-red/10 text-apple-red px-3 py-1 rounded-full text-[13px] font-medium">
                  <AlertCircle size={14} />
                  <span>{lowStockCount} below threshold</span>
                </div>
              )}
            </div>
            <Link href="/inventory" className="text-[14px] text-apple-blue font-medium hover:underline">
              Manage Inventory
            </Link>
          </div>
          <div className="h-[300px] w-full">
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
          </div>
        </div>

        {/* Activity List */}
        <div className="bg-card rounded-2xl p-8 shadow-apple hover:shadow-apple-hover flex flex-col">
          <h2 className="text-xl font-semibold mb-6">Recent Operations</h2>
          <div className="flex-1 space-y-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-4">
                <div className="w-2.5 h-2.5 rounded-full bg-apple-blue mt-1.5 shrink-0"></div>
                <div>
                  <div className="text-[15px] font-semibold">Yield Optimization</div>
                  <div className="text-[14px] text-apple-gray mt-0.5">Order #2026-04-14_{i} completed</div>
                  <div className="text-[13px] font-medium text-apple-gray mt-1 flex gap-3">
                    <span className="text-foreground">95.1% yield</span>
                    <span>2s elapsed</span>
                  </div>
                </div>
              </div>
            ))}
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
        <span className="text-apple-gray ml-2">from last week</span>
      </div>
    </div>
  );
}
