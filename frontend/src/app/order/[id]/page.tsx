"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import clsx from "clsx";

export default function OrderDetail() {
  const params = useParams();
  const id = params?.id || "N/A";

  return (
    <div className="w-full py-4 space-y-8 flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/orders" className="p-2 bg-black/[0.04] rounded-full hover:bg-black-[0.08] transition-colors">
            <ArrowLeft size={20} className="text-foreground" />
          </Link>
          <div>
            <h1 className="text-[32px] font-semibold tracking-tight">Order #{id as string}</h1>
            <p className="text-apple-gray text-[15px] mt-1">Smart Cutting Layout Visualization</p>
          </div>
        </div>
        
        <div className="flex gap-3">
          <button className="bg-black/5 text-foreground px-5 py-2 rounded-full text-[14px] font-medium hover:bg-black/10 transition-colors">
            Print Label
          </button>
          <button className="bg-apple-blue text-white px-5 py-2 rounded-full text-[14px] font-medium hover:bg-apple-blue/90 shadow-sm transition-colors">
            Export JSON
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 flex-1 min-h-0">
        <div className="lg:col-span-1 space-y-8 overflow-y-auto pr-4">
          <div>
            <h3 className="text-[13px] font-medium uppercase tracking-wider text-apple-gray mb-4">Board Details</h3>
            <div className="bg-card rounded-2xl p-6 shadow-apple space-y-4">
              <div>
                <p className="text-[14px] text-apple-gray mb-1">Material</p>
                <p className="font-medium text-[16px]">18mm White Melamine</p>
              </div>
              <div className="w-full h-px bg-border my-2"></div>
              <div>
                <p className="text-[14px] text-apple-gray mb-1">Dimensions</p>
                <p className="font-medium text-[15px] font-mono">2440 × 1220 mm</p>
              </div>
              <div className="w-full h-px bg-border my-2"></div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <p className="text-[14px] text-apple-gray">Utilization</p>
                  <span className="font-semibold text-[15px] text-apple-blue">96.4%</span>
                </div>
                <div className="w-full bg-black/5 rounded-full h-1.5">
                  <div className="bg-apple-blue h-1.5 rounded-full" style={{ width: "96.4%" }}></div>
                </div>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="text-[13px] font-medium uppercase tracking-wider text-apple-gray mb-4">Sequence</h3>
            <div className="space-y-3">
              {[1, 2, 3].map(boardNum => (
                <div 
                  key={boardNum} 
                  className={clsx(
                    "p-4 rounded-xl cursor-pointer transition-colors flex justify-between items-center",
                    boardNum === 1 
                      ? "bg-apple-blue/10" 
                      : "bg-card shadow-sm hover:shadow-apple"
                  )}
                >
                  <span className={clsx("text-[15px] font-medium", boardNum === 1 ? "text-apple-blue" : "text-foreground")}>Board #{boardNum}</span>
                  <span className="text-[14px] text-apple-gray">
                    {boardNum === 1 ? "96.4%" : "89.2%"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 bg-white border border-border/60 rounded-3xl flex flex-col overflow-hidden shadow-apple">
          <div className="p-4 border-b border-border/60 flex justify-between items-center bg-white/80 backdrop-blur z-10 w-full">
            <div className="flex bg-black/[0.04] p-1 rounded-xl">
              <button className="px-4 py-1.5 rounded-lg text-[13px] font-medium bg-white text-foreground shadow-sm">
                Layout
              </button>
              <button className="px-4 py-1.5 rounded-lg text-[13px] font-medium text-apple-gray hover:text-foreground">
                Details
              </button>
            </div>
            <div className="text-[13px] text-apple-gray font-mono flex gap-4">
              <span>W: 1220mm</span>
              <span>L: 2440mm</span>
            </div>
          </div>
          
          <div className="flex-1 bg-[#f5f5f7] p-8 flex items-center justify-center overflow-auto">
            {/* The mock "Board" container with lighter aesthetic */}
            <div className="w-[800px] h-[400px] bg-white border-2 border-[#d2d2d7] relative shadow-sm rounded-sm">
              {/* Mock Parts rendered absolutely */}
              <div className="absolute top-0 left-0 w-[45%] h-[60%] border-[2px] border-[#0071e3] bg-[#0071e3]/5 flex items-center justify-center hover:bg-[#0071e3]/10 transition-colors cursor-pointer">
                <span className="text-[14px] font-medium text-[#0071e3]">P-01</span>
              </div>
              <div className="absolute top-0 left-[45%] w-[30%] h-[60%] border border-[#d2d2d7] bg-[#f5f5f7] flex items-center justify-center hover:bg-[#e5e5ea] transition-colors cursor-pointer">
                <span className="text-[12px] font-medium text-[#86868b]">P-02</span>
              </div>
              <div className="absolute top-0 right-0 w-[24.5%] h-[40%] border border-[#d2d2d7] bg-[#f5f5f7] flex items-center justify-center hover:bg-[#e5e5ea] transition-colors cursor-pointer">
                <span className="text-[12px] font-medium text-[#86868b]">P-03</span>
              </div>
              <div className="absolute top-[40%] right-0 w-[24.5%] h-[20%] border border-[#d2d2d7] bg-[#f5f5f7] flex items-center justify-center hover:bg-[#e5e5ea] transition-colors cursor-pointer">
                <span className="text-[12px] font-medium text-[#86868b]">P-04</span>
              </div>
              <div className="absolute bottom-0 left-0 w-[60%] h-[39.5%] border border-[#d2d2d7] bg-[#f5f5f7] flex items-center justify-center hover:bg-[#e5e5ea] transition-colors cursor-pointer">
                <span className="text-[12px] font-medium text-[#86868b]">P-05</span>
              </div>
              <div className="absolute bottom-0 right-[25%] w-[14.5%] h-[39.5%] border-t border-r border-[#d2d2d7] flex items-center justify-center flex-col 
                bg-[#f2f2f7] diagonal-stripes">
                <div className="text-[10px] text-[#86868b] uppercase font-bold tracking-widest rotate-90">Waste</div>
              </div>
              <div className="absolute bottom-0 right-0 w-[24.5%] h-[39.5%] border border-[#d2d2d7] bg-[#f5f5f7] flex items-center justify-center hover:bg-[#e5e5ea] transition-colors cursor-pointer">
                 <span className="text-[12px] font-medium text-[#86868b]">P-06</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
