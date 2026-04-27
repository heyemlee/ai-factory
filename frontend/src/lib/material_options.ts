"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

export const DEFAULT_MATERIAL = "MDF";

export interface MaterialOption {
  key: string;
  name_en: string;
  name_zh: string;
  name_es: string;
  sort_order: number;
  is_active: boolean;
}

const FALLBACK_MATERIALS: MaterialOption[] = [
  { key: "MDF", name_en: "MDF", name_zh: "中密度纤维板", name_es: "MDF", sort_order: 1, is_active: true },
  { key: "Plywood", name_en: "Plywood", name_zh: "胶合板", name_es: "Contrachapado", sort_order: 2, is_active: true },
  { key: "SolidWood", name_en: "Solid Wood", name_zh: "实木", name_es: "Madera Maciza", sort_order: 3, is_active: true },
];

let materialCache: MaterialOption[] | null = null;

export async function fetchMaterialOptions(includeInactive = false): Promise<MaterialOption[]> {
  const query = supabase
    .from("material_options")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true });

  const { data, error } = includeInactive ? await query : await query.eq("is_active", true);
  if (error || !data) return FALLBACK_MATERIALS;
  materialCache = data as MaterialOption[];
  return materialCache;
}

export function materialLabel(material: MaterialOption | undefined, locale: "en" | "zh" | "es" = "en"): string {
  if (!material) return DEFAULT_MATERIAL;
  if (locale === "zh") return material.name_zh || material.name_en || material.key;
  if (locale === "es") return material.name_es || material.name_en || material.key;
  return material.name_en || material.key;
}

export function useMaterialOptions(includeInactive = false) {
  const [materials, setMaterials] = useState<MaterialOption[]>(materialCache || FALLBACK_MATERIALS);
  const [loading, setLoading] = useState(!materialCache);

  useEffect(() => {
    let alive = true;
    setLoading(!materialCache);
    fetchMaterialOptions(includeInactive).then((rows) => {
      if (!alive) return;
      setMaterials(rows);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [includeInactive]);

  const materialMap = useMemo(() => {
    const map: Record<string, MaterialOption> = {};
    for (const material of materials) map[material.key] = material;
    return map;
  }, [materials]);

  const getMaterial = (key?: string | null) => materialMap[key || DEFAULT_MATERIAL] || materialMap[DEFAULT_MATERIAL] || FALLBACK_MATERIALS[0];

  return { materials, materialMap, getMaterial, loading };
}
