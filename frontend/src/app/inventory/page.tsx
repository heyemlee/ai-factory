"use client";
import { useState, useEffect } from "react";
import { Search, Edit2, Save, X, Trash2, AlertOctagon, Plus, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";
import { colorLabel, DEFAULT_BOX_COLOR, useBoxColors } from "@/lib/box_colors";
import { DEFAULT_MATERIAL, materialLabel, useMaterialOptions } from "@/lib/material_options";
import { FREQUENT_BOARD_SIZES, presetLabel } from "@/lib/board_size_presets";
import { useLanguage } from "@/lib/i18n";

type ItemCategory = "main" | "sub" | "aux";

interface InventoryItem {
  id: number;
  board_type: string;
  name: string;
  material: string;
  category: string;
  thickness: number;
  width: number;
  height: number;
  stock: number;
  threshold: number;
  unit: string;
  color?: string;
}

function inventoryErrorMessage(message: string) {
  if (message.includes("'color' column") || message.includes("schema cache")) {
    return "Database schema is not applied yet: inventory.color is missing in Supabase. Run backend/config/schema.sql in Supabase SQL Editor, then retry.";
  }
  return message;
}

export default function Inventory() {
  const { t, locale } = useLanguage();
  const { colors, getColor } = useBoxColors();
  const { materials, getMaterial } = useMaterialOptions();
  const [activeTab, setActiveTab] = useState<ItemCategory>("main");
  const [searchQuery, setSearchQuery] = useState("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedColor, setSelectedColor] = useState<string>("all");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<InventoryItem>>({});

  const tabs = [
    { id: "main", label: "Main Materials" },
    { id: "sub", label: "Sub Materials" },
    { id: "aux", label: "Auxiliary" },
  ] as const;

  // Fetch inventory from Supabase
  useEffect(() => {
    fetchInventory();
  }, [activeTab]);

  async function fetchInventory() {
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
      .eq("category", activeTab)
      .order("width", { ascending: false });
    if (!error && data) {
      setItems(data as InventoryItem[]);
    }
    setLoading(false);
  }

  // Unique colors found in current items (for main tab filter)
  const colorOptions = activeTab === "main"
    ? Array.from(new Set(items.map(i => i.color || DEFAULT_BOX_COLOR)))
        .sort()
    : [];

  const currentItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.board_type.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesColor = activeTab !== "main" || selectedColor === "all" || (item.color || DEFAULT_BOX_COLOR) === selectedColor;
    return matchesSearch && matchesColor;
  });

  const startEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    setEditForm({ ...item });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async (id: number) => {
    const { error } = await supabase
      .from("inventory")
      .update({
        board_type: editForm.board_type,
        name: editForm.name,
        material: editForm.material,
        height: editForm.height,
        width: editForm.width,
        thickness: editForm.thickness,
        stock: editForm.stock,
        threshold: editForm.threshold,
        color: activeTab === "main" ? (editForm.color || DEFAULT_BOX_COLOR) : editForm.color,
      })
      .eq("id", id);

    if (!error) {
      setItems(prev =>
        prev.map(item =>
          item.id === id ? { ...item, ...editForm } as InventoryItem : item
        )
      );
    } else {
      alert(inventoryErrorMessage(error.message));
    }
    setEditingId(null);
  };

  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<Partial<InventoryItem>>({
    board_type: "",
    name: "",
    material: DEFAULT_MATERIAL,
    category: "main",
    height: FREQUENT_BOARD_SIZES[0].height,
    width: FREQUENT_BOARD_SIZES[0].width,
    thickness: FREQUENT_BOARD_SIZES[0].thickness,
    stock: 0,
    threshold: 10,
    unit: "pcs",
    color: DEFAULT_BOX_COLOR,
  });
  const [sizePresetIdx, setSizePresetIdx] = useState<number | "custom">(0);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { error } = await supabase.from("inventory").delete().eq("id", deleteTarget.id);
      if (error) {
        setDeleteError(error.message);
        setDeleting(false);
        return;
      }
      setItems(prev => prev.filter(item => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleting(false);
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : "Unknown error");
      setDeleting(false);
    }
  };

  const confirmAdd = async () => {
    if (!addForm.width || !addForm.height) {
      setAddFormError("Width and Height are required.");
      return;
    }
    // Auto-generate board_type: T0 for raw sheets (1219.2 width), T1 for strips
    const w = addForm.width;
    const h = addForm.height;
    const wStr = Number.isInteger(w) ? String(w) : w!.toFixed(1).replace(/\.0$/, "");
    const hStr = Number.isInteger(h) ? String(h) : h!.toFixed(1).replace(/\.0$/, "");
    const isT0 = Math.abs(w! - 1219.2) < 1;
    const boardType = isT0 ? `T0-${wStr}x${hStr}` : `T1-${wStr}x${hStr}`;
    // Auto-generate name from material + color + thickness
    const matObj = getMaterial(addForm.material || DEFAULT_MATERIAL);
    const matName = materialLabel(matObj, locale);
    const colorObj = getColor(addForm.color || DEFAULT_BOX_COLOR);
    const colName = colorLabel(colorObj, locale);
    const autoName = addForm.category === "main"
      ? `${addForm.thickness || 18}mm ${colName} ${matName}`
      : `${addForm.thickness || 18}mm ${matName}`;
    const payload = { ...addForm, board_type: boardType, name: addForm.name?.trim() || autoName };
    setAdding(true);
    setAddFormError(null);
    try {
      const { data, error } = await supabase.from("inventory").insert([payload]).select();
      if (error) {
        setAddFormError(inventoryErrorMessage(error.message));
        setAdding(false);
        return;
      }
      if (data && data[0]) {
        if (data[0].category === activeTab) {
          setItems(prev => [...prev, data[0] as InventoryItem]);
        }
      }
      setShowAddModal(false);
      setCategoryDropdownOpen(false);
      setAddForm({
        board_type: "", name: "", material: DEFAULT_MATERIAL, category: activeTab,
        height: FREQUENT_BOARD_SIZES[0].height, width: FREQUENT_BOARD_SIZES[0].width, thickness: FREQUENT_BOARD_SIZES[0].thickness,
        stock: 0, threshold: 10, unit: "pcs", color: DEFAULT_BOX_COLOR
      });
      setSizePresetIdx(0);
      setAdding(false);
    } catch (e: unknown) {
      setAddFormError(e instanceof Error ? e.message : "Unknown error");
      setAdding(false);
    }
  };

  return (
    <div className="w-full space-y-8 py-4 flex flex-col">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between shrink-0 gap-4">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight">Inventory</h1>
          <p className="text-apple-gray text-[15px] mt-1">Manage and edit your material specifications and alert thresholds.</p>
        </div>
        <button
          onClick={() => {
            setAddForm(prev => ({ ...prev, category: activeTab, color: prev.color || DEFAULT_BOX_COLOR }));
            setShowAddModal(true);
          }}
          className="bg-apple-blue text-white px-5 py-2 rounded-full text-[14px] font-medium hover:bg-apple-blue/90 transition-colors shadow-sm shrink-0 whitespace-nowrap flex items-center gap-2"
        >
          <Plus size={16} /> Add Material
        </button>
      </div>

      <div className="bg-card rounded-xl shadow-apple flex flex-col border border-border">
        {/* iOS style segmented control header */}
        <div className="p-6 border-b border-border flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
          <div className="flex flex-wrap items-center bg-black/[0.04] p-1 rounded-xl w-full sm:w-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  "px-6 py-2 rounded-lg text-[14px] font-medium transition-all flex-1 sm:flex-none shrink-0 whitespace-nowrap",
                  activeTab === tab.id
                    ? "bg-white text-foreground shadow-sm"
                    : "text-apple-gray hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-apple-gray" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/[0.04] rounded-xl pl-9 pr-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple focus:ring-1 focus:ring-apple-blue/30 transition-all text-foreground placeholder:text-apple-gray"
            />
          </div>
        </div>

        {/* Color filter pills for main tab */}
        {activeTab === "main" && colorOptions.length > 0 && (
          <div className="px-6 py-3 border-b border-border flex flex-wrap items-center gap-2">
            <button
              onClick={() => setSelectedColor("all")}
              className={clsx(
                "px-3 py-1.5 rounded-full text-[13px] font-medium transition-all",
                selectedColor === "all"
                  ? "bg-foreground text-white shadow-sm"
                  : "bg-black/[0.04] text-apple-gray hover:bg-black/[0.08]"
              )}
            >
              All
            </button>
            {colorOptions.map(colorKey => {
              const c = getColor(colorKey);
              return (
                <button
                  key={colorKey}
                  onClick={() => setSelectedColor(colorKey)}
                  className={clsx(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium transition-all",
                    selectedColor === colorKey
                      ? "bg-foreground text-white shadow-sm"
                      : "bg-black/[0.04] text-apple-gray hover:bg-black/[0.08]"
                  )}
                >
                  <span className="w-2.5 h-2.5 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: c.hex_color }} />
                  {colorLabel(c, locale)}
                </button>
              );
            })}
          </div>
        )}

        {/* Clean Table View */}
        <div className="overflow-x-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-apple-gray text-[15px]">Loading...</div>
          ) : (
          <table className="w-full text-left min-w-[600px]">
            <thead className="sticky top-0 bg-card z-10">
              <tr>
                <th className="py-4 px-3 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border w-12 text-center">#</th>
                {activeTab === "main" && (
                  <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border">Name</th>
                )}
                {activeTab !== "main" && (
                  <>
                    <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border">ID</th>
                    <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border">Name</th>
                  </>
                )}
                {(activeTab === "main" || activeTab === "sub") && (
                  <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border">{locale === "zh" ? "尺寸" : "Size"}</th>
                )}
                <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border">Stock</th>
                {activeTab !== "main" && (
                  <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border">Threshold</th>
                )}
                <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {currentItems.map((item, rowIndex) => (
                <tr key={item.id} className="transition-colors hover:bg-black/[0.01]">
                  <td className="py-4 px-3 text-[13px] text-apple-gray text-center font-mono">{rowIndex + 1}</td>

                  {activeTab === "main" && (
                    <td className="py-4 px-6">
                      <span className="text-[14px] text-foreground">{item.name || <span className="text-apple-gray italic">—</span>}</span>
                    </td>
                  )}

                  {activeTab !== "main" && (
                    <>
                      <td className="py-4 px-6">
                        <span className="text-[14px] text-apple-gray font-mono">{item.board_type}</span>
                      </td>
                      <td className="py-4 px-6">
                        <div>
                          <div className="font-medium text-[15px]">{item.name}</div>
                          <div className="text-[13px] text-apple-gray mt-0.5">{materialLabel(getMaterial(item.material), locale)}</div>
                        </div>
                      </td>
                    </>
                  )}

                  {(activeTab === "main" || activeTab === "sub") && (
                    <td className="py-4 px-6 text-[15px] text-foreground">
                      {`${item.width}(W) × ${item.height}(H) × ${item.thickness}mm`}
                    </td>
                  )}

                  <td className="py-4 px-6">
                    <span className={clsx("font-semibold text-[15px]", item.stock < item.threshold ? "text-apple-red" : "text-foreground")}>
                      {item.stock}
                    </span>
                  </td>

                  {activeTab !== "main" && (
                    <td className="py-4 px-6">
                      <span className="text-[14px] font-medium text-apple-gray">{item.threshold}</span>
                    </td>
                  )}

                  <td className="py-4 px-6 text-right">
                    <button onClick={() => startEdit(item)} className="p-2 rounded-full text-apple-gray hover:text-apple-blue hover:bg-apple-blue/10 transition-colors shrink-0">
                      <Edit2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </div>

      {/* ── Edit Modal ── */}
      {editingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={cancelEdit} />
          <div className="relative bg-white w-full max-w-lg rounded-[24px] shadow-[0_8px_40px_rgba(0,0,0,0.16)] border border-black/5 p-8" style={{ animation: 'modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}>
            <h3 className="text-[24px] font-semibold mb-6 tracking-tight">Edit Material</h3>

            <div className="space-y-4">
              {activeTab === "main" && (
                <>
                  <div>
                    <label className="block text-[13px] font-medium text-apple-gray mb-1">Material</label>
                    <select
                      value={editForm.material || DEFAULT_MATERIAL}
                      onChange={e => setEditForm({...editForm, material: e.target.value})}
                      className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground"
                    >
                      {materials.map(material => (
                        <option key={material.key} value={material.key}>{materialLabel(material, locale)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-apple-gray mb-1">{t("inventory.color")}</label>
                    <select
                      value={editForm.color || DEFAULT_BOX_COLOR}
                      onChange={e => setEditForm({...editForm, color: e.target.value})}
                      className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground"
                    >
                      {colors.map(color => (
                        <option key={color.key} value={color.key}>{colorLabel(color, locale)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-apple-gray mb-1">Name</label>
                    <input type="text" value={editForm.name || ""} onChange={e => setEditForm({...editForm, name: e.target.value})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground" placeholder="e.g. 18mm White Melamine" />
                  </div>
                </>
              )}

              {activeTab !== "main" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-medium text-apple-gray mb-1">Board ID</label>
                    <input type="text" value={editForm.board_type || ""} onChange={e => setEditForm({...editForm, board_type: e.target.value})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white border focus:border-apple-blue/30 font-mono" />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-apple-gray mb-1">Name</label>
                    <input type="text" value={editForm.name || ""} onChange={e => setEditForm({...editForm, name: e.target.value})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white border focus:border-apple-blue/30" />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-apple-gray mb-1">{locale === "zh" ? "尺寸" : "Size"} (Width × Height × Thickness) mm</label>
                <div className="flex items-center gap-2">
                  <div className="text-center flex-1">
                    <span className="text-[11px] text-apple-gray block mb-1">Width</span>
                    <input type="number" value={editForm.width ?? 0} onChange={e => setEditForm({...editForm, width: Number(e.target.value)})} className="w-full bg-black/[0.04] rounded-xl px-3 py-2 text-[14px] text-center focus:outline-none focus:bg-white border focus:border-apple-blue/30" />
                  </div>
                  <span className="text-apple-gray mt-4">×</span>
                  <div className="text-center flex-1">
                    <span className="text-[11px] text-apple-gray block mb-1">Height</span>
                    <input type="number" value={editForm.height ?? 0} onChange={e => setEditForm({...editForm, height: Number(e.target.value)})} className="w-full bg-black/[0.04] rounded-xl px-3 py-2 text-[14px] text-center focus:outline-none focus:bg-white border focus:border-apple-blue/30" />
                  </div>
                  <span className="text-apple-gray mt-4">×</span>
                  <div className="text-center flex-1">
                    <span className="text-[11px] text-apple-gray block mb-1">Thick</span>
                    <input type="number" value={editForm.thickness ?? 18} onChange={e => setEditForm({...editForm, thickness: Number(e.target.value)})} className="w-full bg-black/[0.04] rounded-xl px-3 py-2 text-[14px] text-center focus:outline-none focus:bg-white border focus:border-apple-blue/30" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">Stock</label>
                  <input type="number" value={editForm.stock ?? 0} onChange={e => setEditForm({...editForm, stock: Number(e.target.value)})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] font-semibold focus:outline-none focus:bg-white border focus:border-apple-blue/30" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">Low Stock Threshold</label>
                  <input type="number" value={editForm.threshold ?? 0} onChange={e => setEditForm({...editForm, threshold: Number(e.target.value)})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white border focus:border-apple-blue/30" />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-8">
              <button
                onClick={() => {
                  const target = items.find(i => i.id === editingId);
                  if (target) { cancelEdit(); setDeleteTarget(target); }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-apple-red text-[14px] font-medium hover:bg-apple-red/10 transition-colors"
              >
                <Trash2 size={15} />
                Delete
              </button>
              <div className="flex gap-3">
                <button onClick={cancelEdit} className="px-6 py-2.5 rounded-full bg-black/5 text-foreground text-[14px] font-medium hover:bg-black/10 transition-colors">Cancel</button>
                <button onClick={() => saveEdit(editingId)} className="px-6 py-2.5 rounded-full bg-apple-blue text-white text-[14px] font-medium hover:bg-apple-blue/90 shadow-sm transition-colors">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => { if(!deleting) setDeleteTarget(null); }} />
          <div className="relative bg-white w-full max-w-sm rounded-[24px] shadow-[0_8px_40px_rgba(0,0,0,0.16)] border border-black/5 p-8" style={{ animation: 'modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}>
            <style>{`@keyframes modalIn { from { opacity: 0; transform: scale(0.92) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>
            <div className="w-14 h-14 rounded-full bg-apple-red/10 text-apple-red flex items-center justify-center mb-5 mx-auto">
              <AlertOctagon size={28} />
            </div>
            <h3 className="text-[20px] font-semibold text-center mb-2 tracking-tight">Delete Material?</h3>
            <p className="text-[14px] text-apple-gray text-center leading-relaxed">
              This will permanently remove <span className="font-semibold text-foreground">{deleteTarget.name}</span> from the inventory database.
            </p>

            {deleteError && (
              <div className="mt-4 p-3 rounded-xl bg-apple-red/10 text-apple-red text-[13px] text-center font-medium">
                {deleteError}
              </div>
            )}

            <div className="flex gap-3 mt-8">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} className="flex-1 px-4 py-3 rounded-xl bg-black/5 text-foreground text-[15px] font-semibold hover:bg-black/10 transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting} className="flex-1 px-4 py-3 rounded-xl bg-apple-red text-white text-[15px] font-semibold hover:bg-apple-red/90 transition-colors disabled:opacity-50">{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Material Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => { if(!adding) { setShowAddModal(false); setCategoryDropdownOpen(false); } }} />
          <div className="relative bg-white w-full max-w-lg rounded-[24px] shadow-[0_8px_40px_rgba(0,0,0,0.16)] border border-black/5 p-8" style={{ animation: 'modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}>
            <h3 className="text-[24px] font-semibold mb-6 tracking-tight">Add Material</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-apple-gray mb-1">Name <span className="text-apple-gray/60 font-normal">(optional)</span></label>
                <input type="text" value={addForm.name} onChange={e => setAddForm({...addForm, name: e.target.value})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground" placeholder="Leave blank to auto-generate" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">Material</label>
                  <select value={addForm.material || DEFAULT_MATERIAL} onChange={e => setAddForm({...addForm, material: e.target.value})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground">
                    {materials.map(material => (
                      <option key={material.key} value={material.key}>{materialLabel(material, locale)}</option>
                    ))}
                  </select>
                </div>
                <div className="relative">
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">Category</label>
                  <div
                    onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
                    className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] cursor-pointer focus:outline-none hover:bg-black/[0.06] border border-transparent transition-all text-foreground flex items-center justify-between"
                  >
                    <span>
                      {addForm.category === "main" ? "Main Materials" : addForm.category === "sub" ? "Sub Materials" : "Auxiliary"}
                    </span>
                    <ChevronDown size={16} className={`text-apple-gray transition-transform duration-200 ${categoryDropdownOpen ? "rotate-180" : ""}`} />
                  </div>
                  
                  {categoryDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setCategoryDropdownOpen(false)} />
                      <div className="absolute top-full left-0 mt-2 w-full bg-white border border-border rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-1 flex flex-col z-50 transform origin-top animate-in fade-in zoom-in-95 duration-100">
                        <button onClick={() => { setAddForm({...addForm, category: "main"}); setCategoryDropdownOpen(false); }} className={`text-left px-3 py-2 text-[14px] rounded-lg mx-1 transition-colors ${addForm.category === 'main' ? 'bg-black/5 font-semibold text-foreground' : 'text-apple-gray hover:bg-black/[0.04]'}`}>Main Materials</button>
                        <button onClick={() => { setAddForm({...addForm, category: "sub"}); setCategoryDropdownOpen(false); }} className={`text-left px-3 py-2 text-[14px] rounded-lg mx-1 transition-colors ${addForm.category === 'sub' ? 'bg-black/5 font-semibold text-foreground' : 'text-apple-gray hover:bg-black/[0.04]'}`}>Sub Materials</button>
                        <button onClick={() => { setAddForm({...addForm, category: "aux"}); setCategoryDropdownOpen(false); }} className={`text-left px-3 py-2 text-[14px] rounded-lg mx-1 transition-colors ${addForm.category === 'aux' ? 'bg-black/5 font-semibold text-foreground' : 'text-apple-gray hover:bg-black/[0.04]'}`}>Auxiliary</button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {addForm.category === "main" && (
                <div>
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">{t("inventory.color")}</label>
                  <select
                    value={addForm.color || DEFAULT_BOX_COLOR}
                    onChange={e => setAddForm({...addForm, color: e.target.value})}
                    className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground"
                  >
                    {colors.map(color => (
                      <option key={color.key} value={color.key}>{colorLabel(color, locale)}</option>
                    ))}
                  </select>
                </div>
              )}

              {(addForm.category === "main" || addForm.category === "sub") && (
                <div>
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">Size Preset</label>
                  <select
                    value={sizePresetIdx === "custom" ? "custom" : String(sizePresetIdx)}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === "custom") {
                        setSizePresetIdx("custom");
                        return;
                      }
                      const idx = Number(v);
                      const preset = FREQUENT_BOARD_SIZES[idx];
                      setSizePresetIdx(idx);
                      setAddForm({ ...addForm, width: preset.width, height: preset.height, thickness: preset.thickness });
                    }}
                    className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground mb-3"
                  >
                    {FREQUENT_BOARD_SIZES.map((p, i) => (
                      <option key={i} value={i}>{presetLabel(p)}</option>
                    ))}
                    <option value="custom">Custom…</option>
                  </select>
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">Dimensions (Width × Height/Length × Thickness) mm</label>
                  <div className="flex items-center gap-2">
                    <div className="text-center flex-1">
                      <span className="text-[11px] text-apple-gray block mb-1">Width</span>
                      <input type="number" value={addForm.width} onChange={e => setAddForm({...addForm, width: Number(e.target.value)})} className="w-full bg-black/[0.04] rounded-xl px-3 py-2 text-[14px] text-center focus:outline-none focus:bg-white border focus:border-apple-blue/30" placeholder="0" />
                    </div>
                    <span className="text-apple-gray mt-4">×</span>
                    <div className="text-center flex-1">
                      <span className="text-[11px] text-apple-gray block mb-1">Height (mm)</span>
                      <input type="number" value={addForm.height} onChange={e => setAddForm({...addForm, height: Number(e.target.value)})} className="w-full bg-black/[0.04] rounded-xl px-3 py-2 text-[14px] text-center focus:outline-none focus:bg-white border focus:border-apple-blue/30" placeholder="2438.4" />
                    </div>
                    <span className="text-apple-gray mt-4">×</span>
                    <div className="text-center flex-1">
                      <span className="text-[11px] text-apple-gray block mb-1">Thickness</span>
                      <input type="number" value={addForm.thickness} onChange={e => setAddForm({...addForm, thickness: Number(e.target.value)})} className="w-full bg-black/[0.04] rounded-xl px-3 py-2 text-[14px] text-center focus:outline-none focus:bg-white border focus:border-apple-blue/30" placeholder="18" />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">Initial Stock</label>
                  <input type="number" value={addForm.stock} onChange={e => setAddForm({...addForm, stock: Number(e.target.value)})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">Low Stock Threshold</label>
                  <input type="number" value={addForm.threshold} onChange={e => setAddForm({...addForm, threshold: Number(e.target.value)})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground" />
                </div>
              </div>
            </div>

            {addFormError && (
              <div className="mt-4 p-3 rounded-xl bg-apple-red/10 text-apple-red text-[13px] font-medium">
                {addFormError}
              </div>
            )}

            <div className="flex justify-end gap-3 mt-8">
              <button onClick={() => { setShowAddModal(false); setCategoryDropdownOpen(false); }} disabled={adding} className="px-6 py-2.5 rounded-full bg-black/5 text-foreground text-[14px] font-medium hover:bg-black/10 transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={confirmAdd} disabled={adding} className="px-6 py-2.5 rounded-full bg-apple-blue text-white text-[14px] font-medium hover:bg-apple-blue/90 shadow-sm transition-colors disabled:opacity-50">{adding ? 'Adding...' : 'Add Material'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
