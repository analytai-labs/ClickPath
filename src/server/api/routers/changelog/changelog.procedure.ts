import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../../trpc";
import {
  getChangelogEntries,
  getChangelogEntriesSince,
  getLatestChangelog,
} from "@/lib/changelog";

export const changelogRouter = createTRPCRouter({
  list: publicProcedure.query(async () => {
    return getChangelogEntries();
  }),

  getLatest: publicProcedure.query(async () => {
    return getLatestChangelog();
  }),

  getNewEntries: protectedProcedure.query(async ({ ctx }) => {
    const userData = await ctx.prisma.user.findFirst({
      where: { id: ctx.auth.userId },
      select: {
        lastViewedChangelogSlug: true,
      },
    });

    return getChangelogEntriesSince(userData?.lastViewedChangelogSlug ?? null);
  }),

  getUnseenCount: protectedProcedure.query(async ({ ctx }) => {
    const userData = await ctx.prisma.user.findFirst({
      where: { id: ctx.auth.userId },
      select: {
        lastViewedChangelogSlug: true,
      },
    });

    const newEntries = await getChangelogEntriesSince(
      userData?.lastViewedChangelogSlug ?? null
    );

    return newEntries.length;
  }),

  markAsViewed: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.user.update({
        where: { id: ctx.auth.userId },
        data: { lastViewedChangelogSlug: input.slug },
      });

      return { success: true };
    }),
});
