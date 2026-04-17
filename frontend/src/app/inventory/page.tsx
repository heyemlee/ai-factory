"use client";
import { useState, useEffect } from "react";
import { Search, Edit2, Save, X } from "lucide-react";
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
  depth: number;
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
        depth: editForm.depth,
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

  return (
    <div className="w-full space-y-8 py-4 h-[calc(100vh-6rem)] flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight">Inventory</h1>
          <p className="text-apple-gray text-[15px] mt-1">Manage and edit your material specifications and alert thresholds.</p>
        </div>
        <button className="bg-apple-blue text-white px-5 py-2 rounded-full text-[14px] font-medium hover:bg-apple-blue/90 transition-colors shadow-sm">
          Add Material
        </button>
      </div>

      <div className="bg-card rounded-xl shadow-apple flex flex-col flex-1 min-h-0 border border-border">
        {/* iOS style segmented control header */}
        <div className="p-6 border-b border-border flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
          <div className="flex items-center bg-black/[0.04] p-1 rounded-xl w-full sm:w-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  "px-6 py-2 rounded-lg text-[14px] font-medium transition-all flex-1 sm:flex-none",
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
        <div className="flex-1 overflow-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-apple-gray text-[15px]">Loading...</div>
          ) : (
          <table className="w-full text-left min-w-[900px]">
            <thead className="sticky top-0 bg-card z-10">
              <tr>
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
              {currentItems.map(item => {
                const isEditing = editingId === item.id;

                return (
                  <tr key={item.id} className={clsx("transition-colors", isEditing ? "bg-apple-blue/5" : "hover:bg-black/[0.01]")}>
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
                            <input type="number" className="bg-white border border-border rounded-lg px-2 py-1.5 text-[14px] w-20 focus:outline-none focus:border-apple-blue text-center" value={editForm.height || 0} onChange={e => setEditForm({...editForm, height: Number(e.target.value)})} />
                            <span className="text-apple-gray">×</span>
                            <input type="number" className="bg-white border border-border rounded-lg px-2 py-1.5 text-[14px] w-20 focus:outline-none focus:border-apple-blue text-center" value={editForm.depth || 0} onChange={e => setEditForm({...editForm, depth: Number(e.target.value)})} />
                            <span className="text-apple-gray">×</span>
                            <input type="number" className="bg-white border border-border rounded-lg px-2 py-1.5 text-[14px] w-16 focus:outline-none focus:border-apple-blue text-center" value={editForm.thickness || 0} onChange={e => setEditForm({...editForm, thickness: Number(e.target.value)})} />
                          </div>
                        ) : (
                          `${item.depth} × ${item.height} × ${item.thickness} mm`
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
                          <button onClick={() => saveEdit(item.id)} className="p-2 rounded-full bg-apple-blue text-white hover:bg-apple-blue/90 transition-colors">
                            <Save size={16} />
                          </button>
                          <button onClick={cancelEdit} className="p-2 rounded-full bg-black/5 text-apple-gray hover:bg-black/10 transition-colors">
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(item)} className="p-2 rounded-full text-apple-gray hover:text-apple-blue hover:bg-apple-blue/10 transition-colors">
                          <Edit2 size={16} />
                        </button>
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
    </div>
  );
}
