import { parseDeviceDetails, parseReferrer, resolveGeo } from "@/lib/core/analytics/visitor";
import {
  type Link,
  buildCacheKey,
  getFromCache,
  normalizeDomain,
  setInCache,
} from "@/lib/core/cache";
import { runBackgroundTask } from "@/lib/utils/background";
import { hashIp } from "@/lib/utils/ip-hash";
import { isBot } from "@/lib/utils/is-bot";
import { prisma } from "@/server/db";
import { registerEventUsage } from "@/server/lib/event-usage";
import { checkAndFireMilestones } from "@/server/lib/milestone-check";
import { sendEventUsageEmail } from "@/server/lib/notifications/event-usage";

/**
 * Cache-first link lookup. No side effects except populating the cache on miss.
 * Returns null when the alias/domain pair doesn't resolve.
 */
export async function resolveLink(domain: string, alias: string): Promise<Link | null> {
  const cacheKey = buildCacheKey(domain, alias);
  const cached: Link | null = await getFromCache(cacheKey);
  if (cached) return cached;

  const link = await prisma.link.findFirst({
    where: {
      domain: normalizeDomain(domain),
      alias: { equals: alias.replace("/", ""), mode: "insensitive" },
    },
  });
  if (!link) return null;

  await runBackgroundTask(setInCache(cacheKey, link));
  return link;
}

/**
 * Records a unique click. Relies on the UNIQUE(linkId, ipHash) index so
 * concurrent inserts silently collapse to a no-op.
 */
async function recordUniqueClick(ipHash: string, linkId: number) {
  await prisma.uniqueLinkVisit
    .create({
      data: { ipHash, linkId },
    })
    .catch(() => {
      // Ignore duplicate key errors, effectively mirroring onDuplicateKeyUpdate no-op
    });
}

type RecordClickOptions = {
  headers: Headers;
  link: Link;
  ip: string;
  country: string;
  city: string;
  matchedGeoRuleId?: number;
  visitId?: string | null;
};

/**
 * Records a click for an already-resolved link. Callers are responsible for
 * deciding whether to record (e.g. skip for password-protected redirects that
 * haven't been unlocked yet) — this function records unconditionally aside from
 * bot filtering and quota enforcement.
 */
export async function recordClick(opts: RecordClickOptions): Promise<void> {
  const { headers, link, ip, country, city, matchedGeoRuleId, visitId } = opts;
  const userAgent = headers.get("user-agent") ?? "";
  if (userAgent && isBot(userAgent)) return;

  const deviceDetails = await parseDeviceDetails(headers);

  const ipForHash = ip && ip !== "undefined" ? ip : "localhost-dev";
  const ipHash = hashIp(ipForHash);

  const usage = await registerEventUsage(link.userId, prisma);

  if (usage.alertLevelTriggered && usage.limit && usage.userEmail && usage.plan) {
    await runBackgroundTask(
      sendEventUsageEmail({
        email: usage.userEmail,
        name: usage.userName,
        threshold: usage.alertLevelTriggered,
        limit: usage.limit,
        currentCount: usage.currentCount,
        plan: usage.plan,
      }),
    );
  }

  if (!usage.allowed) return;

  const { countryName, continentName, cityName } = resolveGeo(country, city);

  await Promise.all([
    prisma.linkVisit.create({
      data: {
        linkId: link.id,
        ...deviceDetails,
        referer: parseReferrer(headers.get("referer")),
        country: countryName,
        city: cityName,
        continent: continentName,
        matchedGeoRuleId: matchedGeoRuleId ?? null,
        visitId: visitId ?? null,
      },
    }),
    recordUniqueClick(ipHash, link.id),
  ]);

  void runBackgroundTask(checkAndFireMilestones(link.id, link.userId));
}
