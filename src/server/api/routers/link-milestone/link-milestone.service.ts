import { TRPCError } from "@trpc/server";
import { canUseMilestones, getMilestonesPerLinkLimit } from "@/lib/billing/plans";

import { checkWorkspaceLinkLimit, verifyLinkOwnership } from "../link/utils";

import type { WorkspaceTRPCContext } from "../../trpc";
import type {
  GetLinkMilestonesInput,
  ResetMilestoneNotificationsInput,
  UpsertMilestonesInput,
} from "./link-milestone.input";

export async function upsertMilestones(
  ctx: WorkspaceTRPCContext,
  input: UpsertMilestonesInput,
) {
  await verifyLinkOwnership(ctx, input.linkId);

  const { plan } = await checkWorkspaceLinkLimit(ctx);

  if (!canUseMilestones(plan)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        plan === "free"
          ? "Click milestone notifications are available on the Pro plan and above. Upgrade to get notified when your links hit click targets."
          : "Click milestone notifications are not available on your current plan.",
    });
  }

  const limit = getMilestonesPerLinkLimit(plan);
  if (limit !== undefined && input.thresholds.length > limit) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You can set up to ${limit} milestones per link on the ${plan.toUpperCase()} plan. Upgrade for more.`,
    });
  }

  // Replace-all approach: delete existing milestones and re-insert.
  // Preserve notifiedAt for thresholds that haven't changed.
  // Wrapped in a transaction so a failure mid-way doesn't lose data.
  const existing = await ctx.prisma.linkMilestone.findMany({
    where: { linkId: input.linkId },
    select: {
      threshold: true,
      notifiedAt: true,
    },
  });

  const existingMap = new Map(
    existing.map((m) => [m.threshold, m.notifiedAt]),
  );

  await ctx.prisma.$transaction(async (tx) => {
    await tx.linkMilestone.deleteMany({
      where: { linkId: input.linkId },
    });

    if (input.thresholds.length > 0) {
      await tx.linkMilestone.createMany({
        data: input.thresholds.map((threshold) => ({
          linkId: input.linkId,
          userId: ctx.workspace.userId,
          threshold,
          notifiedAt: existingMap.get(threshold) ?? null,
        })),
      });
    }
  });

  return { success: true };
}

export async function getLinkMilestones(
  ctx: WorkspaceTRPCContext,
  input: GetLinkMilestonesInput,
) {
  await verifyLinkOwnership(ctx, input.linkId);

  return ctx.prisma.linkMilestone.findMany({
    where: { linkId: input.linkId },
    select: {
      id: true,
      threshold: true,
      notifiedAt: true,
      createdAt: true,
    },
    orderBy: { threshold: "asc" },
  });
}

export async function resetMilestoneNotifications(
  ctx: WorkspaceTRPCContext,
  input: ResetMilestoneNotificationsInput,
) {
  await verifyLinkOwnership(ctx, input.linkId);

  await ctx.prisma.linkMilestone.updateMany({
    where: { linkId: input.linkId },
    data: { notifiedAt: null },
  });

  return { success: true };
}
