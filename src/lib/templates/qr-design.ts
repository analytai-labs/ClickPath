import { z } from "zod";

import { defaultGeneratorState } from "@/lib/qr-generator/state";

import type { QRCodeGeneratorState } from "@/lib/qr-generator/types";

/**
 * The QR designer state persisted on a template page.
 *
 * Mirrors the fields the link-side `QrPreset` stores, so a preset saved while
 * designing a link QR can be loaded straight onto a template page. Everything
 * else in `QRCodeGeneratorState` is render-time detail and is re-derived from
 * the generator defaults.
 */
export const templateQrDesignSchema = z.object({
  pixelStyle: z.enum(["square", "rounded", "dot", "squircle", "row", "column"]).default("rounded"),
  markerShape: z
    .enum(["square", "circle", "plus", "box", "octagon", "random", "tiny-plus"])
    .default("square"),
  markerInnerShape: z.enum(["auto", "square", "circle", "plus", "diamond", "eye"]).default("auto"),
  darkColor: z.string().max(9).default("#000000"),
  lightColor: z.string().max(9).default("#ffffff"),
  effect: z.enum(["none", "crystalize", "liquidify"]).default("none"),
  effectRadius: z.number().int().min(1).max(100).default(12),
  marginNoise: z.boolean().default(false),
  marginNoiseRate: z.number().min(0).max(1).default(0.5),
  /** An R2 URL, or a base64 data URL that the server uploads on save. */
  logoImage: z.string().max(5_000_000).nullish(),
  logoSize: z.number().int().min(10).max(30).default(25),
  logoMargin: z.number().int().min(0).max(40).default(4),
  logoBorderRadius: z.number().int().min(0).max(50).default(8),
  /** Clear a gap in the code for the logo rather than drawing it on top. */
  logoClearSpace: z.boolean().default(true),
});

export type TemplateQrDesign = z.infer<typeof templateQrDesignSchema>;

export const DEFAULT_TEMPLATE_QR_DESIGN: TemplateQrDesign = templateQrDesignSchema.parse({});

/** Coerce a stored (possibly absent or partial) blob into a full design. */
export function normalizeQrDesign(raw: unknown): TemplateQrDesign {
  const parsed = templateQrDesignSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_TEMPLATE_QR_DESIGN;
}

/** Expand a stored design into the full state `generateQRCode` expects. */
export function qrDesignToGeneratorState(
  design: TemplateQrDesign,
  text: string,
): QRCodeGeneratorState {
  return {
    ...defaultGeneratorState(),
    text,
    pixelStyle: design.pixelStyle,
    markerShape: design.markerShape,
    markerInnerShape: design.markerInnerShape,
    darkColor: design.darkColor,
    lightColor: design.lightColor,
    effect: design.effect,
    effectCrystalizeRadius: design.effectRadius,
    effectLiquidifyRadius: design.effectRadius,
    marginNoise: design.marginNoise,
    marginNoiseRate: design.marginNoiseRate,
    logoImage: design.logoImage ?? undefined,
    logoSize: design.logoSize,
    logoMargin: design.logoMargin,
    logoBorderRadius: design.logoBorderRadius,
    logoClearSpace: design.logoClearSpace,
    // Deterministic: the same design must always produce the same QR image.
    seed: 1,
  };
}
