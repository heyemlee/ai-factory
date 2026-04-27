"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Package, History, FileText, BarChart3, Settings2 } from "lucide-react";
import clsx from "clsx";
import { useLanguage } from "@/lib/i18n";

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const navItems = [
    { name: t("nav.dashboard"), href: "/", icon: LayoutDashboard },
    { name: t("nav.orders"), href: "/orders", icon: FileText },
    { name: t("nav.inventory"), href: "/inventory", icon: Package },
    { name: t("nav.config"), href: "/config", icon: Settings2 },
    { name: t("nav.cutStats"), href: "/cut-stats", icon: BarChart3 },
    { name: t("nav.bomAnalytics"), href: "/bom-analytics", icon: History },
  ];

  return (
    <div className="w-64 bg-background border-r border-border h-screen flex flex-col fixed left-0 top-0 z-20">
      <div className="p-8 pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("app.title")}
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
