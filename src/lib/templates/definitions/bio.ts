import { z } from "zod";

import { BIO_PRESETS, resolveBioTheme } from "@/components/bio/theme";

import type { BioPageTheme } from "@/server/db/types";
import type { TemplateDefinition, TemplateVariant } from "../types";

/**
 * The link-in-bio template. Its content lives in ordered BioBlock rows rather
 * than in `templateData`, and its theme is richer than a plain variant (accent
 * color, font and button style are layered on top of the chosen preset), so the
 * variant list here is only the preset half of that system — `resolveBioTheme`
 * in `@/components/bio/theme` remains the single source of truth for rendering.
 */
const variants: TemplateVariant[] = Object.entries(BIO_PRESETS).map(([id, preset]) => ({
  id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
  swatch: {
    background: preset.background,
    surface: preset.background,
    accent: preset.accent,
    text: preset.text,
  },
}));

export type BioTemplateData = Record<string, never>;

export const bioTemplate: TemplateDefinition<BioTemplateData> = {
  id: "bio",
  label: "Bio Page",
  description: "A link-in-bio page: avatar, blurb and a stack of tracked link blocks.",
  iconKey: "layout-list",
  contentModel: "blocks",
  dataSchema: z.object({}) as unknown as z.ZodType<BioTemplateData>,
  defaultData: {} as BioTemplateData,
  variants,
  defaultVariantId: "minimal",
  supportsRichTheme: true,
  usesAvatar: true,
  deriveTitle: () => null,
  resolveOgColors: (theme) => {
    const t = resolveBioTheme((theme ?? null) as BioPageTheme | null);
    return {
      background: t.backgroundCss,
      text: t.textColor,
      muted: t.mutedColor,
      accent: t.accentColor,
    };
  },
};
