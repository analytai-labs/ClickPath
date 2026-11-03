import { createTRPCRouter, workspaceProcedure } from "../../trpc";

import * as inputs from "./settings.input";
import * as services from "./settings.service";

export const siteSettingsRouter = createTRPCRouter({
  get: workspaceProcedure.query(({ ctx }) => {
    return services.getSiteSettings(ctx);
  }),

  update: workspaceProcedure.input(inputs.updateSiteSettingsSchema).mutation(({ ctx, input }) => {
    return services.updateSiteSettings(ctx, input);
  }),
});
