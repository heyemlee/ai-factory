"use client";
import React, { useMemo, useState } from "react";
import type { CutResult } from "./types";

interface Row {
  cab_id: string;
  cab_type: string;
  expected: number;
  rendered: number;
  missing: { part_id: string; component: string; expected: string }[];
  extra: { part_id: string; actual: string }[];
  dimMismatch: { part_id: string; expected: string; actual: string }[];
  ok: boolean;
}

function fmtDim(h: number, w: number): string {
  return `${h.toFixed(1)}×${w.toFixed(1)}`;
}

export function CabinetReconciliation({ cutResult }: { cutResult: CutResult | null | undefined }) {
  const rows: Row[] = useMemo(() => {
    const result: Row[] = [];
    const breakdown = cutResult?.cabinet_breakdown;
    if (!breakdown || !cutResult?.boards) return result;

    // Aggregate rendered parts per cab_id
    const renderedByCab: Record<string, Map<string, { Height: number; Width: number; auto_swapped?: boolean }>> = {};
    for (const b of cutResult.boards) {
      for (const p of b.parts || []) {
        const cab = p.cab_id;
        if (!cab) continue;
        if (!renderedByCab[cab]) renderedByCab[cab] = new Map();
        renderedByCab[cab].set(p.part_id, {
          Height: p.Height,
          Width: p.Width,
          auto_swapped: p.rotated || (p as unknown as { auto_swapped?: boolean }).auto_swapped,
        });
      }
    }

    for (const [cab_id, entry] of Object.entries(breakdown)) {
      const expectedMap = new Map(entry.parts.map((pp) => [pp.part_id, pp]));
      const renderedMap = renderedByCab[cab_id] || new Map();

      const missing: Row["missing"] = [];
      const extra: Row["extra"] = [];
      const dimMismatch: Row["dimMismatch"] = [];

      for (const [pid, exp] of expectedMap) {
        const got = renderedMap.get(pid);
        if (!got) {
          missing.push({ part_id: pid, component: exp.component, expected: fmtDim(exp.Height, exp.Width) });
          continue;
        }
        const direct = Math.abs(exp.Height - got.Height) < 0.5 && Math.abs(exp.Width - got.Width) < 0.5;
        const swapped = Math.abs(exp.Height - got.Width) < 0.5 && Math.abs(exp.Width - got.Height) < 0.5;
        if (!direct && !swapped) {
          dimMismatch.push({
            part_id: pid,
            expected: fmtDim(exp.Height, exp.Width),
            actual: fmtDim(got.Height, got.Width) + (got.auto_swapped ? " (swapped)" : ""),
          });
        }
      }

      for (const [pid, got] of renderedMap) {
        if (!expectedMap.has(pid)) {
          extra.push({ part_id: pid, actual: fmtDim(got.Height, got.Width) });
        }
      }

      result.push({
        cab_id,
        cab_type: entry.cab_type,
        expected: entry.count,
        rendered: renderedMap.size,
        missing,
        extra,
        dimMismatch,
        ok: missing.length === 0 && extra.length === 0 && dimMismatch.length === 0 && entry.count === renderedMap.size,
      });
    }

    return result.sort((a, b) => a.cab_id.localeCompare(b.cab_id));
  }, [cutResult]);

  const [open, setOpen] = useState(false);

  if (!cutResult?.cabinet_breakdown || rows.length === 0) return null;

  const totalExpected = rows.reduce((s, r) => s + r.expected, 0);
  const totalRendered = rows.reduce((s, r) => s + r.rendered, 0);
  const anyBad = rows.some((r) => !r.ok);

  return (
    <div className={`rounded-xl border-2 ${anyBad ? "border-red-400 bg-red-50" : "border-emerald-300 bg-emerald-50"} p-3 machine-no-print`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className={`text-[13px] font-semibold ${anyBad ? "text-red-800" : "text-emerald-800"}`}>
          {anyBad ? "✗" : "✓"} Cabinet reconciliation — {rows.length} cabinet(s), expected {totalExpected} parts, rendered {totalRendered}
        </span>
        <span className="text-[11px] opacity-70">{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <div className="mt-2 overflow-auto">
          <table className="w-full text-[11px] font-mono border-collapse">
            <thead>
              <tr className="text-left border-b border-current/20">
                <th className="py-1 pr-3">cab_id</th>
                <th className="py-1 pr-3">type</th>
                <th className="py-1 pr-3 text-right">expected</th>
                <th className="py-1 pr-3 text-right">rendered</th>
                <th className="py-1">status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.cab_id}>
                  <tr className={r.ok ? "text-emerald-900" : "text-red-800"}>
                    <td className="py-1 pr-3">{r.cab_id}</td>
                    <td className="py-1 pr-3">{r.cab_type}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{r.expected}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{r.rendered}</td>
                    <td className="py-1">
                      {r.ok ? "✓ ok" : (
                        <span>
                          {r.missing.length > 0 && <span className="mr-2">✗ missing {r.missing.length}</span>}
                          {r.extra.length > 0 && <span className="mr-2">✗ extra {r.extra.length}</span>}
                          {r.dimMismatch.length > 0 && <span>⚠ dim {r.dimMismatch.length}</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                  {!r.ok && (
                    <tr>
                      <td colSpan={5} className="pl-4 pb-2 text-[10px] text-red-700">
                        {r.missing.map((m) => (
                          <div key={`m-${m.part_id}`}>missing: {m.part_id} {m.component} expected {m.expected}</div>
                        ))}
                        {r.extra.map((e) => (
                          <div key={`e-${e.part_id}`}>extra: {e.part_id} actual {e.actual}</div>
                        ))}
                        {r.dimMismatch.map((d) => (
                          <div key={`d-${d.part_id}`}>dim: {d.part_id} expected {d.expected}, actual {d.actual}</div>
                        ))}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default CabinetReconciliation;
