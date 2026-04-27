"use client";

import { useEffect, useState } from "react";
import { Edit2, Palette, Power, Save, Settings2, X } from "lucide-react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";
import { BoxColor, colorLabel, useBoxColors } from "@/lib/box_colors";
import { MaterialOption, materialLabel, useMaterialOptions } from "@/lib/material_options";
import { useLanguage } from "@/lib/i18n";

type ConfigTab = "colors" | "materials";
type ColorForm = Partial<BoxColor>;
type MaterialForm = Partial<MaterialOption>;

const emptyColor: ColorForm = { key: "", name_en: "", name_zh: "", name_es: "", hex_color: "#ffffff", sort_order: 0, is_active: true };
const emptyMaterial: MaterialForm = { key: "", name_en: "", name_zh: "", name_es: "", sort_order: 0, is_active: true };

export default function ConfigPage() {
  const { t, locale } = useLanguage();
  const [activeTab, setActiveTab] = useState<ConfigTab>("colors");

  const { colors } = useBoxColors(true);
  const { materials } = useMaterialOptions(true);
  const [colorRows, setColorRows] = useState<BoxColor[]>(colors);
  const [materialRows, setMaterialRows] = useState<MaterialOption[]>(materials);

  const [editingColor, setEditingColor] = useState<string | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<string | null>(null);
  const [colorForm, setColorForm] = useState<ColorForm>({});
  const [materialForm, setMaterialForm] = useState<MaterialForm>({});
  const [addingColor, setAddingColor] = useState(false);
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [newColor, setNewColor] = useState<ColorForm>(emptyColor);
  const [newMaterial, setNewMaterial] = useState<MaterialForm>(emptyMaterial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setColorRows(colors), [colors]);
  useEffect(() => setMaterialRows(materials), [materials]);

  async function refreshColors() {
    const { data } = await supabase.from("box_colors").select("*").order("sort_order").order("key");
    if (data) setColorRows(data as BoxColor[]);
  }

  async function refreshMaterials() {
    const { data } = await supabase.from("material_options").select("*").order("sort_order").order("key");
    if (data) setMaterialRows(data as MaterialOption[]);
  }

  async function saveColor(key?: string) {
    const form = key ? colorForm : newColor;
    if (!form.key || !form.name_en || !form.name_zh || !form.name_es) {
      setError("Key and all names are required.");
      return;
    }
    const payload = {
      key: form.key,
      name_en: form.name_en,
      name_zh: form.name_zh,
      name_es: form.name_es,
      hex_color: form.hex_color || "#ffffff",
      sort_order: Number(form.sort_order || 0),
      is_active: form.is_active ?? true,
    };
    const result = key
      ? await supabase.from("box_colors").update(payload).eq("key", key)
      : await supabase.from("box_colors").insert([payload]);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setEditingColor(null);
    setAddingColor(false);
    setNewColor(emptyColor);
    setError(null);
    await refreshColors();
  }

  async function saveMaterial(key?: string) {
    const form = key ? materialForm : newMaterial;
    if (!form.key || !form.name_en || !form.name_zh || !form.name_es) {
      setError("Key and all names are required.");
      return;
    }
    const payload = {
      key: form.key,
      name_en: form.name_en,
      name_zh: form.name_zh,
      name_es: form.name_es,
      sort_order: Number(form.sort_order || 0),
      is_active: form.is_active ?? true,
    };
    const result = key
      ? await supabase.from("material_options").update(payload).eq("key", key)
      : await supabase.from("material_options").insert([payload]);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setEditingMaterial(null);
    setAddingMaterial(false);
    setNewMaterial(emptyMaterial);
    setError(null);
    await refreshMaterials();
  }

  async function toggleColor(row: BoxColor) {
    const { error } = await supabase.from("box_colors").update({ is_active: !row.is_active }).eq("key", row.key);
    if (error) setError(error.message);
    else await refreshColors();
  }

  async function toggleMaterial(row: MaterialOption) {
    const { error } = await supabase.from("material_options").update({ is_active: !row.is_active }).eq("key", row.key);
    if (error) setError(error.message);
    else await refreshMaterials();
  }

  const renderNameInputs = <T extends ColorForm | MaterialForm>(form: T, setForm: (f: T) => void, keyLocked = false) => (
    <>
      <td className="py-3 px-4">
        <input disabled={keyLocked} value={form.key || ""} onChange={(e) => setForm({ ...form, key: e.target.value.replace(/\s+/g, "") })} className="w-36 bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] font-mono focus:outline-none focus:border-apple-blue disabled:bg-black/[0.03]" />
      </td>
      <td className="py-3 px-4"><input value={form.name_en || ""} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-apple-blue" /></td>
      <td className="py-3 px-4"><input value={form.name_zh || ""} onChange={(e) => setForm({ ...form, name_zh: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-apple-blue" /></td>
      <td className="py-3 px-4"><input value={form.name_es || ""} onChange={(e) => setForm({ ...form, name_es: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-apple-blue" /></td>
      <td className="py-3 px-4"><input type="number" value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} className="w-20 bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] text-center focus:outline-none focus:border-apple-blue" /></td>
      <td className="py-3 px-4">
        <label className="inline-flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.is_active ?? true} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />{t("colors.active")}</label>
      </td>
    </>
  );

  return (
    <div className="w-full space-y-6 py-4">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight">{t("config.title")}</h1>
        <p className="text-apple-gray text-[15px] mt-1">{t("config.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-center bg-black/[0.04] p-1 rounded-xl w-full sm:w-fit">
        <button onClick={() => setActiveTab("colors")} className={clsx("px-5 py-2 rounded-lg text-[14px] font-medium transition-all flex items-center gap-2", activeTab === "colors" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground")}>
          <Palette size={16} /> {t("config.colors")}
        </button>
        <button onClick={() => setActiveTab("materials")} className={clsx("px-5 py-2 rounded-lg text-[14px] font-medium transition-all flex items-center gap-2", activeTab === "materials" ? "bg-white text-foreground shadow-sm" : "text-apple-gray hover:text-foreground")}>
          <Settings2 size={16} /> {t("config.materials")}
        </button>
      </div>

      {error && <div className="rounded-xl bg-apple-red/10 text-apple-red px-4 py-3 text-[13px] font-medium">{error}</div>}

      {activeTab === "colors" && (
        <div className="bg-card rounded-xl shadow-apple border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex justify-end">
            <button onClick={() => { setAddingColor(true); setError(null); }} className="bg-apple-blue text-white px-4 py-2 rounded-full text-[13px] font-medium">+ {t("colors.add")}</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left">
              <thead className="bg-black/[0.02]"><tr>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.key")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.hexColor")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.nameEn")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.nameZh")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.nameEs")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.sortOrder")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.status")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray text-right">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {addingColor && <tr className="bg-apple-blue/5">
                  <td className="py-3 px-4"><input value={newColor.key || ""} onChange={(e) => setNewColor({ ...newColor, key: e.target.value.replace(/\s+/g, "") })} className="w-36 bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] font-mono" /></td>
                  <td className="py-3 px-4"><input type="color" value={newColor.hex_color || "#ffffff"} onChange={(e) => setNewColor({ ...newColor, hex_color: e.target.value })} className="w-10 h-8 bg-transparent" /></td>
                  <td className="py-3 px-4"><input value={newColor.name_en || ""} onChange={(e) => setNewColor({ ...newColor, name_en: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px]" /></td>
                  <td className="py-3 px-4"><input value={newColor.name_zh || ""} onChange={(e) => setNewColor({ ...newColor, name_zh: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px]" /></td>
                  <td className="py-3 px-4"><input value={newColor.name_es || ""} onChange={(e) => setNewColor({ ...newColor, name_es: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px]" /></td>
                  <td className="py-3 px-4"><input type="number" value={newColor.sort_order ?? 0} onChange={(e) => setNewColor({ ...newColor, sort_order: Number(e.target.value) })} className="w-20 bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] text-center" /></td>
                  <td className="py-3 px-4"><label className="inline-flex items-center gap-2 text-[13px]"><input type="checkbox" checked={newColor.is_active ?? true} onChange={(e) => setNewColor({ ...newColor, is_active: e.target.checked })} />{t("colors.active")}</label></td>
                  <td className="py-3 px-4 text-right"><button onClick={() => saveColor()} className="p-2 rounded-full bg-apple-blue text-white"><Save size={15} /></button><button onClick={() => setAddingColor(false)} className="p-2 rounded-full bg-black/5 text-apple-gray ml-2"><X size={15} /></button></td>
                </tr>}
                {colorRows.map((row) => {
                  const editing = editingColor === row.key;
                  return <tr key={row.key} className={editing ? "bg-apple-blue/5" : "hover:bg-black/[0.01]"}>
                    {editing ? (
                      <>
                        <td className="py-3 px-4"><input disabled value={colorForm.key || ""} className="w-36 bg-black/[0.03] border border-border rounded-lg px-2 py-1.5 text-[13px] font-mono" /></td>
                        <td className="py-3 px-4"><input type="color" value={colorForm.hex_color || "#ffffff"} onChange={(e) => setColorForm({ ...colorForm, hex_color: e.target.value })} className="w-10 h-8 bg-transparent" /></td>
                        <td className="py-3 px-4"><input value={colorForm.name_en || ""} onChange={(e) => setColorForm({ ...colorForm, name_en: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px]" /></td>
                        <td className="py-3 px-4"><input value={colorForm.name_zh || ""} onChange={(e) => setColorForm({ ...colorForm, name_zh: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px]" /></td>
                        <td className="py-3 px-4"><input value={colorForm.name_es || ""} onChange={(e) => setColorForm({ ...colorForm, name_es: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px]" /></td>
                        <td className="py-3 px-4"><input type="number" value={colorForm.sort_order ?? 0} onChange={(e) => setColorForm({ ...colorForm, sort_order: Number(e.target.value) })} className="w-20 bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] text-center" /></td>
                        <td className="py-3 px-4"><label className="inline-flex items-center gap-2 text-[13px]"><input type="checkbox" checked={colorForm.is_active ?? true} onChange={(e) => setColorForm({ ...colorForm, is_active: e.target.checked })} />{t("colors.active")}</label></td>
                      </>
                    ) : (
                      <>
                        <td className="py-3 px-4 font-mono text-[13px]">{row.key}</td>
                        <td className="py-3 px-4"><span className="block w-7 h-7 rounded border border-black/10" style={{ backgroundColor: row.hex_color }} /></td>
                        <td className="py-3 px-4 text-[14px] font-medium">{row.name_en}</td>
                        <td className="py-3 px-4 text-[14px]">{row.name_zh}</td>
                        <td className="py-3 px-4 text-[14px]">{row.name_es}</td>
                        <td className="py-3 px-4 text-[14px]">{row.sort_order}</td>
                        <td className="py-3 px-4"><span className={clsx("px-2 py-1 rounded-md text-[11px] font-semibold", row.is_active ? "bg-apple-green/10 text-apple-green" : "bg-black/5 text-apple-gray")}>{row.is_active ? t("colors.active") : t("colors.inactive")}</span></td>
                      </>
                    )}
                    <td className="py-3 px-4 text-right">{editing ? <><button onClick={() => saveColor(row.key)} className="p-2 rounded-full bg-apple-blue text-white"><Save size={15} /></button><button onClick={() => setEditingColor(null)} className="p-2 rounded-full bg-black/5 text-apple-gray ml-2"><X size={15} /></button></> : <><button onClick={() => { setEditingColor(row.key); setColorForm({ ...row }); }} className="p-2 rounded-full text-apple-gray hover:text-apple-blue hover:bg-apple-blue/10"><Edit2 size={15} /></button><button onClick={() => toggleColor(row)} className="p-2 rounded-full text-apple-gray hover:text-foreground hover:bg-black/5 ml-1"><Power size={15} /></button></>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "materials" && (
        <div className="bg-card rounded-xl shadow-apple border border-border overflow-hidden">
          <div className="p-4 border-b border-border flex justify-end">
            <button onClick={() => { setAddingMaterial(true); setError(null); }} className="bg-apple-blue text-white px-4 py-2 rounded-full text-[13px] font-medium">+ {t("materials.add")}</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead className="bg-black/[0.02]"><tr>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("materials.key")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.nameEn")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.nameZh")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.nameEs")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.sortOrder")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.status")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray text-right">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {addingMaterial && <tr className="bg-apple-blue/5">
                  {renderNameInputs(newMaterial, setNewMaterial)}
                  <td className="py-3 px-4 text-right"><button onClick={() => saveMaterial()} className="p-2 rounded-full bg-apple-blue text-white"><Save size={15} /></button><button onClick={() => setAddingMaterial(false)} className="p-2 rounded-full bg-black/5 text-apple-gray ml-2"><X size={15} /></button></td>
                </tr>}
                {materialRows.map((row) => {
                  const editing = editingMaterial === row.key;
                  return <tr key={row.key} className={editing ? "bg-apple-blue/5" : "hover:bg-black/[0.01]"}>
                    {editing ? renderNameInputs(materialForm, setMaterialForm, true) : (
                      <>
                        <td className="py-3 px-4 font-mono text-[13px]">{row.key}</td>
                        <td className="py-3 px-4 text-[14px] font-medium">{row.name_en}</td>
                        <td className="py-3 px-4 text-[14px]">{row.name_zh}</td>
                        <td className="py-3 px-4 text-[14px]">{row.name_es}</td>
                        <td className="py-3 px-4 text-[14px]">{row.sort_order}</td>
                        <td className="py-3 px-4"><span className={clsx("px-2 py-1 rounded-md text-[11px] font-semibold", row.is_active ? "bg-apple-green/10 text-apple-green" : "bg-black/5 text-apple-gray")}>{row.is_active ? t("colors.active") : t("colors.inactive")}</span></td>
                      </>
                    )}
                    <td className="py-3 px-4 text-right">{editing ? <><button onClick={() => saveMaterial(row.key)} className="p-2 rounded-full bg-apple-blue text-white"><Save size={15} /></button><button onClick={() => setEditingMaterial(null)} className="p-2 rounded-full bg-black/5 text-apple-gray ml-2"><X size={15} /></button></> : <><button onClick={() => { setEditingMaterial(row.key); setMaterialForm({ ...row }); }} className="p-2 rounded-full text-apple-gray hover:text-apple-blue hover:bg-apple-blue/10"><Edit2 size={15} /></button><button onClick={() => toggleMaterial(row)} className="p-2 rounded-full text-apple-gray hover:text-foreground hover:bg-black/5 ml-1"><Power size={15} /></button></>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className="p-4 flex flex-wrap gap-2 border-t border-border">
            {materialRows.map((row) => <span key={row.key} className="px-3 py-1.5 rounded-full bg-black/[0.04] text-[13px]">{materialLabel(row, locale)}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
