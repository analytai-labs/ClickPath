import { TRPCError } from "@trpc/server";

import { DEFAULT_PLATFORM_DOMAIN, isPlatformDomain } from "@/lib/constants/domains";
import { redis } from "@/lib/core/cache";
import { hasPermission, requirePermission } from "@/server/lib/workspace";

import { workspaceDomainScope } from "../link/utils";

import type { WorkspaceTRPCContext } from "../../trpc";
import type { UpdateSiteSettingsInput } from "./settings.input";

async function getOrCreatePersonalSettings(ctx: WorkspaceTRPCContext) {
  const settings = await ctx.prisma.siteSettings.findFirst({
    where: { userId: ctx.auth.userId },
  });
  if (settings) return settings;

  return ctx.prisma.siteSettings.create({
    data: {
      userId: ctx.auth.userId,
      defaultDomain: DEFAULT_PLATFORM_DOMAIN,
    },
  });
}

/**
 * Settings for the current workspace. In a team workspace the default domain is
 * the team's (falling back to the platform domain, never the member's personal
 * default); `canEditDefaultDomain` tells the form whether this member may change it.
 */
export async function getSiteSettings(ctx: WorkspaceTRPCContext) {
  const settings = await getOrCreatePersonalSettings(ctx);

  if (ctx.workspace.type === "team") {
    const team = await ctx.prisma.team.findFirst({
      where: { id: ctx.workspace.teamId },
      select: { defaultDomain: true },
    });
    return {
      ...settings,
      defaultDomain: team?.defaultDomain || DEFAULT_PLATFORM_DOMAIN,
      defaultDomainScope: "team" as const,
      canEditDefaultDomain: hasPermission(ctx.workspace, "team.settings"),
    };
  }

  return {
    ...settings,
    defaultDomainScope: "personal" as const,
    canEditDefaultDomain: true,
  };
}

/**
 * Change the default domain of the current workspace. In a team workspace that
 * is the team's default and needs `team.settings`; members without it change
 * their personal default from their personal workspace instead.
 */
export async function updateSiteSettings(
  ctx: WorkspaceTRPCContext,
  input: UpdateSiteSettingsInput,
) {
  const chosenDomain = input.defaultDomain.trim().toLowerCase();

  if (ctx.workspace.type === "team") {
    requirePermission(ctx.workspace, "team.settings", "change the team's default domain");
  }

  if (!isPlatformDomain(chosenDomain)) {
    const domain = await ctx.prisma.customDomain.findFirst({
      where: {
        domain: chosenDomain,
        status: "active",
        ...workspaceDomainScope(ctx.workspace),
      },
    });

    if (!domain) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only verified domains of this workspace can be set as the default.",
      });
    }
  }

  if (ctx.workspace.type === "team") {
    await ctx.prisma.team.update({
      where: { id: ctx.workspace.teamId },
      data: { defaultDomain: chosenDomain },
    });
    await redis.del(`team_default_domain:${ctx.workspace.teamId}`);
    return getSiteSettings(ctx);
  }

  const existingSettings = await ctx.prisma.siteSettings.findFirst({
    where: { userId: ctx.auth.userId },
  });

  if (existingSettings) {
    await ctx.prisma.siteSettings.updateMany({
      where: { userId: ctx.auth.userId },
      data: { defaultDomain: chosenDomain },
    });
  } else {
    await ctx.prisma.siteSettings.create({
      data: {
        userId: ctx.auth.userId,
        defaultDomain: chosenDomain,
      },
    });
  }

  // Invalidate after the write, and for every value — clearing only when the new
  // domain was custom left the old one cached for 5 minutes when switching back
  // to the platform domain, and clearing before the write let a concurrent read
  // re-populate the cache with the stale value.
  await redis.del(`user_settings_domain:${ctx.auth.userId}`);

  return getSiteSettings(ctx);
}
