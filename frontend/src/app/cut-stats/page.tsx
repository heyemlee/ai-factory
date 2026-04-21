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

interface WidthGroup {
  width: string;
  count: number;
  components: string;
  boardTypes: string;
}

const COLORS = ["#0071e3", "#5856d6", "#34c759", "#ff9500", "#ff3b30", "#5ac8fa", "#af52de", "#ff2d55", "#64d2ff", "#30d158"];

export default function CutStats() {
  const [stats, setStats] = useState<CutStat[]>([]);
  const [inventoryWidths, setInventoryWidths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // 1. Get job_ids of orders that are confirmed cut_done
      const { data: cutDoneOrders } = await supabase
        .from("orders")
        .select("job_id")
        .eq("status", "cut_done");

      const validJobIds = (cutDoneOrders || []).map((o: { job_id: string }) => o.job_id);

      // 2. Load cutting_stats only for those valid job_ids
      let statsData: CutStat[] = [];
      if (validJobIds.length > 0) {
        const { data } = await supabase
          .from("cutting_stats")
          .select("*")
          .in("job_id", validJobIds)
          .order("created_at", { ascending: false })
          .limit(5000);
        if (data) statsData = data as CutStat[];
      }

      // 3. Load inventory widths
      const { data: invData } = await supabase
        .from("inventory")
        .select("height, width")
        .eq("category", "main");

      setStats(statsData);
      if (invData) {
        const widths = new Set<string>();
        invData.forEach(item => {
          widths.add(item.width.toString());
          if (item.height !== 2438.4) {
            widths.add(item.height.toString());
          }
        });
        setInventoryWidths(widths);
      }
      setLoading(false);
    }
    load();
  }, []);

  // Group purely by t2_width and filter out existing inventory
  const widthGroups: WidthGroup[] = useMemo(() => {
    const map = new Map<string, { count: number; components: Set<string>; boardTypes: Set<string> }>();
    for (const s of stats) {
      const w = s.t2_width.toString();
      
      // Exclude if this width is already in inventory (with 1mm tolerance)
      let exists = false;
      for (const invW of inventoryWidths) {
        if (Math.abs(parseFloat(invW) - parseFloat(w)) <= 1) {
          exists = true;
          break;
        }
      }
      if (exists) continue;
      
      if (map.has(w)) {
        const item = map.get(w)!;
        item.count += s.quantity;
        if (s.component) item.components.add(s.component);
        if (s.board_type) item.boardTypes.add(s.board_type);
      } else {
        map.set(w, {
          count: s.quantity,
          components: new Set([s.component || "未命名"]),
          boardTypes: new Set([s.board_type])
        });
      }
    }
    
    return Array.from(map.entries())
      .map(([width, data]) => ({
        width,
        count: data.count,
        components: Array.from(data.components).join(", "),
        boardTypes: Array.from(data.boardTypes).join(", ")
      }))
      // Rank by total part count
      .sort((a, b) => b.count - a.count);
  }, [stats, inventoryWidths]);

  const top10 = widthGroups.slice(0, 10);
  const uniqueSizes = widthGroups.length;

  return (
    <div className="w-full space-y-10 py-4">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight">裁切统计</h1>
        <p className="text-apple-gray text-[15px] mt-1">分析各板材宽度的裁切频率（已排除现有库存规格），为新增 T1 库存决策提供数据支持。</p>
      </div>

      {/* Top 10 Bar Chart */}
      <div className="bg-card rounded-2xl p-8 shadow-apple hover:shadow-apple-hover">
        <h2 className="text-xl font-semibold mb-2">Top 10 需新增常备宽度</h2>
        <p className="text-apple-gray text-[13px] mb-8">这些是当前库存中没有，但裁切频率较高的高频宽度规格。</p>
        <div className="h-[360px] w-full">
          {loading ? (
            <div className="flex items-center justify-center h-full text-apple-gray text-[15px]">加载中...</div>
          ) : top10.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top10} layout="vertical" margin={{ top: 5, right: 30, left: 120, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e5ea" />
                <XAxis type="number" stroke="#86868b" fontSize={13} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="width" stroke="#86868b" fontSize={12} tickLine={false} axisLine={false} width={110} tickFormatter={(val) => `${val} mm`} />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.02)" }}
                  contentStyle={{ border: "none", borderRadius: "12px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
                  formatter={(value: number) => [`${value} 块`, "零件总数"]}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={20}>
                  {top10.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-apple-gray text-[15px]">暂无裁切数据或当前规格均已在库存中</div>
          )}
        </div>
      </div>

      {/* Full Table */}
      <div className="bg-card rounded-2xl p-8 shadow-apple hover:shadow-apple-hover">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">裁切宽度频率表</h2>
          <span className="text-[14px] font-medium text-apple-gray bg-black/[0.04] px-4 py-1.5 rounded-lg">
            需新增宽度种类: <span className="text-foreground font-bold ml-1">{uniqueSizes}</span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 font-semibold text-apple-gray w-20">排名</th>
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">宽度 (Width mm)</th>
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">零件总数</th>
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">零件类型 (Component)</th>
                <th className="text-left py-3 px-4 font-semibold text-apple-gray">原板型 (Board Type)</th>
              </tr>
            </thead>
            <tbody>
              {widthGroups.map((g, idx) => (
                <tr key={g.width} className="border-b border-border/50 hover:bg-black/[0.02] transition-colors">
                  <td className="py-3 px-4">
                    {idx < 3 ? (
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-apple-blue text-white text-[12px] font-bold">
                        {idx + 1}
                      </span>
                    ) : (
                      <span className="text-apple-gray">{idx + 1}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-medium font-mono text-[15px]">{g.width}</td>
                  <td className="py-3 px-4">
                    <span className="font-semibold text-[15px]">{g.count}</span>
                  </td>
                  <td className="py-3 px-4 text-apple-gray">{g.components}</td>
                  <td className="py-3 px-4 text-apple-gray">{g.boardTypes}</td>
                </tr>
              ))}
              {widthGroups.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-apple-gray">暂无需要新增库存的裁切统计数据，或现有库存规格已覆盖。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


