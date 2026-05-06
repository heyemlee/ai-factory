"use client";

import { useState } from "react";
import { AlertTriangle, Layers, Package, Scissors, Zap } from "lucide-react";
import { useLanguage } from "@/lib/i18n";
import {
  CutAlgorithm,
  CutMode,
  DEFAULT_UPLOAD_SETTINGS,
  UploadSettings,
} from "@/lib/order_actions";

interface CutSettingsModalProps {
  filename: string;
  submitting: boolean;
  error: string | null;
  initialSettings?: UploadSettings;
  onCancel: () => void;
  onConfirm: (settings: UploadSettings) => void;
}

export default function CutSettingsModal({
  filename,
  submitting,
  error,
  initialSettings,
  onCancel,
  onConfirm,
}: CutSettingsModalProps) {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<UploadSettings>(initialSettings ?? DEFAULT_UPLOAD_SETTINGS);

  const setAlgorithm = (cutAlgorithm: CutAlgorithm) => {
    setSettings(prev => ({
      ...prev,
      cutAlgorithm,
      trimLossMm: cutAlgorithm === "stack_efficiency" ? prev.trimLossMm || 2 : prev.trimLossMm,
    }));
  };
  const setCutMode = (cutMode: CutMode) => setSettings(prev => ({ ...prev, cutMode }));
  const setTrim = (value: number) => setSettings(prev => ({
    ...prev,
    trimLossMm: Number.isFinite(value) ? Math.max(0, Math.min(10, value)) : 2,
  }));

  const handleBackdrop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!submitting) onCancel();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={handleBackdrop}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative bg-white w-full max-w-lg rounded-[24px] shadow-[0_8px_40px_rgba(0,0,0,0.16)] border border-black/5 p-7"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <style>{`
          @keyframes modalIn {
            from { opacity: 0; transform: scale(0.92) translateY(8px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>
        <div className="mb-6">
          <h3 className="text-[20px] font-semibold tracking-tight">{t("orders.uploadSettings")}</h3>
          <p className="text-[13px] text-apple-gray mt-1 truncate">
            {t("orders.uploadSettings.file")}: {filename}
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <div className="text-[12px] font-semibold text-apple-gray mb-2">
              {t("orders.algorithm")}
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-full bg-black/5 p-1">
              <button
                type="button"
                aria-pressed={settings.cutAlgorithm === "stack_efficiency"}
                onClick={() => setAlgorithm("stack_efficiency")}
                className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold transition-colors whitespace-nowrap ${
                  settings.cutAlgorithm === "stack_efficiency"
                    ? "bg-white text-foreground shadow-sm"
                    : "text-apple-gray hover:text-foreground"
                }`}
              >
                <Layers size={14} className="shrink-0" />
                <span className="truncate">{t("orders.algorithm.stackEfficiency")}</span>
              </button>
              <button
                type="button"
                aria-pressed={settings.cutAlgorithm === "efficient"}
                onClick={() => setAlgorithm("efficient")}
                className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold transition-colors whitespace-nowrap ${
                  settings.cutAlgorithm === "efficient"
                    ? "bg-white text-foreground shadow-sm"
                    : "text-apple-gray hover:text-foreground"
                }`}
              >
                <Zap size={14} className="shrink-0" />
                <span className="truncate">{t("orders.algorithm.efficient")}</span>
              </button>
            </div>
          </div>

          <div>
            <div className="text-[12px] font-semibold text-apple-gray mb-2">
              {t("orders.cutMode")}
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-full bg-black/5 p-1">
              <button
                type="button"
                aria-pressed={settings.cutMode === "inventory_first"}
                onClick={() => setCutMode("inventory_first")}
                className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold transition-colors whitespace-nowrap ${
                  settings.cutMode === "inventory_first"
                    ? "bg-white text-foreground shadow-sm"
                    : "text-apple-gray hover:text-foreground"
                }`}
              >
                <Package size={14} />
                {t("orders.cutMode.inventory")}
              </button>
              <button
                type="button"
                aria-pressed={settings.cutMode === "t0_start"}
                onClick={() => setCutMode("t0_start")}
                className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold transition-colors whitespace-nowrap ${
                  settings.cutMode === "t0_start"
                    ? "bg-white text-foreground shadow-sm"
                    : "text-apple-gray hover:text-foreground"
                }`}
              >
                <Scissors size={14} />
                {t("orders.cutMode.t0")}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[12px] font-semibold text-apple-gray mb-2 block">
              {t("orders.trim")}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={settings.trimLossMm}
                disabled={settings.cutAlgorithm === "efficient"}
                onChange={(e) => setTrim(Number(e.target.value))}
                className="w-28 rounded-xl bg-black/[0.04] border border-transparent px-4 py-2.5 text-[14px] font-semibold focus:outline-none focus:bg-white focus:border-apple-blue/30 disabled:opacity-50"
              />
              <span className="text-[14px] font-medium text-apple-gray">mm</span>
            </div>
            {settings.cutAlgorithm === "efficient" && (
              <p className="text-[12px] text-apple-gray mt-2">{t("orders.trim.efficientDisabled")}</p>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-apple-red/10 text-apple-red text-[13px] font-medium flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-7">
          <button
            onClick={(e) => { e.stopPropagation(); if (!submitting) onCancel(); }}
            disabled={submitting}
            className="flex-1 px-4 py-3 rounded-xl bg-black/5 text-foreground text-[15px] font-semibold hover:bg-black/10 transition-colors disabled:opacity-50"
          >
            {t("orders.cancel")}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onConfirm(settings); }}
            disabled={submitting}
            className="flex-1 px-4 py-3 rounded-xl bg-apple-blue text-white text-[15px] font-semibold hover:bg-apple-blue/90 transition-colors disabled:opacity-50"
          >
            {submitting ? t("orders.uploading") : t("orders.upload")}
          </button>
        </div>
      </div>
    </div>
  );
}
