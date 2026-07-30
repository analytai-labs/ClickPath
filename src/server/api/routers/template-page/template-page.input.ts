import { z } from "zod";

import { templateQrDesignSchema } from "@/lib/templates/qr-design";
import { TEMPLATE_TYPE_IDS } from "@/lib/templates/registry";

export const bioBlockTypeSchema = z.enum(["link", "heading", "text", "social", "divider", "email"]);

/**
 * Page theme. `preset` is the template's styling variant id and applies to every
 * template; the remaining fields are the bio page's richer theme layer and are
 * only honoured by templates whose definition sets `supportsRichTheme`.
 */
export const templateThemeSchema = z.object({
  preset: z.string().max(50).optional(),
  accentColor: z
    .string()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid color")
    .optional(),
  buttonStyle: z.enum(["rounded", "pill", "sharp", "outline"]).optional(),
  background: z
    .object({
      type: z.enum(["solid", "gradient"]),
      color: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .optional(),
  font: z.string().max(50).optional(),
});

export const bioSocialLinkSchema = z.object({
  platform: z.string().min(1).max(50),
  url: z.string().trim().min(1).max(2048),
});

export const templateSlugSchema = z
  .string()
  .min(3, "Handle must be at least 3 characters")
  .max(100)
  .regex(/^[a-z0-9_-]+$/, "Use lowercase letters, numbers, dashes, and underscores only");

export const templateTypeSchema = z.enum(TEMPLATE_TYPE_IDS);

export const createTemplatePageSchema = z.object({
  slug: templateSlugSchema,
  title: z.string().max(255).optional(),
  description: z.string().max(1000).optional(),
  templateType: templateTypeSchema.default("bio"),
});

/** Page-level settings, shared by every template. */
export const updateTemplatePageSchema = z.object({
  id: z.number(),
  slug: templateSlugSchema.optional(),
  title: z.string().max(255).nullish(),
  description: z.string().max(1000).nullish(),
  avatarUrl: z.string().nullish(),
  theme: templateThemeSchema.nullish(),
  socialImageUrl: z.string().nullish(),
  seoTitle: z.string().max(255).nullish(),
  seoDescription: z.string().max(500).nullish(),
  /** Verified workspace domain the public URL is built from. Null = platform domain. */
  shareDomain: z.string().max(255).nullish(),
  /** Optional root binding on the same domain. Null = only /p/<slug>. */
  customDomain: z.string().max(255).nullish(),
  removeBranding: z.boolean().optional(),
});

export const updateQrDesignSchema = z.object({
  id: z.number(),
  qrDesign: templateQrDesignSchema,
});

/**
 * Content for templates whose content model is `data`. The payload is validated
 * against the zod schema of the page's own template, resolved server-side from
 * the stored `templateType` — the client cannot pick which schema applies.
 */
export const updateTemplateDataSchema = z.object({
  id: z.number(),
  data: z.unknown(),
  theme: templateThemeSchema.nullish(),
});

export const templatePageIdSchema = z.object({ id: z.number() });

export const togglePublishedSchema = z.object({
  id: z.number(),
  isPublished: z.boolean(),
});

export const publicSlugSchema = z.object({ slug: z.string() });
export const publicDomainSchema = z.object({ domain: z.string() });

/** A page requested from a specific host, which must be authorized to serve it. */
export const publicSlugForHostSchema = z.object({
  slug: z.string(),
  host: z.string().max(255),
});

export const templatePageAnalyticsSchema = z.object({
  id: z.number(),
  range: z.enum(["7d", "30d", "90d", "all"]).default("7d"),
});

const blockFieldsSchema = {
  title: z.string().max(255).nullish(),
  content: z.string().max(5000).nullish(),
  url: z.string().max(2048).nullish(),
  socials: z.array(bioSocialLinkSchema).max(20).optional(),
  scheduledAt: z.date().nullish(),
  scheduledUntil: z.date().nullish(),
};

export const addBioBlockSchema = z.object({
  templatePageId: z.number(),
  type: bioBlockTypeSchema,
  ...blockFieldsSchema,
});

export const updateBioBlockSchema = z.object({
  id: z.number(),
  isVisible: z.boolean().optional(),
  ...blockFieldsSchema,
});

export const blockIdSchema = z.object({ id: z.number() });

export const reorderBlocksSchema = z.object({
  templatePageId: z.number(),
  blockIds: z.array(z.number()),
});

export type CreateTemplatePageInput = z.infer<typeof createTemplatePageSchema>;
export type UpdateTemplatePageInput = z.infer<typeof updateTemplatePageSchema>;
export type UpdateTemplateDataInput = z.infer<typeof updateTemplateDataSchema>;
export type UpdateQrDesignInput = z.infer<typeof updateQrDesignSchema>;
export type AddBioBlockInput = z.infer<typeof addBioBlockSchema>;
export type UpdateBioBlockInput = z.infer<typeof updateBioBlockSchema>;
export type ReorderBlocksInput = z.infer<typeof reorderBlocksSchema>;
export type TemplateThemeInput = z.infer<typeof templateThemeSchema>;
