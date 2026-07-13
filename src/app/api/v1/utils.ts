import crypto from "node:crypto";

import { DEFAULT_PLATFORM_DOMAIN } from "@/lib/constants/domains";
import { prisma } from "@/server/db";

export async function validateAndGetToken(apiKey: string | null) {
  if (!apiKey) return null;
  const hash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const existingToken = await prisma.token.findFirst({ where: { token: hash } });

  if (!existingToken) return null;

  const userId = existingToken.userId;

  // Run ban check and subscription lookup in parallel
  const [userRecord, userSubscription] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { banned: true },
    }),
    prisma.subscription.findFirst({ where: { userId } }),
  ]);

  if (userRecord?.banned) {
    return null;
  }

  return { ...existingToken, subscription: userSubscription };
}

function normalizeApiDomain(domain: string | null | undefined) {
  const normalized = domain?.trim().replace(/\.$/, "").toLowerCase();
  return normalized || null;
}

async function getUserDefaultDomain(userId: string) {
  const settings = await prisma.siteSettings.findUnique({
    where: { userId },
    select: {
      defaultDomain: true,
    },
  });

  return normalizeApiDomain(settings?.defaultDomain) ?? DEFAULT_PLATFORM_DOMAIN;
}

export async function resolveApiDomainForUser(
  userId: string,
  input: {
    domain?: string | null;
  },
) {
  const explicitDomain = normalizeApiDomain(input.domain);

  if (explicitDomain) {
    return explicitDomain;
  }

  return getUserDefaultDomain(userId);
}

export function getApiDomainParamsFromSearchParams(searchParams: URLSearchParams) {
  return {
    domain: searchParams.get("domain"),
  };
}
