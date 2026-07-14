import type { PrismaClient, Subscription, User } from "@prisma/client";

import { type Plan, getPlanCaps, resolvePlan } from "@/lib/billing/plans";
import { prisma } from "@/server/db";

import type { PLAN_CAPS } from "@/lib/billing/plans";

type DbClient = PrismaClient;

/**
 * Hot-path paid-plan check used by the redirect pipeline. Avoids the full
 * UserPlanContext query — we only need a boolean. Team-owned links
 * short-circuit without a DB hit since teams are always on Ultra.
 */
export async function isOwnerOnPaidPlan(
  userId: string,
  teamId: number | null,
  dbClient: DbClient = prisma,
): Promise<boolean> {
  if (teamId !== null) return true;

  const sub = await dbClient.subscription.findFirst({
    where: { userId },
  });

  return resolvePlan(sub ?? null) !== "free";
}

export type UserPlanContext = {
  userRecord: User;
  subscription: Subscription | null;
  plan: Plan;
  caps: (typeof PLAN_CAPS)[Plan];
};

const getMonthStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

export async function getUserPlanContext(
  userId: string,
  dbClient: DbClient = prisma,
): Promise<UserPlanContext | null> {
  const userRecord = await dbClient.user.findFirst({
    where: { id: userId },
    include: {
      subscription: true,
    },
  });

  if (!userRecord) return null;

  const subscription = userRecord.subscription ?? null;
  const plan = resolvePlan(subscription);

  return {
    userRecord,
    subscription,
    plan,
    caps: getPlanCaps(plan),
  };
}

export async function normalizeMonthlyEventCount(
  ctx: UserPlanContext,
  dbClient: DbClient = prisma,
): Promise<number> {
  const monthStart = getMonthStart();
  const lastReset = ctx.userRecord.lastEventCountReset ?? ctx.userRecord.createdAt ?? new Date();

  if (lastReset < monthStart) {
    await dbClient.user.update({
      where: { id: ctx.userRecord.id },
      data: {
        monthlyEventCount: 0,
        lastEventCountReset: new Date(),
        eventUsageAlertLevel: 0,
      },
    });

    return 0;
  }

  return ctx.userRecord.monthlyEventCount ?? 0;
}

export async function normalizeMonthlyLinkCount(
  ctx: UserPlanContext,
  dbClient: DbClient = prisma,
): Promise<number> {
  const monthStart = getMonthStart();
  const lastReset = ctx.userRecord.lastLinkCountReset ?? ctx.userRecord.createdAt ?? new Date();

  if (lastReset < monthStart) {
    await dbClient.user.update({
      where: { id: ctx.userRecord.id },
      data: {
        monthlyLinkCount: 0,
        lastLinkCountReset: new Date(),
      },
    });

    return 0;
  }

  return ctx.userRecord.monthlyLinkCount ?? 0;
}
