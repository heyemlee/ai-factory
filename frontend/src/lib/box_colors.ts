"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

export const DEFAULT_BOX_COLOR = "WhiteBirch";

export interface BoxColor {
  key: string;
  name_en: string;
  name_zh: string;
  name_es: string;
  hex_color: string;
  sort_order: number;
  is_active: boolean;
}

const FALLBACK_COLORS: BoxColor[] = [
  {
    key: "WhiteBirch",
    name_en: "White Birch Plywood",
    name_zh: "白桦木胶合板",
    name_es: "Contrachapado de Abedul Blanco",
    hex_color: "#F5DEB3",
    sort_order: 1,
    is_active: true,
  },
  {
    key: "WhiteMelamine",
    name_en: "White Melamine Plywood",
    name_zh: "白色三聚氰胺板",
    name_es: "Melamina Blanca",
    hex_color: "#FAFAFA",
    sort_order: 2,
    is_active: true,
  },
];

let colorCache: BoxColor[] | null = null;

export async function fetchBoxColors(includeInactive = false): Promise<BoxColor[]> {
  const query = supabase
    .from("box_colors")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true });

  const { data, error } = includeInactive ? await query : await query.eq("is_active", true);
  if (error || !data) {
    return FALLBACK_COLORS;
  }
  colorCache = data as BoxColor[];
  return colorCache;
}

export function colorLabel(color: BoxColor | undefined, locale: "en" | "zh" | "es" = "en"): string {
  if (!color) return DEFAULT_BOX_COLOR;
  if (locale === "zh") return color.name_zh || color.name_en || color.key;
  if (locale === "es") return color.name_es || color.name_en || color.key;
  return color.name_en || color.key;
}

export function useBoxColors(includeInactive = false) {
  const [colors, setColors] = useState<BoxColor[]>(colorCache || FALLBACK_COLORS);
  const [loading, setLoading] = useState(!colorCache);

  useEffect(() => {
    let alive = true;
    setLoading(!colorCache);
    fetchBoxColors(includeInactive).then((rows) => {
      if (!alive) return;
      setColors(rows);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [includeInactive]);

  const colorMap = useMemo(() => {
    const map: Record<string, BoxColor> = {};
    for (const color of colors) map[color.key] = color;
    return map;
  }, [colors]);

  const getColor = (key?: string | null) => colorMap[key || DEFAULT_BOX_COLOR] || colorMap[DEFAULT_BOX_COLOR] || FALLBACK_COLORS[0];

  return { colors, colorMap, getColor, loading };
}
