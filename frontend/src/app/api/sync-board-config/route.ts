import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST() {
  try {
    // 1. Read current recovery specs from inventory
    const { data: rows, error: fetchErr } = await supabase
      .from("inventory")
      .select("board_type,width,name")
      .like("board_type", "T1-%x2438%")
      .eq("color", "WhiteBirch")
      .order("width");

    if (fetchErr) throw new Error(fetchErr.message);
    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "No T1 recovery specs found in inventory" }, { status: 400 });
    }

    // 2. Read existing board_config.json
    const configPath = path.join(process.cwd(), "..", "backend", "config", "board_config.json");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    // 3. Update common_recovery_widths from inventory
    raw.common_recovery_widths = rows.map((r: { width: number; name: string }) => ({
      width: r.width,
      comment: r.name,
    }));

    // 4. Find the narrow (smallest ≤ 400) and wide (smallest > 400) for thresholds
    const sorted = rows.map((r: { width: number }) => r.width).sort((a: number, b: number) => a - b);
    const narrow = sorted.find((w: number) => w <= 400) || sorted[0];
    const wide = sorted.find((w: number) => w > 400 && w <= 700) || sorted[sorted.length - 1];

    raw.recovery_thresholds.narrow = narrow;
    raw.recovery_thresholds.wide = wide;
    raw.strip_width_narrow = narrow;
    raw.strip_width_wide = wide;

    // Update board names
    const narrowCode = narrow % 1 === 0 ? `${narrow}` : `${narrow}`;
    const wideCode = wide % 1 === 0 ? `${wide}` : `${wide}`;
    raw.board_names.t1_narrow = `T1-${narrowCode}-INV`;
    raw.board_names.t1_wide = `T1-${wideCode}-INV`;

    // 5. Write back
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");

    return NextResponse.json({
      ok: true,
      recovery_widths: sorted,
      narrow,
      wide,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
