import type { SizeColor } from "./types";

/* Simple bright color palette for 5 distinct sizes */
export const SIZE_COLORS: SizeColor[] = [
  { bg: "#bfdbfe", border: "#3b82f6", text: "#1d4ed8", light: "#ffffff" },
  { bg: "#e9d5ff", border: "#a855f7", text: "#6b21a8", light: "#ffffff" },
  { bg: "#a5f3fc", border: "#06b6d4", text: "#0891b2", light: "#ffffff" },
  { bg: "#fed7aa", border: "#f97316", text: "#c2410c", light: "#ffffff" },
  { bg: "#fbcfe8", border: "#ec4899", text: "#be185d", light: "#ffffff" },
];

/* Colors for T0 strips within a single T0 sheet */
export const T0_STRIP_COLORS = [
  { bg: "#bfdbfe", border: "#3b82f6", text: "#1d4ed8" },   // blue
  { bg: "#f9a8d4", border: "#ec4899", text: "#9d174d" },   // pink
  { bg: "#fdba74", border: "#f97316", text: "#9a3412" },   // orange
  { bg: "#c4b5fd", border: "#8b5cf6", text: "#5b21b6" },   // violet
  { bg: "#fde68a", border: "#f59e0b", text: "#92400e" },   // amber
];
