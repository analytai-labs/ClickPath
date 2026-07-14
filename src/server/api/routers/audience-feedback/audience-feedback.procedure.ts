import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { resolvePlan } from "@/lib/billing/plans";
import { runBackgroundTask } from "@/lib/utils/background";
import { sendAudienceFeedbackNotification } from "@/server/lib/notifications/discord";

import { adminProcedure, createTRPCRouter, protectedProcedure } from "../../trpc";
import {
  audienceFeedbackAcquisitionChannelValues,
  audienceFeedbackPriorToolValues,
  audienceFeedbackRoleValues,
  submitAudienceFeedbackSchema,
} from "./audience-feedback.input";

const DISMISS_COOLDOWN_DAYS = 7;
const MAX_DISMISS_COUNT = 3;
const DISMISS_COOLDOWN_MS = DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

function shouldAutoPromptAudienceFeedback(params: {
  submittedAt?: Date | null;
  dismissedAt?: Date | null;
  dismissCount: number;
}): boolean {
  if (params.submittedAt) return false;
  if (params.dismissCount >= MAX_DISMISS_COUNT) return false;
  if (!params.dismissedAt) return true;

  return params.dismissedAt.getTime() <= Date.now() - DISMISS_COOLDOWN_MS;
}

export const audienceFeedbackRouter = createTRPCRouter({
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const row = await ctx.prisma.audienceFeedback.findFirst({
      where: { userId: ctx.auth.userId },
      select: {
        submittedAt: true,
        dismissedAt: true,
        dismissCount: true,
        planSnapshot: true,
      },
    });

    if (!row) {
      return {
        hasSubmitted: false,
        shouldAutoPrompt: true,
        submittedAt: null,
        dismissedAt: null,
        dismissCount: 0,
        planSnapshot: null,
      };
    }

    return {
      hasSubmitted: Boolean(row.submittedAt),
      shouldAutoPrompt: shouldAutoPromptAudienceFeedback({
        submittedAt: row.submittedAt,
        dismissedAt: row.dismissedAt,
        dismissCount: row.dismissCount,
      }),
      submittedAt: row.submittedAt,
      dismissedAt: row.dismissedAt,
      dismissCount: row.dismissCount,
      planSnapshot: row.planSnapshot,
    };
  }),

  dismiss: protectedProcedure.mutation(async ({ ctx }) => {
    const existingFeedback = await ctx.prisma.audienceFeedback.findFirst({
      where: { userId: ctx.auth.userId },
      select: { submittedAt: true, dismissedAt: true, id: true },
    });

    if (existingFeedback?.submittedAt) {
      return { success: true, dismissedAt: existingFeedback.dismissedAt };
    }

    const dismissedAt = new Date();

    if (!existingFeedback) {
      await ctx.prisma.audienceFeedback.create({
        data: {
          userId: ctx.auth.userId,
          dismissedAt,
          dismissCount: 1,
        },
      });
      return { success: true, dismissedAt };
    }

    await ctx.prisma.audienceFeedback.update({
      where: { id: existingFeedback.id },
      data: {
        dismissedAt,
        dismissCount: {
          increment: 1,
        },
      },
    });

    return { success: true, dismissedAt };
  }),

  submit: protectedProcedure
    .input(submitAudienceFeedbackSchema)
    .mutation(async ({ ctx, input }) => {
      const userRecord = await ctx.prisma.user.findFirst({
        where: { id: ctx.auth.userId },
        select: { email: true, name: true, subscription: true },
      });
      const planSnapshot = resolvePlan(userRecord?.subscription ?? null);
      const submittedAt = new Date();
      const isPaidPlan = planSnapshot !== "free";
      const upgradeBlocker = isPaidPlan ? null : input.upgradeBlocker || null;

      if (!isPaidPlan && !upgradeBlocker) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Free users must provide an upgrade blocker.",
        });
      }

      const upgradeReason = isPaidPlan ? (input.upgradeReason ?? null) : null;

      if (isPaidPlan && !upgradeReason) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Paid users must provide an upgrade reason.",
        });
      }

      const values = {
        userId: ctx.auth.userId,
        role: input.role,
        useCase: input.useCase,
        monthlyVolume: input.monthlyVolume,
        acquisitionChannel: input.acquisitionChannel,
        acquisitionDetail: input.acquisitionDetail || null,
        priorTool: input.priorTool,
        switchReason: input.switchReason || null,
        magicFeature: input.magicFeature,
        upgradeReason,
        upgradeBlocker,
        improvementWish: input.improvementWish || null,
        planSnapshot,
        submittedAt,
        dismissedAt: null,
        dismissCount: 0,
      };

      const existingFeedback = await ctx.prisma.audienceFeedback.findFirst({
        where: { userId: ctx.auth.userId },
      });

      if (existingFeedback) {
        await ctx.prisma.audienceFeedback.update({
          where: { id: existingFeedback.id },
          data: values,
        });
      } else {
        await ctx.prisma.audienceFeedback.create({
          data: values,
        });
      }

      void runBackgroundTask(
        sendAudienceFeedbackNotification({
          userEmail: userRecord?.email ?? "unknown",
          userName: userRecord?.name,
          planSnapshot,
          role: input.role,
          useCase: input.useCase,
          monthlyVolume: input.monthlyVolume,
          acquisitionChannel: input.acquisitionChannel,
          acquisitionDetail: values.acquisitionDetail,
          priorTool: input.priorTool,
          switchReason: values.switchReason,
          magicFeature: input.magicFeature,
          upgradeReason,
          upgradeBlocker,
          improvementWish: values.improvementWish,
        }),
      );

      return { success: true, submittedAt, planSnapshot };
    }),

  list: adminProcedure
    .input(
      z.object({
        plan: z.enum(["free", "pro", "ultra"]).optional(),
        acquisitionChannel: z.enum(audienceFeedbackAcquisitionChannelValues).optional(),
        priorTool: z.enum(audienceFeedbackPriorToolValues).optional(),
        role: z.enum(audienceFeedbackRoleValues).optional(),
        cursor: z.number().optional(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: any = {
        submittedAt: { not: null },
      };

      if (input.plan) where.planSnapshot = input.plan;
      if (input.acquisitionChannel) {
        where.acquisitionChannel = input.acquisitionChannel;
      }
      if (input.priorTool) where.priorTool = input.priorTool;
      if (input.role) where.role = input.role;

      const items = await ctx.prisma.audienceFeedback.findMany({
        where,
        include: {
          user: { select: { name: true, email: true, image: true } },
        },
        orderBy: { submittedAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      let nextCursor: number | undefined;
      if (items.length > input.limit) {
        const nextItem = items.pop()!;
        nextCursor = nextItem.id;
      }

      return { items, nextCursor };
    }),

  stats: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.audienceFeedback.findMany({
      where: {
        submittedAt: { not: null },
      },
      select: {
        planSnapshot: true,
        acquisitionChannel: true,
        priorTool: true,
        role: true,
        useCase: true,
        magicFeature: true,
      },
    });

    const tally = (key: keyof (typeof rows)[number]) => {
      const counts = new Map<string | null, number>();
      for (const row of rows) {
        const value = row[key] as string | null;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return Array.from(counts, ([value, count]) => ({ value, count })).sort(
        (a, b) => b.count - a.count,
      );
    };

    return {
      total: rows.length,
      byPlan: tally("planSnapshot"),
      byChannel: tally("acquisitionChannel"),
      byPriorTool: tally("priorTool"),
      byRole: tally("role"),
      byUseCase: tally("useCase"),
      byMagicFeature: tally("magicFeature"),
    };
  }),
});
