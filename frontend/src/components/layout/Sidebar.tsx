"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Package, History, FileText } from "lucide-react";
import clsx from "clsx";

const navItems = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Orders", href: "/orders", icon: FileText },
  { name: "Inventory", href: "/inventory", icon: Package },
  { name: "BOM Analytics", href: "/bom-analytics", icon: History },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="w-64 bg-background border-r border-border h-screen flex flex-col fixed left-0 top-0 z-20">
      <div className="p-8 pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          AI Factory
        </h1>
      </div>
      
      <nav className="flex-1 px-4 space-y-1 mt-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className={clsx(
                "flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300",
                isActive 
                  ? "bg-black/5 text-apple-blue font-semibold" 
                  : "text-foreground/70 hover:bg-black/[0.03] hover:text-foreground font-medium"
              )}
            >
              <Icon 
                size={20} 
                className={clsx(isActive ? "text-apple-blue" : "text-apple-gray")} 
                strokeWidth={isActive ? 2.5 : 2}
              />
              <span className="text-sm">{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
