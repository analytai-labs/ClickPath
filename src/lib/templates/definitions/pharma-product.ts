import { z } from "zod";

import type { TemplateDefinition, TemplateVariant } from "../types";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/**
 * Image fields accept either an existing https URL or a base64 data URL that the
 * server uploads to R2 on save (see `materializeDataImages`). The generous cap
 * is sized for a 2 MB image once base64-encoded.
 */
const imageField = z.string().max(5_000_000);

export const pharmaProductDataSchema = z.object({
  productName: z.string().max(255).default(""),
  composition: z.string().max(500).default(""),
  productOverview: z.string().max(2000).default(""),
  marketed: z
    .object({
      name: z.string().max(255).default(""),
      address: z.string().max(500).default(""),
    })
    .default({ name: "", address: "" }),
  manufactured: z
    .object({
      name: z.string().max(255).default(""),
      address: z.string().max(500).default(""),
    })
    .default({ name: "", address: "" }),
  productImages: z.array(imageField).max(10).default([]),
  documents: z
    .array(z.object({ imageUrl: imageField, name: z.string().max(255) }))
    .max(20)
    .default([]),
  contact: z
    .object({
      name: z.string().max(255).default(""),
      whatsapp: z.string().max(50).default(""),
      email: z.string().max(255).default(""),
    })
    .default({ name: "", whatsapp: "", email: "" }),
});

export type PharmaProductData = z.infer<typeof pharmaProductDataSchema>;

export const EMPTY_PHARMA_PRODUCT_DATA: PharmaProductData = {
  productName: "",
  composition: "",
  productOverview: "",
  marketed: { name: "", address: "" },
  manufactured: { name: "", address: "" },
  productImages: [],
  documents: [],
  contact: { name: "", whatsapp: "", email: "" },
};

/** Coerce a stored (possibly partial or legacy) JSON blob into a full data object. */
export function normalizePharmaProductData(raw: unknown): PharmaProductData {
  const value = (raw ?? {}) as Partial<PharmaProductData>;
  return {
    productName: value.productName ?? "",
    composition: value.composition ?? "",
    productOverview: value.productOverview ?? "",
    marketed: { name: "", address: "", ...(value.marketed ?? {}) },
    manufactured: { name: "", address: "", ...(value.manufactured ?? {}) },
    productImages: value.productImages ?? [],
    documents: value.documents ?? [],
    contact: { name: "", whatsapp: "", email: "", ...(value.contact ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// Styling variants
// ---------------------------------------------------------------------------

export type PharmaThemeTokens = {
  /** Page background. */
  background: string;
  /** Section card / info card surface. */
  cardBackground: string;
  textColor: string;
  mutedColor: string;
  /** Buttons and, unless `heroBackground` is set, the hero band. */
  accentColor: string;
  /** Readable text on top of the accent. */
  accentTextColor: string;
  borderColor: string;
  badgeBackground: string;
  /** Optional override for the hero band — lets a variant use a gradient. */
  heroBackground?: string;
};

/**
 * Curated, styling-only presets. Add an entry here (plus a label below) and it
 * shows up in the builder's Design tab automatically — nothing else to touch.
 */
export const PHARMA_VARIANT_TOKENS = {
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
  slate: {
    background: "#f8fafc",
    cardBackground: "#ffffff",
    textColor: "#0f172a",
    mutedColor: "#64748b",
    accentColor: "#334155",
    accentTextColor: "#f8fafc",
    borderColor: "#e2e8f0",
    badgeBackground: "#f1f5f9",
  },
  violet: {
    background: "#faf5ff",
    cardBackground: "#ffffff",
    textColor: "#2e1065",
    mutedColor: "#7c6a95",
    accentColor: "#7c3aed",
    accentTextColor: "#ffffff",
    borderColor: "#e9d5ff",
    badgeBackground: "#f3e8ff",
  },
  rose: {
    background: "#fff1f2",
    cardBackground: "#ffffff",
    textColor: "#4c0519",
    mutedColor: "#9f6b78",
    accentColor: "#e11d48",
    accentTextColor: "#ffffff",
    borderColor: "#fecdd3",
    badgeBackground: "#ffe4e6",
  },
  teal: {
    background: "#f0fdfa",
    cardBackground: "#ffffff",
    textColor: "#134e4a",
    mutedColor: "#5b8c88",
    accentColor: "#0d9488",
    accentTextColor: "#ffffff",
    borderColor: "#99f6e4",
    badgeBackground: "#ccfbf1",
  },
  mono: {
    background: "#ffffff",
    cardBackground: "#fafafa",
    textColor: "#0a0a0a",
    mutedColor: "#737373",
    accentColor: "#0a0a0a",
    accentTextColor: "#ffffff",
    borderColor: "#e5e5e5",
    badgeBackground: "#f5f5f5",
  },
  sunrise: {
    background: "#fffbf5",
    cardBackground: "#ffffff",
    textColor: "#431407",
    mutedColor: "#9a6a4f",
    accentColor: "#ea580c",
    accentTextColor: "#ffffff",
    borderColor: "#fed7aa",
    badgeBackground: "#ffedd5",
    heroBackground: "linear-gradient(135deg, #f97316 0%, #db2777 100%)",
  },
  ocean: {
    background: "#f5fbff",
    cardBackground: "#ffffff",
    textColor: "#082f49",
    mutedColor: "#5b7f96",
    accentColor: "#0284c7",
    accentTextColor: "#ffffff",
    borderColor: "#bae6fd",
    badgeBackground: "#e0f2fe",
    heroBackground: "linear-gradient(135deg, #0284c7 0%, #06b6d4 100%)",
  },
  midnight: {
    background: "#0b1120",
    cardBackground: "#111a2e",
    textColor: "#e2e8f0",
    mutedColor: "#94a3b8",
    accentColor: "#6366f1",
    accentTextColor: "#ffffff",
    borderColor: "#1e293b",
    badgeBackground: "#1e1b4b",
    heroBackground: "linear-gradient(135deg, #1e1b4b 0%, #4338ca 100%)",
  },
  graphite: {
    background: "#0f0f11",
    cardBackground: "#17171a",
    textColor: "#f4f4f5",
    mutedColor: "#a1a1aa",
    accentColor: "#22d3ee",
    accentTextColor: "#06202a",
    borderColor: "#27272a",
    badgeBackground: "#164e63",
    heroBackground: "linear-gradient(135deg, #18181b 0%, #0e7490 100%)",
  },
} satisfies Record<string, PharmaThemeTokens>;

export type PharmaVariantId = keyof typeof PHARMA_VARIANT_TOKENS;

const PHARMA_VARIANT_LABELS: Record<PharmaVariantId, string> = {
  clean: "Clean",
  "pharma-blue": "Pharma Blue",
  emerald: "Emerald",
  warm: "Warm",
  slate: "Slate",
  violet: "Violet",
  rose: "Rose",
  teal: "Teal",
  mono: "Mono",
  sunrise: "Sunrise",
  ocean: "Ocean",
  midnight: "Midnight",
  graphite: "Graphite",
};

export const DEFAULT_PHARMA_VARIANT: PharmaVariantId = "clean";

const pharmaVariants: TemplateVariant[] = (
  Object.keys(PHARMA_VARIANT_TOKENS) as PharmaVariantId[]
).map((id) => {
  const tokens: PharmaThemeTokens = PHARMA_VARIANT_TOKENS[id];
  return {
    id,
    label: PHARMA_VARIANT_LABELS[id],
    swatch: {
      background: tokens.background,
      surface: tokens.cardBackground,
      accent: tokens.heroBackground ?? tokens.accentColor,
      text: tokens.textColor,
    },
  };
});

/** Resolve a stored preset id to its tokens, falling back to the default variant. */
export function resolvePharmaTheme(variantId?: string | null): PharmaThemeTokens {
  return (
    PHARMA_VARIANT_TOKENS[variantId as PharmaVariantId] ??
    PHARMA_VARIANT_TOKENS[DEFAULT_PHARMA_VARIANT]
  );
}

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const pharmaProductTemplate: TemplateDefinition<PharmaProductData> = {
  id: "pharma_product",
  label: "Pharma Product",
  description: "A product information page: composition, packshots, literature and contacts.",
  iconKey: "flask",
  contentModel: "data",
  dataSchema: pharmaProductDataSchema,
  defaultData: EMPTY_PHARMA_PRODUCT_DATA,
  variants: pharmaVariants,
  defaultVariantId: DEFAULT_PHARMA_VARIANT,
  supportsRichTheme: false,
  usesAvatar: false,
  // Tolerates rows written before a field existed, so a legacy blob can't throw.
  deriveTitle: (data) => normalizePharmaProductData(data).productName.trim() || null,
  // Composition is what a prescriber scanning the code wants to see first, so it
  // beats the longer overview as the one line shown in a link preview.
  deriveDescription: (data) => {
    const { composition, productOverview } = normalizePharmaProductData(data);
    return composition.trim() || productOverview.trim() || null;
  },
  resolveOgColors: (theme) => {
    const t = resolvePharmaTheme(theme?.preset);
    return {
      background: t.heroBackground ?? t.background,
      text: t.heroBackground ? t.accentTextColor : t.textColor,
      muted: t.heroBackground ? t.accentTextColor : t.mutedColor,
      accent: t.accentColor,
    };
  },
};
