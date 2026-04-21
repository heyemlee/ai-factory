"use client";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { LanguageProvider } from "@/lib/i18n";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/login";

  if (isAuthPage) {
    return <main className="min-h-screen w-full">{children}</main>;
  }

  return (
    <LanguageProvider>
      <Sidebar />
      <div className="flex-1 flex flex-col ml-64 min-h-screen relative w-full">
        <Topbar />
        <main className="flex-1 p-8 relative w-full">
          {children}
        </main>
      </div>
    </LanguageProvider>
  );
}
