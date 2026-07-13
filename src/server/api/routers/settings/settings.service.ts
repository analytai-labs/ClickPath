import { DEFAULT_PLATFORM_DOMAIN, isPlatformDomain } from "@/lib/constants/domains";
import { redis } from "@/lib/core/cache";

import type { ProtectedTRPCContext } from "../../trpc";
import type { UpdateSiteSettingsInput } from "./settings.input";

export async function getSiteSettings(ctx: ProtectedTRPCContext) {
  const settings = await ctx.prisma.siteSettings.findFirst({
    where: { userId: ctx.auth.userId },
  });

  // If no settings exist, create default settings
  if (!settings) {
    const newSettings = await ctx.prisma.siteSettings.create({
      data: {
        userId: ctx.auth.userId,
        defaultDomain: DEFAULT_PLATFORM_DOMAIN,
      }
    });

    return newSettings;
  }

  return settings;
}

export async function updateSiteSettings(
  ctx: ProtectedTRPCContext,
  input: UpdateSiteSettingsInput,
) {
  const existingSettings = await ctx.prisma.siteSettings.findFirst({
    where: { userId: ctx.auth.userId },
  });

  if (!isPlatformDomain(input.defaultDomain)) {
    const domain = await ctx.prisma.customDomain.findFirst({
      where: {
        userId: ctx.auth.userId,
        domain: input.defaultDomain,
        status: "active",
      }
    });

    if (!domain) {
      throw new Error("You can only set verified custom domains as your default domain");
    }

    await redis.del(`user_settings_domain:${ctx.auth.userId}`);
  }

  if (existingSettings) {
    await ctx.prisma.siteSettings.updateMany({
      where: { userId: ctx.auth.userId },
      data: input,
    });
  } else {
    await ctx.prisma.siteSettings.create({
      data: {
        userId: ctx.auth.userId,
        ...input,
      }
    });
  }

  return getSiteSettings(ctx);
}
