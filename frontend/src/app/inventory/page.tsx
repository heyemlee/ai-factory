"use client";
import { useState, useEffect } from "react";
import { Search, Edit2, Save, X, Trash2, AlertOctagon, Plus, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { supabase } from "@/lib/supabase";

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
}

export default function Inventory() {
  const [activeTab, setActiveTab] = useState<ItemCategory>("main");
  const [searchQuery, setSearchQuery] = useState("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

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
      .order("id");
    if (!error && data) {
      setItems(data as InventoryItem[]);
    }
    setLoading(false);
  }

  const currentItems = items.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.board_type.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
        name: editForm.name,
        material: editForm.material,
        height: editForm.height,
        width: editForm.width,
        thickness: editForm.thickness,
        stock: editForm.stock,
        threshold: editForm.threshold,
      })
      .eq("id", id);

    if (!error) {
      setItems(prev =>
        prev.map(item =>
          item.id === id ? { ...item, ...editForm } as InventoryItem : item
        )
      );
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
    material: "MDF",
    category: "main",
    height: 2438.4,
    width: 0,
    thickness: 18,
    stock: 0,
    threshold: 10,
    unit: "pcs"
  });

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
    if (!addForm.board_type || !addForm.name) {
      setAddFormError("Board type and name are required.");
      return;
    }
    setAdding(true);
    setAddFormError(null);
    try {
      const { data, error } = await supabase.from("inventory").insert([addForm]).select();
      if (error) {
        setAddFormError(error.message);
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
        board_type: "", name: "", material: "MDF", category: activeTab, height: 2438.4, width: 0, thickness: 18, stock: 0, threshold: 10, unit: "pcs"
      });
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
            setAddForm(prev => ({ ...prev, category: activeTab }));
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

        {/* Clean Table View */}
        <div className="overflow-x-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-apple-gray text-[15px]">Loading...</div>
          ) : (
          <table className="w-full text-left min-w-[900px]">
            <thead className="sticky top-0 bg-card z-10">
              <tr>
                <th className="py-4 px-3 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border w-12 text-center">#</th>
                <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border">ID</th>
                <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border">Name</th>
                {(activeTab === "main" || activeTab === "sub") && (
                  <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border">Dimensions</th>
                )}
                <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border">Stock</th>
                <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border">Threshold</th>
                <th className="py-4 px-6 text-[13px] font-medium text-apple-gray uppercase tracking-wide border-b border-border text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {currentItems.map((item, rowIndex) => {
                const isEditing = editingId === item.id;

                return (
                  <tr key={item.id} className={clsx("transition-colors", isEditing ? "bg-apple-blue/5" : "hover:bg-black/[0.01]")}>
                    <td className="py-4 px-3 text-[13px] text-apple-gray text-center font-mono">{rowIndex + 1}</td>
                    <td className="py-4 px-6 text-[14px] text-apple-gray">{item.board_type}</td>

                    <td className="py-4 px-6">
                      {isEditing ? (
                        <input
                          className="bg-white border border-border rounded-lg px-3 py-1.5 text-[14px] w-full focus:outline-none focus:border-apple-blue"
                          value={editForm.name || ""}
                          onChange={e => setEditForm({...editForm, name: e.target.value})}
                        />
                      ) : (
                        <div>
                          <div className="font-medium text-[15px]">{item.name}</div>
                          <div className="text-[13px] text-apple-gray mt-0.5">{item.material}</div>
                        </div>
                      )}
                    </td>

                    {(activeTab === "main" || activeTab === "sub") && (
                      <td className="py-4 px-6 text-[15px] text-foreground">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <div className="text-center">
                              <span className="text-[10px] text-apple-gray block">Width</span>
                              <input type="number" className="bg-white border border-border rounded-lg px-2 py-1.5 text-[14px] w-20 focus:outline-none focus:border-apple-blue text-center" value={editForm.width ?? 0} onChange={e => setEditForm({...editForm, width: Number(e.target.value)})} />
                            </div>
                            <span className="text-apple-gray pt-4">×</span>
                            <div className="text-center">
                              <span className="text-[10px] text-apple-gray block">Height(mm)</span>
                              <input type="number" className="bg-white border border-border rounded-lg px-2 py-1.5 text-[14px] w-24 focus:outline-none focus:border-apple-blue text-center" value={editForm.height ?? 0} onChange={e => setEditForm({...editForm, height: Number(e.target.value)})} />
                            </div>
                            <span className="text-apple-gray pt-4">×</span>
                            <div className="text-center">
                              <span className="text-[10px] text-apple-gray block">Thick</span>
                              <input type="number" className="bg-white border border-border rounded-lg px-2 py-1.5 text-[14px] w-16 focus:outline-none focus:border-apple-blue text-center" value={editForm.thickness ?? 18} onChange={e => setEditForm({...editForm, thickness: Number(e.target.value)})} />
                            </div>
                          </div>
                        ) : (
                          `${item.width}(W) × ${item.height}(H) × ${item.thickness}mm`
                        )}
                      </td>
                    )}

                    <td className="py-4 px-6">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            className="bg-white border border-apple-blue rounded-lg px-3 py-1.5 text-[14px] w-20 text-foreground font-semibold focus:outline-none"
                            value={editForm.stock || 0}
                            onChange={e => setEditForm({...editForm, stock: Number(e.target.value)})}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={clsx("font-semibold text-[15px]", item.stock < item.threshold ? "text-apple-red" : "text-foreground")}>
                            {item.stock}
                          </span>
                        </div>
                      )}
                    </td>

                    <td className="py-4 px-6">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            className="bg-white border border-border rounded-lg px-3 py-1.5 text-[14px] w-20 text-foreground focus:outline-none focus:border-apple-blue"
                            value={editForm.threshold || 0}
                            onChange={e => setEditForm({...editForm, threshold: Number(e.target.value)})}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium text-apple-gray">
                            {item.threshold}
                          </span>
                        </div>
                      )}
                    </td>

                    <td className="py-4 px-6 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => saveEdit(item.id)} className="p-2 rounded-full bg-apple-blue text-white hover:bg-apple-blue/90 transition-colors shrink-0">
                            <Save size={16} />
                          </button>
                          <button onClick={cancelEdit} className="p-2 rounded-full bg-black/5 text-apple-gray hover:bg-black/10 transition-colors shrink-0">
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => startEdit(item)} className="p-2 rounded-full text-apple-gray hover:text-apple-blue hover:bg-apple-blue/10 transition-colors shrink-0">
                            <Edit2 size={16} />
                          </button>
                          <button onClick={() => setDeleteTarget(item)} className="p-2 rounded-full text-apple-gray hover:text-apple-red hover:bg-apple-red/10 transition-colors shrink-0">
            <Trash2 size={16} />
          </button>
                        </div>
                      )}
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
      </div>

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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">Board ID / Code</label>
                  <input type="text" value={addForm.board_type} onChange={e => setAddForm({...addForm, board_type: e.target.value})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground" placeholder="e.g. W18-MDF" />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">Name</label>
                  <input type="text" value={addForm.name} onChange={e => setAddForm({...addForm, name: e.target.value})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground" placeholder="e.g. 18mm White Melamine" />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-apple-gray mb-1">Material</label>
                  <input type="text" value={addForm.material} onChange={e => setAddForm({...addForm, material: e.target.value})} className="w-full bg-black/[0.04] rounded-xl px-4 py-2 text-[14px] focus:outline-none focus:bg-white focus:shadow-apple border border-transparent focus:border-apple-blue/30 transition-all text-foreground" placeholder="e.g. MDF / Plywood" />
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

              {(addForm.category === "main" || addForm.category === "sub") && (
                <div>
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
