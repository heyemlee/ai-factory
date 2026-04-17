"use client";
import { CheckCircle2, Clock, User, Settings, LogOut } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";

export default function Topbar() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const [pendingCount, setPendingCount] = useState<number>(0);
  const [completedCount, setCompletedCount] = useState<number>(0);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    async function fetchCounts() {
      const { data } = await supabase.from("orders").select("status");
      if (data) {
        setPendingCount(data.filter((d: any) => d.status === "pending").length);
        setCompletedCount(data.filter((d: any) => d.status === "completed").length);
      }
    }
    
    fetchCounts();

    const channel = supabase.channel("topbar_orders_status")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        fetchCounts();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSignOut = () => {
    setDropdownOpen(false);
    router.push("/login");
  };

  return (
    <header className="h-16 bg-background/80 backdrop-blur-xl flex items-center justify-between px-8 sticky top-0 z-10 supports-[backdrop-filter]:bg-background/60 border-b border-border">
      <div className="flex items-center gap-8 flex-1">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-apple-blue" />
          <span className="text-[14px] font-medium text-foreground">Pending Orders: <span className="font-bold text-apple-blue ml-1">{pendingCount}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} className="text-apple-green" />
          <span className="text-[14px] font-medium text-foreground">Completed Orders: <span className="font-bold text-apple-green ml-1">{completedCount}</span></span>
        </div>
      </div>
      
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-apple-green opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-apple-green"></span>
          </span>
          <span className="text-[13px] font-medium text-apple-gray">System Online</span>
        </div>

        <div className="relative" ref={dropdownRef}>
          <div 
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-[13px] font-semibold text-foreground cursor-pointer hover:bg-black/10 transition-colors border border-border"
          >
            A
          </div>
          
          <div className={clsx(
            "absolute right-0 top-full mt-2 w-56 bg-white border border-border rounded-xl shadow-apple p-1 flex flex-col transition-all origin-top-right z-50",
            dropdownOpen ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"
          )}>
            <div className="px-3 py-3 border-b border-border mx-1 mb-1">
              <p className="text-[14px] font-semibold text-foreground">Admin User</p>
              <p className="text-[13px] text-apple-gray mt-0.5">admin@aifactory.com</p>
            </div>
            <Link href="#" className="flex items-center gap-3 px-3 py-2 text-[14px] text-foreground hover:bg-black/[0.04] rounded-lg mx-1 transition-colors">
              <User size={16} className="text-apple-gray" /> Profile Center
            </Link>
            <Link href="#" className="flex items-center gap-3 px-3 py-2 text-[14px] text-foreground hover:bg-black/[0.04] rounded-lg mx-1 transition-colors">
              <Settings size={16} className="text-apple-gray" /> Workspace Settings
            </Link>
            <div className="h-px bg-border my-1 mx-1"></div>
            <button 
              onClick={handleSignOut}
              className="flex items-center gap-3 px-3 py-2 text-[14px] text-apple-red hover:bg-apple-red/10 rounded-lg mx-1 transition-colors text-left w-[calc(100%-8px)]"
            >
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
