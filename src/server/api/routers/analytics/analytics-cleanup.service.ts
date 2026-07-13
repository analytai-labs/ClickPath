import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

const FREE_RETENTION_DAYS = 30;
const PRO_RETENTION_DAYS = 365;

interface AnalyticsCleanupResult {
  linkVisitsDeleted: number;
  uniqueLinkVisitsDeleted: number;
  dailySummariesCreated: number;
  freeLinksProcessed: number;
  proLinksProcessed: number;
  bioPageViewsDeleted: number;
  uniqueBioPageViewsDeleted: number;
}

const QUERY_BATCH_SIZE = 5000;
const DELETE_BATCH_SIZE = 1000;

const USER_FREE_TIER = {
  OR: [
    { subscription: null },
    { subscription: { status: { not: "active" } } },
    { subscription: { plan: "free" } }
  ]
} as any;

const USER_PRO_TIER = {
  subscription: {
    status: "active",
    plan: "pro"
  }
} as any;

export async function cleanupAnalyticsData(): Promise<AnalyticsCleanupResult> {
  const result: AnalyticsCleanupResult = {
    linkVisitsDeleted: 0,
    uniqueLinkVisitsDeleted: 0,
    dailySummariesCreated: 0,
    freeLinksProcessed: 0,
    proLinksProcessed: 0,
    bioPageViewsDeleted: 0,
    uniqueBioPageViewsDeleted: 0,
  };

  const freeCutoffDate = new Date();
  freeCutoffDate.setDate(freeCutoffDate.getDate() - FREE_RETENTION_DAYS);

  const proCutoffDate = new Date();
  proCutoffDate.setDate(proCutoffDate.getDate() - PRO_RETENTION_DAYS);

  await processLinkBatch(
    result,
    "free",
    freeCutoffDate,
    (lastId) =>
      prisma.link.findMany({
        where: {
          id: { gt: lastId },
          teamId: null,
          user: USER_FREE_TIER,
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: QUERY_BATCH_SIZE,
      }).then(res => res.map(l => ({ linkId: l.id }))),
  );

  await processLinkBatch(
    result,
    "free",
    freeCutoffDate,
    (lastId) =>
      prisma.link.findMany({
        where: {
          id: { gt: lastId },
          teamId: { not: null },
          team: { owner: USER_FREE_TIER },
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: QUERY_BATCH_SIZE,
      }).then(res => res.map(l => ({ linkId: l.id }))),
  );

  await processLinkBatch(
    result,
    "pro",
    proCutoffDate,
    (lastId) =>
      prisma.link.findMany({
        where: {
          id: { gt: lastId },
          teamId: null,
          user: USER_PRO_TIER,
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: QUERY_BATCH_SIZE,
      }).then(res => res.map(l => ({ linkId: l.id }))),
  );

  await processLinkBatch(
    result,
    "pro",
    proCutoffDate,
    (lastId) =>
      prisma.link.findMany({
        where: {
          id: { gt: lastId },
          teamId: { not: null },
          team: { owner: USER_PRO_TIER },
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: QUERY_BATCH_SIZE,
      }).then(res => res.map(l => ({ linkId: l.id }))),
  );

  await cleanupBioPageViews(result, freeCutoffDate, proCutoffDate);

  return result;
}

async function cleanupBioPageViews(
  result: AnalyticsCleanupResult,
  freeCutoffDate: Date,
  proCutoffDate: Date,
): Promise<void> {
  await processBioPageBatch(result, freeCutoffDate, (lastId) =>
    prisma.bioPage.findMany({
      where: {
        id: { gt: lastId },
        teamId: null,
        user: USER_FREE_TIER,
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: QUERY_BATCH_SIZE,
    }).then(res => res.map(p => ({ bioPageId: p.id })))
  );
  await processBioPageBatch(result, freeCutoffDate, (lastId) =>
    prisma.bioPage.findMany({
      where: {
        id: { gt: lastId },
        teamId: { not: null },
        team: { owner: USER_FREE_TIER },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: QUERY_BATCH_SIZE,
    }).then(res => res.map(p => ({ bioPageId: p.id })))
  );
  await processBioPageBatch(result, proCutoffDate, (lastId) =>
    prisma.bioPage.findMany({
      where: {
        id: { gt: lastId },
        teamId: null,
        user: USER_PRO_TIER,
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: QUERY_BATCH_SIZE,
    }).then(res => res.map(p => ({ bioPageId: p.id })))
  );
  await processBioPageBatch(result, proCutoffDate, (lastId) =>
    prisma.bioPage.findMany({
      where: {
        id: { gt: lastId },
        teamId: { not: null },
        team: { owner: USER_PRO_TIER },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: QUERY_BATCH_SIZE,
    }).then(res => res.map(p => ({ bioPageId: p.id })))
  );
}

async function processBioPageBatch(
  result: AnalyticsCleanupResult,
  cutoffDate: Date,
  queryFn: (lastId: number) => Promise<{ bioPageId: number }[]>,
): Promise<void> {
  let lastId = 0;

  while (true) {
    const pages = await queryFn(lastId);
    if (pages.length === 0) break;

    const ids = pages.map((p) => p.bioPageId);
    lastId = ids[ids.length - 1] ?? lastId;

    for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
      const batch = ids.slice(i, i + DELETE_BATCH_SIZE);

      result.dailySummariesCreated += await aggregateBioDailySummaries(batch, cutoffDate);

      const [viewRes, uniqueRes] = await Promise.all([
        prisma.bioPageView.deleteMany({
          where: {
            bioPageId: { in: batch },
            createdAt: { lt: cutoffDate },
          },
        }),
        prisma.uniqueBioPageView.deleteMany({
          where: {
            bioPageId: { in: batch },
            createdAt: { lt: cutoffDate },
          },
        }),
      ]);
      result.bioPageViewsDeleted += viewRes.count;
      result.uniqueBioPageViewsDeleted += uniqueRes.count;
    }

    if (pages.length < QUERY_BATCH_SIZE) break;
  }
}

async function aggregateBioDailySummaries(
  bioPageIds: number[],
  cutoffDate: Date,
): Promise<number> {
  const [viewAgg, uniqueAgg] = await Promise.all([
    prisma.$queryRaw<{bioPageId: number, date: string, views: number}[]>`
      SELECT "bioPageId", DATE("createdAt") as date, COUNT(*)::int as views
      FROM "BioPageView"
      WHERE "bioPageId" IN (${Prisma.join(bioPageIds)})
        AND "createdAt" < ${cutoffDate}
      GROUP BY "bioPageId", DATE("createdAt")
    `,
    prisma.$queryRaw<{bioPageId: number, date: string, uniqueViews: number}[]>`
      SELECT "bioPageId", DATE("createdAt") as date, COUNT(*)::int as "uniqueViews"
      FROM "UniqueBioPageView"
      WHERE "bioPageId" IN (${Prisma.join(bioPageIds)})
        AND "createdAt" < ${cutoffDate}
      GROUP BY "bioPageId", DATE("createdAt")
    `,
  ]);

  if (viewAgg.length === 0 && uniqueAgg.length === 0) return 0;

  const summaryMap = new Map<
    string,
    { bioPageId: number; date: string; views: number; uniqueViews: number }
  >();

  for (const row of viewAgg) {
    summaryMap.set(`${row.bioPageId}:${row.date}`, {
      bioPageId: row.bioPageId,
      date: String(row.date),
      views: row.views,
      uniqueViews: 0,
    });
  }
  for (const row of uniqueAgg) {
    const key = `${row.bioPageId}:${row.date}`;
    const existing = summaryMap.get(key);
    if (existing) existing.uniqueViews = row.uniqueViews;
    else
      summaryMap.set(key, {
        bioPageId: row.bioPageId,
        date: String(row.date),
        views: 0,
        uniqueViews: row.uniqueViews,
      });
  }

  const rows = Array.from(summaryMap.values());
  if (rows.length === 0) return 0;

  let upserted = 0;
  for (const row of rows) {
    await prisma.bioPageViewDailySummary.upsert({
      where: {
        bio_page_date_unique: {
          bioPageId: row.bioPageId,
          date: row.date,
        },
      },
      update: {
        views: row.views,
        uniqueViews: row.uniqueViews,
      },
      create: {
        bioPageId: row.bioPageId,
        date: row.date,
        views: row.views,
        uniqueViews: row.uniqueViews,
      },
    });
    upserted++;
  }

  return upserted;
}

async function processLinkBatch(
  result: AnalyticsCleanupResult,
  tier: "free" | "pro",
  cutoffDate: Date,
  queryFn: (
    lastId: number,
  ) => Promise<{ linkId: number }[]>,
): Promise<void> {
  let lastId = 0;

  while (true) {
    const links = await queryFn(lastId);
    if (links.length === 0) break;

    const linkIds = links.map((l) => l.linkId);
    lastId = linkIds[linkIds.length - 1] ?? lastId;

    if (tier === "free") {
      result.freeLinksProcessed += linkIds.length;
    } else {
      result.proLinksProcessed += linkIds.length;
    }

    for (let i = 0; i < linkIds.length; i += DELETE_BATCH_SIZE) {
      const batch = linkIds.slice(i, i + DELETE_BATCH_SIZE);

      result.dailySummariesCreated += await aggregateDailySummaries(
        batch,
        cutoffDate,
      );

      const [linkVisitResult, uniqueVisitResult] = await Promise.all([
        prisma.linkVisit.deleteMany({
          where: {
            linkId: { in: batch },
            createdAt: { lt: cutoffDate },
          },
        }),
        prisma.uniqueLinkVisit.deleteMany({
          where: {
            linkId: { in: batch },
            createdAt: { lt: cutoffDate },
          },
        }),
      ]);
      result.linkVisitsDeleted += linkVisitResult.count;
      result.uniqueLinkVisitsDeleted += uniqueVisitResult.count;
    }

    if (links.length < QUERY_BATCH_SIZE) break;
  }
}

async function aggregateDailySummaries(
  linkIds: number[],
  cutoffDate: Date,
): Promise<number> {
  const [clickAgg, uniqueAgg] = await Promise.all([
    prisma.$queryRaw<{linkId: number, date: string, clicks: number}[]>`
      SELECT "linkId", DATE("createdAt") as date, COUNT(*)::int as clicks
      FROM "LinkVisit"
      WHERE "linkId" IN (${Prisma.join(linkIds)})
        AND "createdAt" < ${cutoffDate}
      GROUP BY "linkId", DATE("createdAt")
    `,
    prisma.$queryRaw<{linkId: number, date: string, uniqueClicks: number}[]>`
      SELECT "linkId", DATE("createdAt") as date, COUNT(*)::int as "uniqueClicks"
      FROM "UniqueLinkVisit"
      WHERE "linkId" IN (${Prisma.join(linkIds)})
        AND "createdAt" < ${cutoffDate}
      GROUP BY "linkId", DATE("createdAt")
    `,
  ]);

  if (clickAgg.length === 0 && uniqueAgg.length === 0) {
    return 0;
  }

  const summaryMap = new Map<
    string,
    { linkId: number; date: string; clicks: number; uniqueClicks: number }
  >();

  for (const row of clickAgg) {
    const key = `${row.linkId}:${row.date}`;
    summaryMap.set(key, {
      linkId: row.linkId,
      date: String(row.date),
      clicks: row.clicks,
      uniqueClicks: 0,
    });
  }

  for (const row of uniqueAgg) {
    const key = `${row.linkId}:${row.date}`;
    const existing = summaryMap.get(key);
    if (existing) {
      existing.uniqueClicks = row.uniqueClicks;
    } else {
      summaryMap.set(key, {
        linkId: row.linkId,
        date: String(row.date),
        clicks: 0,
        uniqueClicks: row.uniqueClicks,
      });
    }
  }

  const rows = Array.from(summaryMap.values());
  if (rows.length === 0) return 0;

  let upserted = 0;

  for (const row of rows) {
    await prisma.linkVisitDailySummary.upsert({
      where: {
        link_date_unique: {
          linkId: row.linkId,
          date: row.date,
        },
      },
      update: {
        clicks: row.clicks,
        uniqueClicks: row.uniqueClicks,
      },
      create: {
        linkId: row.linkId,
        date: row.date,
        clicks: row.clicks,
        uniqueClicks: row.uniqueClicks,
      },
    });
    upserted++;
  }

  return upserted;
}

export async function getAnalyticsCleanupStats() {
  const freeCutoffDate = new Date();
  freeCutoffDate.setDate(freeCutoffDate.getDate() - FREE_RETENTION_DAYS);

  const proCutoffDate = new Date();
  proCutoffDate.setDate(proCutoffDate.getDate() - PRO_RETENTION_DAYS);

  const [oldFreeVisits, oldProVisits, oldFreeTeamVisits, oldProTeamVisits] =
    await Promise.all([
      prisma.linkVisit.count({
        where: {
          createdAt: { lt: freeCutoffDate },
          link: {
            teamId: null,
            user: USER_FREE_TIER,
          }
        },
      }),
      prisma.linkVisit.count({
        where: {
          createdAt: { lt: proCutoffDate },
          link: {
            teamId: null,
            user: USER_PRO_TIER,
          }
        },
      }),
      prisma.linkVisit.count({
        where: {
          createdAt: { lt: freeCutoffDate },
          link: {
            teamId: { not: null },
            team: { owner: USER_FREE_TIER },
          }
        },
      }),
      prisma.linkVisit.count({
        where: {
          createdAt: { lt: proCutoffDate },
          link: {
            teamId: { not: null },
            team: { owner: USER_PRO_TIER },
          }
        },
      }),
    ]);

  return {
    freeUserVisitsPendingCleanup: oldFreeVisits + oldFreeTeamVisits,
    proUserVisitsPendingCleanup: oldProVisits + oldProTeamVisits,
    freeRetentionDays: FREE_RETENTION_DAYS,
    proRetentionDays: PRO_RETENTION_DAYS,
  };
}
