import { createTRPCRouter, publicProcedure, workspaceProcedure } from "../../trpc";

import * as inputs from "./template-page.input";
import * as services from "./template-page.service";

export const templatePageRouter = createTRPCRouter({
  list: workspaceProcedure.query(({ ctx }) => services.listTemplatePages(ctx)),

  get: workspaceProcedure
    .input(inputs.templatePageIdSchema)
    .query(({ ctx, input }) => services.getTemplatePage(ctx, input.id)),

  create: workspaceProcedure
    .input(inputs.createTemplatePageSchema)
    .mutation(({ ctx, input }) => services.createTemplatePage(ctx, input)),

  /** Page-level settings — handle, SEO, domain, branding. Every template. */
  update: workspaceProcedure
    .input(inputs.updateTemplatePageSchema)
    .mutation(({ ctx, input }) => services.updateTemplatePage(ctx, input)),

  /** Content for templates whose content model is `data`, validated per template. */
  updateTemplateData: workspaceProcedure
    .input(inputs.updateTemplateDataSchema)
    .mutation(({ ctx, input }) => services.updateTemplateData(ctx, input)),

  /** The page's QR design — applies to every template. */
  updateQrDesign: workspaceProcedure
    .input(inputs.updateQrDesignSchema)
    .mutation(({ ctx, input }) => services.updateQrDesign(ctx, input)),

  togglePublished: workspaceProcedure
    .input(inputs.togglePublishedSchema)
    .mutation(({ ctx, input }) => services.togglePublished(ctx, input)),

  delete: workspaceProcedure
    .input(inputs.templatePageIdSchema)
    .mutation(({ ctx, input }) => services.deleteTemplatePage(ctx, input.id)),

  // Blocks — templates whose content model is `blocks` (the bio page).
  addBlock: workspaceProcedure
    .input(inputs.addBioBlockSchema)
    .mutation(({ ctx, input }) => services.addBlock(ctx, input)),

  updateBlock: workspaceProcedure
    .input(inputs.updateBioBlockSchema)
    .mutation(({ ctx, input }) => services.updateBlock(ctx, input)),

  deleteBlock: workspaceProcedure
    .input(inputs.blockIdSchema)
    .mutation(({ ctx, input }) => services.deleteBlock(ctx, input.id)),

  reorderBlocks: workspaceProcedure
    .input(inputs.reorderBlocksSchema)
    .mutation(({ ctx, input }) => services.reorderBlocks(ctx, input)),

  getAnalytics: workspaceProcedure
    .input(inputs.templatePageAnalyticsSchema)
    .query(({ ctx, input }) => services.getTemplatePageAnalytics(ctx, input)),

  // Public — used by the /p/[slug] render route and custom-domain root.
  getBySlug: publicProcedure
    .input(inputs.publicSlugSchema)
    .query(({ ctx, input }) => services.getPublicTemplatePageBySlug(ctx, input.slug)),

  getByDomain: publicProcedure
    .input(inputs.publicDomainSchema)
    .query(({ ctx, input }) => services.getPublicTemplatePageByDomain(ctx, input.domain)),

  /** /p/<slug> requested from a customer domain — the host must be authorized. */
  getBySlugForHost: publicProcedure
    .input(inputs.publicSlugForHostSchema)
    .query(({ ctx, input }) =>
      services.getPublicTemplatePageBySlugForHost(ctx, input.slug, input.host),
    ),
});
