import { getPlanCaps, resolvePlan } from "@/lib/billing/plans";
import { prisma } from "@/server/db";
import {
  getUserPlanContext,
  normalizeMonthlyEventCount,
  normalizeMonthlyLinkCount,
} from "@/server/lib/user-plan";

import { createTRPCRouter, workspaceProcedure } from "../../trpc";

export const subscriptionsRouter = createTRPCRouter({
  // Use workspaceProcedure to be workspace-aware
  // Team workspaces always have Ultra features
  get: workspaceProcedure.query(async ({ ctx }) => {
    const userId = ctx.auth.userId;

    const userRecord = await prisma.user.findFirst({
      where: { id: userId },
      include: {
        subscription: true,
      },
    });

    if (!userRecord) {
      throw new Error("User not found");
    }

    // If in a team workspace, always use Ultra plan
    // Team workspaces inherit Ultra features from the team owner
    const isTeamWorkspace = ctx.workspace.type === "team";
    const planCtx = await getUserPlanContext(userId, prisma);

    // Personal plan is needed for features like team creation
    const personalPlan = planCtx?.plan ?? resolvePlan(userRecord.subscription ?? null);

    // Effective plan considers workspace context
    const plan = isTeamWorkspace ? "ultra" : personalPlan;
    const caps = getPlanCaps(plan);

    // For team workspaces, don't show personal usage counts - they're not relevant
    // Team workspaces have unlimited resources (Ultra plan)
    let monthlyLinkCount = 0;
    let monthlyEventCount = 0;
    let folderCount = 0;

    if (!isTeamWorkspace && planCtx) {
      // Personal workspace: get user's personal usage
      // Filter out team folders from personal counts
      const [linkCount, eventCount, folderCountResult] = await Promise.all([
        normalizeMonthlyLinkCount(planCtx, prisma),
        normalizeMonthlyEventCount(planCtx, prisma),
        prisma.folder.count({
          where: {
            userId: userId,
            teamId: null,
          }
        }),
      ]);

      monthlyLinkCount = linkCount;
      monthlyEventCount = eventCount;
      folderCount = folderCountResult;
    } else if (isTeamWorkspace) {
      // Team workspace: get workspace folder count (for display purposes)
      const folderCountResult = await prisma.folder.count({
        where: {
          teamId: ctx.workspace.teamId,
        }
      });

      folderCount = folderCountResult;
    }

    // For team workspaces, create an effective subscription that reflects Ultra status
    // This ensures UI components that check subscriptions.status and subscriptions.plan work correctly
    // Guard against null subscriptions when spreading
    const effectiveSubscriptions = isTeamWorkspace
      ? {
          ...(userRecord.subscription ?? {}),
          status: "active",
          plan: "ultra" as const,
        }
      : userRecord.subscription;

    return {
      subscriptions: effectiveSubscriptions,
      plan,
      caps,
      usage: {
        links: {
          count: monthlyLinkCount,
          // Team workspaces have no limits (null means unlimited)
          limit: isTeamWorkspace ? null : (caps.linksLimit ?? null),
        },
        events: {
          count: monthlyEventCount,
          limit: isTeamWorkspace ? null : (caps.eventsLimit ?? null),
        },
        folders: {
          count: folderCount,
          limit: isTeamWorkspace ? null : (caps.folderLimit ?? null),
        },
      },
      monthlyLinkCount,
      // Include workspace type for UI components that need to know
      isTeamWorkspace,
      // Whether the user can create teams (based on personal subscription, not workspace)
      canCreateTeam: personalPlan === "ultra",
    };
  }),
});
