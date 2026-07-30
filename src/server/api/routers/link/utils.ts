import { prisma } from "@/server/db";
import { TRPCError } from "@trpc/server";

import { DEFAULT_PLATFORM_DOMAIN, isPlatformDomain } from "@/lib/constants/domains";
import { redis } from "@/lib/core/cache";
import { normalizeAlias } from "@/lib/utils";
import { getUserPlanContext, normalizeMonthlyLinkCount } from "@/server/lib/user-plan";

import type { ProtectedTRPCContext, WorkspaceTRPCContext } from "../../trpc";

export async function verifyLinkOwnership(ctx: WorkspaceTRPCContext, linkId: number) {
  const linkRecord = await prisma.link.findFirst({
    where: {
      id: linkId,
      ...(ctx.workspace.type === "team"
        ? { teamId: ctx.workspace.teamId }
        : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (!linkRecord) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Link not found or you don't have access to it",
    });
  }

  return linkRecord;
}

export async function checkAndUpdateLinkLimit(ctx: ProtectedTRPCContext) {
  // `getUserPlanContext` needs prisma, assume we pass prisma
  const planCtx = await getUserPlanContext(ctx.auth.userId, prisma as any);

  if (!planCtx) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "User not found",
    });
  }

  const { plan, caps } = planCtx;
  const currentCount = await normalizeMonthlyLinkCount(planCtx, prisma as any);
  const limit = caps.linksLimit;

  if (limit !== undefined && currentCount >= limit) {
    const limitText = limit.toLocaleString();
    const linkLimitMessage =
      plan === "free"
        ? `You've reached your monthly limit of ${limitText} links. Upgrade to Pro for more.`
        : `You've reached your monthly limit of ${limitText} links. Upgrade to Ultra for unlimited links.`;

    throw new TRPCError({
      code: "FORBIDDEN",
      message: linkLimitMessage,
    });
  }

  return {
    plan,
    currentCount,
    limit,
    isProUser: plan !== "free",
  };
}

/**
 * Workspace-aware link limit check.
 * Team workspaces bypass limits (they're Ultra with unlimited links).
 * Personal workspaces check against the user's plan limits.
 */
export async function checkWorkspaceLinkLimit(ctx: WorkspaceTRPCContext) {
  // Team workspaces have unlimited links (Ultra plan)
  if (ctx.workspace.type === "team") {
    return {
      plan: "ultra" as const,
      currentCount: 0,
      limit: undefined,
      isProUser: true,
    };
  }

  // Personal workspace: check user's plan limits
  return checkAndUpdateLinkLimit(ctx);
}

export async function incrementLinkCount(
  ctx: ProtectedTRPCContext,
  currentCount: number,
  limit?: number,
) {
  if (limit === undefined) {
    return;
  }

  await prisma.user.update({
    where: { id: ctx.auth.userId },
    data: {
      monthlyLinkCount: currentCount + 1,
    },
  });
}

/**
 * Workspace-aware link count increment.
 * Only increments for personal workspaces since team workspaces have no limits.
 */
export async function incrementWorkspaceLinkCount(
  ctx: WorkspaceTRPCContext,
  currentCount: number,
  limit?: number,
) {
  // Don't track usage for team workspaces
  if (ctx.workspace.type === "team") {
    return;
  }

  return incrementLinkCount(ctx, currentCount, limit);
}

export async function getUserDefaultDomain(ctx: ProtectedTRPCContext): Promise<string> {
  const cacheKey = `user_settings_domain:${ctx.auth.userId}`;
  const cachedDomain = await redis.get(cacheKey);

  if (cachedDomain) {
    return cachedDomain ?? DEFAULT_PLATFORM_DOMAIN;
  }

  const userInfo = await prisma.user.findFirst({
    where: { id: ctx.auth.userId },
    include: {
      siteSettings: true,
    },
  });

  const defaultDomain = userInfo?.siteSettings?.defaultDomain ?? DEFAULT_PLATFORM_DOMAIN;
  await redis.set(cacheKey, defaultDomain, "EX", 300); // 5 minutes

  return defaultDomain;
}

/**
 * Workspace-aware default domain lookup.
 * For team workspaces: uses team's default domain
 * For personal workspaces: uses user's site settings
 */
export async function getWorkspaceDefaultDomain(ctx: WorkspaceTRPCContext): Promise<string> {
  if (ctx.workspace.type === "team") {
    const cacheKey = `team_default_domain:${ctx.workspace.teamId}`;
    const cachedDomain = await redis.get(cacheKey);

    if (cachedDomain) {
      return cachedDomain;
    }

    // Get team's default domain from the team record
    const teamRecord = await prisma.team.findFirst({
      where: { id: ctx.workspace.teamId },
    });

    const defaultDomain = teamRecord?.defaultDomain ?? DEFAULT_PLATFORM_DOMAIN;
    await redis.set(cacheKey, defaultDomain, "EX", 300); // 5 minutes

    return defaultDomain;
  }

  // Personal workspace: use user's default domain
  return getUserDefaultDomain(ctx);
}

/**
 * Guards against clients submitting arbitrary `domain` values on link/QR
 * writes. Accepts platform-owned domains, or custom domains that are both
 * verified ("active") and scoped to the caller's workspace. Throws on
 * anything else — DNS is case-insensitive, so we normalize before lookup.
 */
export async function assertDomainAllowed(
  ctx: WorkspaceTRPCContext,
  domain: string,
): Promise<void> {
  const normalized = domain.trim().toLowerCase();
  if (isPlatformDomain(normalized)) return;

  const owned = await prisma.customDomain.findFirst({
    where: {
      domain: normalized,
      status: "active",
      ...(ctx.workspace.type === "team"
        ? { teamId: ctx.workspace.teamId }
        : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (!owned) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Selected domain is not available for this workspace.",
    });
  }
}

/**
 * The domain a new link or page should get when the caller didn't pick one.
 *
 * This is the workspace's configured default, but only if it is still usable: a
 * default that was later unverified or deleted must not make every new link fail,
 * so it degrades to the platform domain instead of throwing.
 */
export async function resolveDefaultDomain(ctx: WorkspaceTRPCContext): Promise<string> {
  const preferred = (await getWorkspaceDefaultDomain(ctx)).trim();
  if (!preferred) return DEFAULT_PLATFORM_DOMAIN;

  try {
    await assertDomainAllowed(ctx, preferred);
    return preferred;
  } catch {
    return DEFAULT_PLATFORM_DOMAIN;
  }
}

const MINIMUM_ALIAS_LENGTH_FREE = 6;

export const validateAlias = (
  ctx: ProtectedTRPCContext,
  alias: string,
  domain: string,
  isPaidUser = false,
): Promise<void> => {
  const aliasRegex = /^[a-zA-Z0-9-_]+$/;

  if (!aliasRegex.test(alias)) {
    throw new Error("Alias can only contain alphanumeric characters, dashes, and underscores");
  }

  if (alias.includes(".")) {
    throw new Error("Cannot include periods in alias");
  }

  // Free users must have aliases with at least 6 characters
  if (!isPaidUser && alias.length < MINIMUM_ALIAS_LENGTH_FREE) {
    throw new Error(
      `Custom aliases must be at least ${MINIMUM_ALIAS_LENGTH_FREE} characters on the free plan. Upgrade to Pro for shorter aliases.`,
    );
  }

  return checkAliasAvailability(ctx, alias, domain);
};

export const checkAliasAvailability = async (
  ctx: ProtectedTRPCContext,
  alias: string,
  domain: string,
): Promise<void> => {
  const normalizedAlias = normalizeAlias(alias);

  // Note: This matches the lowercase check from drizzle
  // Prisma case-insensitive search can be done or we assume alias is normalized
  const aliasExists = await prisma.link.findFirst({
    where: {
      alias: {
        equals: normalizedAlias,
        mode: "insensitive",
      },
      domain: domain,
    },
  });

  if (aliasExists) {
    throw new Error("Alias already exists");
  }
};
