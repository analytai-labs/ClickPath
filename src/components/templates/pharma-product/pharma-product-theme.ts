// Curated color presets for the Pharma Product template.
// Deliberately separate from the bio-page theme system.

export type PharmaThemePreset = "clean" | "pharma-blue" | "emerald" | "warm";

export type ResolvedPharmaTheme = {
  background: string;
  cardBackground: string;
  textColor: string;
  mutedColor: string;
  accentColor: string;
  accentTextColor: string;
  borderColor: string;
  badgeBackground: string;
};

export const PHARMA_PRESETS: Record<PharmaThemePreset, ResolvedPharmaTheme> = {
  clean: {
    background: "#ffffff",
    cardBackground: "#f9fafb",
    textColor: "#111827",
    mutedColor: "#6b7280",
    accentColor: "#2563eb",
    accentTextColor: "#ffffff",
    borderColor: "#e5e7eb",
    badgeBackground: "#eff6ff",
  },
  "pharma-blue": {
    background: "#f0f7ff",
    cardBackground: "#ffffff",
    textColor: "#1e3a5f",
    mutedColor: "#4a6fa5",
    accentColor: "#0ea5e9",
    accentTextColor: "#ffffff",
    borderColor: "#bfdbfe",
    badgeBackground: "#dbeafe",
  },
  emerald: {
    background: "#f0fdf4",
    cardBackground: "#ffffff",
    textColor: "#14532d",
    mutedColor: "#4b7c6f",
    accentColor: "#059669",
    accentTextColor: "#ffffff",
    borderColor: "#bbf7d0",
    badgeBackground: "#d1fae5",
  },
  warm: {
    background: "#fdf8f4",
    cardBackground: "#ffffff",
    textColor: "#1c1917",
    mutedColor: "#78716c",
    accentColor: "#d97706",
    accentTextColor: "#ffffff",
    borderColor: "#fde68a",
    badgeBackground: "#fef3c7",
  },
};

export const PHARMA_PRESET_OPTIONS: PharmaThemePreset[] = [
  "clean",
  "pharma-blue",
  "emerald",
  "warm",
];

export const PHARMA_PRESET_LABELS: Record<PharmaThemePreset, string> = {
  clean: "Clean",
  "pharma-blue": "Pharma Blue",
  emerald: "Emerald",
  warm: "Warm",
};

export function resolvePharmaTheme(preset?: string | null): ResolvedPharmaTheme {
  return PHARMA_PRESETS[(preset as PharmaThemePreset) ?? "clean"] ?? PHARMA_PRESETS.clean;
}
