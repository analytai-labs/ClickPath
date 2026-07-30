import type { TemplateType } from "@prisma/client";
import type { z } from "zod";

/**
 * A template type id. Sourced from the Prisma enum so the registry can never
 * drift from the database: adding an enum member without a registry entry is a
 * type error (see TEMPLATE_DEFINITIONS).
 */
export type TemplateTypeId = TemplateType;

/** Icon key resolved to a real component by the UI registry. */
export type TemplateIconKey = "layout-list" | "flask";

/** Colors shown in the variant picker so a preset is recognisable at a glance. */
export type TemplateVariantSwatch = {
  /** Page background — any CSS `background` value (solid or gradient). */
  background: string;
  /** Card/surface color drawn on top of the background. */
  surface: string;
  accent: string;
  text: string;
};

/** A styling-only preset a page can be switched between. Stored as `theme.preset`. */
export type TemplateVariant = {
  id: string;
  label: string;
  swatch: TemplateVariantSwatch;
};

/**
 * The stored `TemplatePage.theme` JSON. `preset` is the styling variant and
 * applies to every template; the rest is the bio page's richer theme layer.
 */
export type TemplateThemeValue = {
  preset?: string;
  accentColor?: string;
  buttonStyle?: "rounded" | "pill" | "sharp" | "outline";
  background?: { type: "solid" | "gradient"; color?: string; from?: string; to?: string };
  font?: string;
} | null;

/** Palette used to generate a page's social-share image. */
export type TemplateOgColors = {
  /** CSS `background` value — a solid color or a gradient. */
  background: string;
  text: string;
  muted: string;
  accent: string;
};

/**
 * How a template stores its content.
 * - `blocks` — ordered BioBlock rows (the bio page).
 * - `data`   — a single JSON document in `TemplatePage.templateData`.
 */
export type TemplateContentModel = "blocks" | "data";

/**
 * Everything the platform needs to know about one template. Declared once, in
 * `src/lib/templates/definitions/<id>.ts`; see the README in this folder.
 *
 * This module is imported by both the tRPC services and client components, so
 * it must stay free of React and of anything `server-only`.
 */
export type TemplateDefinition<TData = unknown> = {
  id: TemplateTypeId;
  /** Human label used in menus, badges and filters. */
  label: string;
  /** One-liner shown in the "New template" menu. */
  description: string;
  iconKey: TemplateIconKey;
  contentModel: TemplateContentModel;
  /** Validates `templateData`. Templates using `blocks` declare an empty object. */
  dataSchema: z.ZodType<TData>;
  /** Seeded into `templateData` when a page of this type is created. */
  defaultData: TData;
  variants: readonly TemplateVariant[];
  defaultVariantId: string;
  /** Whether the editor offers accent color / font / button style on top of variants. */
  supportsRichTheme: boolean;
  /** Whether the page renders an avatar (and so offers one in Settings). */
  usesAvatar: boolean;
  /** Fallback display title derived from the content when the user set none. */
  deriveTitle: (data: TData) => string | null;
  /** Palette for the generated OG image, so it matches the live page. */
  resolveOgColors: (theme: TemplateThemeValue) => TemplateOgColors;
};

/** Registry-facing shape: the data payload type varies per template. */
// biome-ignore lint/suspicious/noExplicitAny: the registry is heterogeneous by design.
export type AnyTemplateDefinition = TemplateDefinition<any>;
