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

  update: workspaceProcedure
    .input(inputs.updateTemplatePageSchema)
    .mutation(({ ctx, input }) => services.updateTemplatePage(ctx, input)),

  updatePharmaProduct: workspaceProcedure
    .input(inputs.updatePharmaProductSchema)
    .mutation(({ ctx, input }) => services.updatePharmaProduct(ctx, input)),

  togglePublished: workspaceProcedure
    .input(inputs.togglePublishedSchema)
    .mutation(({ ctx, input }) => services.togglePublished(ctx, input)),

  delete: workspaceProcedure
    .input(inputs.templatePageIdSchema)
    .mutation(({ ctx, input }) => services.deleteTemplatePage(ctx, input.id)),

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
    .input(inputs.getBioPageAnalyticsSchema)
    .query(({ ctx, input }) => services.getBioPageAnalytics(ctx, input)),

  // Public — used by the /p/[slug] render route and custom-domain root.
  getBySlug: publicProcedure
    .input(inputs.getPublicBioPageSchema)
    .query(({ ctx, input }) => services.getPublicBioPageBySlug(ctx, input.slug)),

  getByDomain: publicProcedure
    .input(inputs.getPublicBioPageByDomainSchema)
    .query(({ ctx, input }) => services.getPublicBioPageByDomain(ctx, input.domain)),
});
