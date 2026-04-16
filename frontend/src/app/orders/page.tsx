"use client";
import { useState } from "react";
import { UploadCloud, PieChart } from "lucide-react";
import Link from "next/link";

export default function Orders() {
  const [isDragging, setIsDragging] = useState(false);
  
  return (
    <div className="w-full space-y-10 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight">Orders</h1>
          <p className="text-apple-gray text-[15px] mt-1">Upload and track cabinet production orders.</p>
        </div>
        <div className="bg-white rounded-2xl px-8 py-5 shadow-apple flex items-center gap-6">
          <div className="p-3 bg-apple-blue/10 rounded-xl text-apple-blue">
            <PieChart size={24} />
          </div>
          <div>
            <p className="text-[13px] font-medium text-apple-gray">Overall Utilization</p>
            <p className="text-[28px] font-bold text-foreground">94.2%</p>
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
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); }}
            >
              <UploadCloud size={40} className={isDragging ? "text-apple-blue mb-4" : "text-apple-gray mb-4"} />
              <h3 className="text-[15px] font-semibold mb-1">Upload File</h3>
              <p className="text-[13px] text-apple-gray text-center mb-6">
                .xlsx format supported
              </p>
              <button className="bg-apple-blue text-white px-6 py-2 rounded-full text-[14px] font-medium hover:bg-apple-blue/90 shadow-sm transition-colors">
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
                  <OrderRow id="2026-04-16_batch" status="Completed" yieldRate="86.9%" cabinets="13 (10W/2B/1T)" boards="49" />
                  <OrderRow id="2026-04-15_02" status="Processing" yieldRate="—" cabinets="8 (6W/2B)" boards="—" />
                  <OrderRow id="2026-04-14_01" status="Completed" yieldRate="91.3%" cabinets="6 (4W/2B)" boards="22" />
                  <OrderRow id="2026-04-13_03" status="Failed" yieldRate="—" cabinets="4" boards="—" />
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderRow({ id, status, yieldRate, cabinets, boards }: { id: string, status: string, yieldRate: string, cabinets: string, boards: string }) {
  const isCompleted = status === "Completed";
  const isFailed = status === "Failed";
  
  return (
    <tr className="hover:bg-black/[0.01] transition-colors">
      <td className="py-4 px-8 text-[15px] font-medium text-foreground">
        <Link href={`/order/${id}`} className="hover:text-apple-blue transition-colors">
          {id}
        </Link>
      </td>
      <td className="py-4 px-8 text-[14px] text-apple-gray">{cabinets}</td>
      <td className="py-4 px-8 text-[14px] text-foreground font-medium">{boards}</td>
      <td className="py-4 px-8">
        <span className={`inline-flex items-center text-[14px] font-medium ${
          isCompleted ? "text-apple-green" : isFailed ? "text-apple-red" : "text-apple-blue"
        }`}>
          {status === "Processing" && <span className="w-1.5 h-1.5 rounded-full bg-apple-blue animate-pulse mr-2"></span>}
          {status}
        </span>
      </td>
      <td className="py-4 px-8 text-[15px] font-medium text-foreground">{yieldRate}</td>
      <td className="py-4 px-8 text-right">
        {isCompleted ? (
          <Link href={`/order/${id}`} className="text-apple-blue text-[14px] font-medium hover:underline px-3 py-1 bg-apple-blue/5 rounded-lg">View Layout</Link>
        ) : (
          <span className="text-apple-gray text-[14px]">Pending</span>
        )}
      </td>
    </tr>
  );
}
