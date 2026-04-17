"use client";

import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { supabase } from "@/lib/supabase";

interface CutStat {
  id: number;
  board_type: string;
  t2_height: number;
  t2_width: number;
  component: string;
  cab_id: string;
  quantity: number;
  created_at: string;
}

interface SizeGroup {
  size: string;
  height: number;
  width: number;
  count: number;
  component: string;
  board_type: string;
}

const COLORS = ["#0071e3", "#5856d6", "#34c759", "#ff9500", "#ff3b30", "#5ac8fa", "#af52de", "#ff2d55", "#64d2ff", "#30d158"];

export default function CutStats() {
  const [stats, setStats] = useState<CutStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("cutting_stats")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000)
      .then(({ data, error }) => {
        if (data) setStats(data as CutStat[]);
        if (error) console.error("Failed to load cutting stats:", error);
        setLoading(false);
      });
  }, []);

  // Group by size (height × width)
  const sizeGroups: SizeGroup[] = useMemo(() => {
    const map = new Map<string, SizeGroup>();
    for (const s of stats) {
      const key = `${s.t2_height}×${s.t2_width}`;
      if (map.has(key)) {
        map.get(key)!.count += s.quantity;
      } else {
        map.set(key, {
          size: key,
          height: s.t2_height,
          width: s.t2_width,
          count: s.quantity,
          component: s.component,
          board_type: s.board_type,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [stats]);

  const top10 = sizeGroups.slice(0, 10);
  const totalCuts = stats.reduce((s, c) => s + c.quantity, 0);
  const uniqueSizes = sizeGroups.length;

  return (
    <div className="w-full space-y-10 py-4">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight">裁切统计</h1>
        <p className="text-apple-gray text-[15px] mt-1">分析各板材规格的裁切频率，为T1库存决策提供数据支持。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard title="总裁切次数" value={String(totalCuts)} subtitle="All time" />
        <MetricCard title="板材规格种类" value={String(uniqueSizes)} subtitle="Unique sizes" />
        <MetricCard
          title="最常裁切规格"
          value={top10.length > 0 ? top10[0].size : "—"}
          subtitle={top10.length > 0 ? `${top10[0].count} 次 · ${top10[0].component}` : "No data"}
        />
      </div>

      {/* Top 10 Bar Chart */}
      <div className="bg-card rounded-2xl p-8 shadow-apple hover:shadow-apple-hover">
        <h2 className="text-xl font-semibold mb-2">Top 10 高频裁切规格</h2>
        <p className="text-apple-gray text-[13px] mb-8">这些高频规格建议作为 T1 常备库存板材。</p>
        <div className="h-[360px] w-full">
          {loading ? (
            <div className="flex items-center justify-center h-full text-apple-gray text-[15px]">加载中...</div>
          ) : top10.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top10} layout="vertical" margin={{ top: 5, right: 30, left: 120, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e5ea" />
                <XAxis type="number" stroke="#86868b" fontSize={13} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="size" stroke="#86868b" fontSize={12} tickLine={false} axisLine={false} width={110} />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.02)" }}
                  contentStyle={{ border: "none", borderRadius: "12px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
                  formatter={(value: number) => [`${value} 次`, "裁切次数"]}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={20}>
                  {top10.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-apple-gray text-[15px]">暂无裁切数据</div>
          )}
        </div>
      </div>

      {/* Full Table */}
      <div className="bg-card rounded-2xl p-8 shadow-apple hover:shadow-apple-hover">
        <h2 className="text-xl font-semibold mb-6">裁切规格频率表</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">排名</th>
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">尺寸 (H×D mm)</th>
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">Height (mm)</th>
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">Width (mm)</th>
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">裁切次数</th>
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">零件类型</th>
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">T1板型</th>
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">建议</th>
              </tr>
            </thead>
            <tbody>
              {sizeGroups.map((g, idx) => (
                <tr key={g.size} className="border-b border-border/50 hover:bg-black/[0.02] transition-colors">
                  <td className="py-3 px-4">
                    {idx < 3 ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-apple-blue text-white text-[12px] font-bold">
                        {idx + 1}
                      </span>
                    ) : (
                      <span className="text-apple-gray">{idx + 1}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-medium font-mono">{g.size}</td>
                  <td className="py-3 px-4 text-apple-gray">{g.height}</td>
                  <td className="py-3 px-4 text-apple-gray">{g.width}</td>
                  <td className="py-3 px-4">
                    <span className="font-semibold">{g.count}</span>
                  </td>
                  <td className="py-3 px-4 text-apple-gray">{g.component}</td>
                  <td className="py-3 px-4 text-apple-gray">{g.board_type}</td>
                  <td className="py-3 px-4">
                    {g.count >= 10 ? (
                      <span className="inline-flex items-center gap-1 bg-apple-green/10 text-apple-green px-2.5 py-0.5 rounded-full text-[12px] font-medium">
                        ⭐ 建议常备
                      </span>
                    ) : g.count >= 5 ? (
                      <span className="inline-flex items-center gap-1 bg-apple-blue/10 text-apple-blue px-2.5 py-0.5 rounded-full text-[12px] font-medium">
                        关注
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
              {sizeGroups.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-apple-gray">暂无裁切统计数据，完成订单后自动记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="bg-card rounded-2xl p-6 shadow-apple hover:shadow-apple-hover">
      <p className="text-[15px] font-medium text-apple-gray">{title}</p>
      <h3 className="text-[34px] font-bold tracking-tight mt-2 text-foreground">{value}</h3>
      <div className="mt-2 text-[14px] font-medium text-apple-gray">{subtitle}</div>
    </div>
  );
}
