import { z } from "zod";

export const bioBlockTypeSchema = z.enum(["link", "heading", "text", "social", "divider", "email"]);

export const bioThemeSchema = z.object({
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

export const bioSlugSchema = z
  .string()
  .min(3, "Handle must be at least 3 characters")
  .max(100)
  .regex(/^[a-z0-9_-]+$/, "Use lowercase letters, numbers, dashes, and underscores only");

export const templateTypeSchema = z.enum(["bio", "pharma_product"]);

export const pharmaProductDataSchema = z.object({
  productName: z.string().max(255).default(""),
  composition: z.string().max(500).default(""),
  productOverview: z.string().max(2000).default(""),
  marketed: z.object({
    name: z.string().max(255).default(""),
    address: z.string().max(500).default(""),
  }),
  manufactured: z.object({
    name: z.string().max(255).default(""),
    address: z.string().max(500).default(""),
  }),
  productImages: z.array(z.string().max(5_000_000)).max(10).default([]),
  documents: z
    .array(z.object({ imageUrl: z.string().max(5_000_000), name: z.string().max(255) }))
    .max(20)
    .default([]),
  contact: z.object({
    name: z.string().max(255).default(""),
    whatsapp: z.string().max(50).default(""),
    email: z.string().max(255).default(""),
  }),
});

export const createTemplatePageSchema = z.object({
  slug: bioSlugSchema,
  title: z.string().max(255).optional(),
  description: z.string().max(1000).optional(),
  templateType: templateTypeSchema.optional(),
});

export const createBioPageSchema = createTemplatePageSchema;

export const updateTemplatePageSchema = z.object({
  id: z.number(),
  slug: bioSlugSchema.optional(),
  title: z.string().max(255).nullish(),
  description: z.string().max(1000).nullish(),
  avatarUrl: z.string().nullish(),
  theme: bioThemeSchema.nullish(),
  socialImageUrl: z.string().nullish(),
  seoTitle: z.string().max(255).nullish(),
  seoDescription: z.string().max(500).nullish(),
  customDomain: z.string().max(255).nullish(),
  removeBranding: z.boolean().optional(),
});

export const updateBioPageSchema = updateTemplatePageSchema;

export const updatePharmaProductSchema = z.object({
  id: z.number(),
  data: pharmaProductDataSchema,
  theme: bioThemeSchema.nullish(),
  seoTitle: z.string().max(255).nullish(),
  seoDescription: z.string().max(500).nullish(),
  socialImageUrl: z.string().nullish(),
  customDomain: z.string().max(255).nullish(),
  removeBranding: z.boolean().optional(),
});

export const templatePageIdSchema = z.object({ id: z.number() });
export const bioPageIdSchema = templatePageIdSchema;

export const togglePublishedSchema = z.object({
  id: z.number(),
  isPublished: z.boolean(),
});

export const getPublicBioPageSchema = z.object({ slug: z.string() });
export const getPublicBioPageByDomainSchema = z.object({ domain: z.string() });

export const getBioPageAnalyticsSchema = z.object({
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
  bioPageId: z.number(),
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
  bioPageId: z.number(),
  blockIds: z.array(z.number()),
});

export type CreateTemplatePageInput = z.infer<typeof createTemplatePageSchema>;
export type CreateBioPageInput = CreateTemplatePageInput;
export type UpdateTemplatePageInput = z.infer<typeof updateTemplatePageSchema>;
export type UpdateBioPageInput = UpdateTemplatePageInput;
export type UpdatePharmaProductInput = z.infer<typeof updatePharmaProductSchema>;
export type AddBioBlockInput = z.infer<typeof addBioBlockSchema>;
export type UpdateBioBlockInput = z.infer<typeof updateBioBlockSchema>;
export type ReorderBlocksInput = z.infer<typeof reorderBlocksSchema>;
export type BioThemeInput = z.infer<typeof bioThemeSchema>;
