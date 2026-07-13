import { parseDeviceDetails, parseReferrer, resolveGeo } from "@/lib/core/analytics/visitor";
import { runBackgroundTask } from "@/lib/utils/background";
import { hashIp } from "@/lib/utils/ip-hash";
import { isBot } from "@/lib/utils/is-bot";
import { prisma } from "@/server/db";
import { registerEventUsage } from "@/server/lib/event-usage";
import { sendEventUsageEmail } from "@/server/lib/notifications/event-usage";

type RecordBioPageViewOptions = {
  headers: Headers;
  bioPageId: number;
  /** Bio page owner whose monthly event quota the view consumes. */
  ownerId: string;
  ip: string;
  country: string;
  city: string;
};

/**
 * Records a unique view. Relies on the UNIQUE(bioPageId, ipHash) index so
 * concurrent inserts silently collapse to a no-op.
 */
async function recordUniqueView(ipHash: string, bioPageId: number) {
  await prisma.uniqueBioPageView.create({
    data: { ipHash, bioPageId }
  }).catch(() => {
    // Ignore duplicate key errors, effectively mirroring onDuplicateKeyUpdate no-op
  });
}

/**
 * Records a bio-page view. Mirrors recordClick: bot-filtered, IP-hashed, and
 * gated by the owner's monthly event quota via registerEventUsage. When the
 * quota is exceeded the view is skipped (the page still renders — callers fire
 * this without awaiting). A view and a subsequent block click are two distinct
 * funnel events and each consumes one unit of quota.
 */
export async function recordBioPageView(opts: RecordBioPageViewOptions): Promise<void> {
  const { headers, bioPageId, ownerId, ip, country, city } = opts;
  const userAgent = headers.get("user-agent") ?? "";
  if (userAgent && isBot(userAgent)) return;

  const deviceDetails = await parseDeviceDetails(headers);

  const ipForHash = ip && ip !== "undefined" ? ip : "localhost-dev";
  const ipHash = hashIp(ipForHash);

  const usage = await registerEventUsage(ownerId, prisma);

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
    prisma.bioPageView.create({
      data: {
        bioPageId,
        ...deviceDetails,
        referer: parseReferrer(headers.get("referer")),
        country: countryName,
        city: cityName,
        continent: continentName,
      }
    }),
    recordUniqueView(ipHash, bioPageId),
  ]);
}
