"use client";

import { useEffect, useState } from "react";
import { Plus, Save, X, Edit2, Power } from "lucide-react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";
import { BoxColor, colorLabel, useBoxColors } from "@/lib/box_colors";
import { useLanguage } from "@/lib/i18n";

type ColorForm = Partial<BoxColor>;

const emptyForm: ColorForm = {
  key: "",
  name_en: "",
  name_zh: "",
  name_es: "",
  hex_color: "#ffffff",
  sort_order: 0,
  is_active: true,
};

export default function ColorsPage() {
  const { t, locale } = useLanguage();
  const { colors, loading } = useBoxColors(true);
  const [rows, setRows] = useState<BoxColor[]>(colors);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ColorForm>({});
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<ColorForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRows(colors), [colors]);

  const refresh = async () => {
    const { data } = await supabase
      .from("box_colors")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("key", { ascending: true });
    if (data) setRows(data as BoxColor[]);
  };

  const startEdit = (color: BoxColor) => {
    setEditingKey(color.key);
    setEditForm({ ...color });
    setError(null);
  };

  const saveEdit = async () => {
    if (!editingKey) return;
    const { error: updateError } = await supabase
      .from("box_colors")
      .update({
        name_en: editForm.name_en,
        name_zh: editForm.name_zh,
        name_es: editForm.name_es,
        hex_color: editForm.hex_color,
        sort_order: Number(editForm.sort_order || 0),
        is_active: Boolean(editForm.is_active),
      })
      .eq("key", editingKey);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setEditingKey(null);
    await refresh();
  };

  const saveAdd = async () => {
    if (!addForm.key || !addForm.name_en || !addForm.name_zh || !addForm.name_es) {
      setError("Key and all names are required.");
      return;
    }
    const { error: insertError } = await supabase.from("box_colors").insert([{
      key: addForm.key,
      name_en: addForm.name_en,
      name_zh: addForm.name_zh,
      name_es: addForm.name_es,
      hex_color: addForm.hex_color || "#ffffff",
      sort_order: Number(addForm.sort_order || 0),
      is_active: addForm.is_active ?? true,
    }]);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setShowAdd(false);
    setAddForm(emptyForm);
    await refresh();
  };

  const toggleActive = async (color: BoxColor) => {
    const { error: updateError } = await supabase
      .from("box_colors")
      .update({ is_active: !color.is_active })
      .eq("key", color.key);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await refresh();
  };

  const renderFormCells = (form: ColorForm, setForm: (f: ColorForm) => void, keyLocked = false) => (
    <>
      <td className="py-3 px-4">
        <input
          disabled={keyLocked}
          value={form.key || ""}
          onChange={(e) => setForm({ ...form, key: e.target.value.replace(/\s+/g, "") })}
          className="w-32 bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-apple-blue disabled:bg-black/[0.03]"
        />
      </td>
      <td className="py-3 px-4">
        <input type="color" value={form.hex_color || "#ffffff"} onChange={(e) => setForm({ ...form, hex_color: e.target.value })} className="w-10 h-8 bg-transparent" />
      </td>
      <td className="py-3 px-4"><input value={form.name_en || ""} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-apple-blue" /></td>
      <td className="py-3 px-4"><input value={form.name_zh || ""} onChange={(e) => setForm({ ...form, name_zh: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-apple-blue" /></td>
      <td className="py-3 px-4"><input value={form.name_es || ""} onChange={(e) => setForm({ ...form, name_es: e.target.value })} className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] focus:outline-none focus:border-apple-blue" /></td>
      <td className="py-3 px-4">
        <input type="number" value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} className="w-20 bg-white border border-border rounded-lg px-2 py-1.5 text-[13px] text-center focus:outline-none focus:border-apple-blue" />
      </td>
      <td className="py-3 px-4">
        <label className="inline-flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={form.is_active ?? true} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          {t("colors.active")}
        </label>
      </td>
    </>
  );

  return (
    <div className="w-full space-y-6 py-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight">{t("colors.title")}</h1>
          <p className="text-apple-gray text-[15px] mt-1">{t("colors.subtitle")}</p>
        </div>
        <button onClick={() => { setShowAdd(true); setError(null); }} className="bg-apple-blue text-white px-5 py-2 rounded-full text-[14px] font-medium hover:bg-apple-blue/90 transition-colors shadow-sm flex items-center gap-2">
          <Plus size={16} /> {t("colors.add")}
        </button>
      </div>

      {error && <div className="rounded-xl bg-apple-red/10 text-apple-red px-4 py-3 text-[13px] font-medium">{error}</div>}

      <div className="bg-card rounded-xl shadow-apple border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left">
            <thead className="bg-black/[0.02]">
              <tr>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.key")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.hexColor")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.nameEn")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.nameZh")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.nameEs")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.sortOrder")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray">{t("colors.status")}</th>
                <th className="py-3 px-4 text-[12px] uppercase text-apple-gray text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {showAdd && (
                <tr className="bg-apple-blue/5">
                  {renderFormCells(addForm, setAddForm)}
                  <td className="py-3 px-4 text-right">
                    <button onClick={saveAdd} className="p-2 rounded-full bg-apple-blue text-white"><Save size={15} /></button>
                    <button onClick={() => setShowAdd(false)} className="p-2 rounded-full bg-black/5 text-apple-gray ml-2"><X size={15} /></button>
                  </td>
                </tr>
              )}
              {loading && rows.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center text-apple-gray">Loading...</td></tr>
              ) : rows.map((color) => {
                const editing = editingKey === color.key;
                return (
                  <tr key={color.key} className={clsx(editing ? "bg-apple-blue/5" : "hover:bg-black/[0.01]")}>
                    {editing ? renderFormCells(editForm, setEditForm, true) : (
                      <>
                        <td className="py-3 px-4 font-mono text-[13px]">{color.key}</td>
                        <td className="py-3 px-4"><span className="block w-7 h-7 rounded border border-black/10" style={{ backgroundColor: color.hex_color }} /></td>
                        <td className="py-3 px-4 text-[14px] font-medium">{color.name_en}</td>
                        <td className="py-3 px-4 text-[14px]">{color.name_zh}</td>
                        <td className="py-3 px-4 text-[14px]">{color.name_es}</td>
                        <td className="py-3 px-4 text-[14px]">{color.sort_order}</td>
                        <td className="py-3 px-4">
                          <span className={clsx("px-2 py-1 rounded-md text-[11px] font-semibold", color.is_active ? "bg-apple-green/10 text-apple-green" : "bg-black/5 text-apple-gray")}>
                            {color.is_active ? t("colors.active") : t("colors.inactive")}
                          </span>
                        </td>
                      </>
                    )}
                    <td className="py-3 px-4 text-right">
                      {editing ? (
                        <>
                          <button onClick={saveEdit} className="p-2 rounded-full bg-apple-blue text-white"><Save size={15} /></button>
                          <button onClick={() => setEditingKey(null)} className="p-2 rounded-full bg-black/5 text-apple-gray ml-2"><X size={15} /></button>
                        </>
                      ) : (
                        <>
                          <button title={t("colors.edit")} onClick={() => startEdit(color)} className="p-2 rounded-full text-apple-gray hover:text-apple-blue hover:bg-apple-blue/10"><Edit2 size={15} /></button>
                          <button title={color.is_active ? t("colors.deactivate") : t("colors.activate")} onClick={() => toggleActive(color)} className="p-2 rounded-full text-apple-gray hover:text-foreground hover:bg-black/5 ml-1"><Power size={15} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {rows.map((color) => (
          <span key={color.key} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/[0.04] text-[13px]">
            <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: color.hex_color }} />
            {colorLabel(color, locale)}
          </span>
        ))}
      </div>
    </div>
  );
}
