import React from "react";

export function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-card rounded-xl p-4 shadow-apple flex items-center gap-3">
      <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${color}12`, color }}>{icon}</div>
      <div>
        <p className="text-[11px] font-medium text-apple-gray uppercase tracking-wide">{label}</p>
        <p className="text-[20px] font-bold text-foreground leading-tight">{value}</p>
      </div>
    </div>
  );
}
