"use client";

import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const materialUsage = [
  { name: '18mm MDF', value: 450, cost: 12500 },
  { name: '18mm Plywood', value: 300, cost: 15000 },
  { name: '9mm Back Panel', value: 350, cost: 5250 },
  { name: 'Edge Banding', value: 120, cost: 850 },
];

const COLORS = ['#0071e3', '#34c759', '#ff9500', '#5ac8fa'];

const dailyCost = [
  { date: '04-08', value: 3200 },
  { date: '04-09', value: 4100 },
  { date: '04-10', value: 2900 },
  { date: '04-11', value: 5500 },
  { date: '04-12', value: 4800 },
  { date: '04-13', value: 3700 },
  { date: '04-14', value: 4200 },
];

export default function BOMAnalytics() {
  return (
    <div className="w-full space-y-10 py-4">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight">BOM Analytics</h1>
        <p className="text-apple-gray text-[15px] mt-1">Review material consumption and evaluating costs.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Metric Cards */}
        <div className="bg-card rounded-2xl p-8 shadow-apple hover:shadow-apple-hover">
          <p className="text-[15px] font-medium text-apple-gray">Total Cost (MTD)</p>
          <div className="mt-2">
            <h3 className="text-[34px] font-bold tracking-tight text-foreground">$ 84,250.00</h3>
            <p className="text-[14px] text-apple-green font-medium mt-1">12.5% below average</p>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-8 shadow-apple hover:shadow-apple-hover">
          <p className="text-[15px] font-medium text-apple-gray">Average Waste Rate</p>
          <div className="mt-2">
            <h3 className="text-[34px] font-bold tracking-tight text-foreground">4.2%</h3>
            <p className="text-[14px] text-apple-green font-medium mt-1">Optimized +0.8%</p>
          </div>
        </div>

        <div className="bg-card rounded-2xl p-8 shadow-apple hover:shadow-apple-hover flex flex-col justify-between">
          <p className="text-[15px] font-medium text-apple-gray">Export Reports</p>
          <div className="flex space-x-3 mt-4">
            <button className="flex-1 bg-apple-blue text-white py-2.5 rounded-full text-[14px] font-medium hover:bg-apple-blue/90 transition-colors shadow-sm">
              CSV Export
            </button>
            <button className="flex-1 bg-black/5 text-foreground py-2.5 rounded-full text-[14px] font-medium hover:bg-black/10 transition-colors">
              JSON Data
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card shadow-apple rounded-2xl p-8">
          <h2 className="text-xl font-semibold mb-8">Material Volume Distribution</h2>
          <div className="h-72 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={materialUsage}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={110}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                  cornerRadius={4}
                >
                  {materialUsage.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center flex-wrap gap-4 mt-4">
            {materialUsage.map((entry, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }}></div>
                <span className="text-[13px] text-apple-gray">{entry.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card shadow-apple rounded-2xl p-8">
          <h2 className="text-xl font-semibold mb-8">Daily Production Cost</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyCost} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" stroke="#86868b" fontSize={13} tickLine={false} axisLine={false} dy={10} />
                <YAxis stroke="#86868b" fontSize={13} tickLine={false} axisLine={false} />
                <Tooltip cursor={{fill: 'rgba(0,0,0,0.02)'}} />
                <Bar dataKey="value" fill="#0071e3" radius={[6, 6, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
