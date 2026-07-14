import { PAID_PLANS, PLAN_PRICES_USD, type PaidPlan } from "@/lib/constants/plan-pricing";
import { buildCacheKey, deleteFromCache } from "@/lib/core/cache";
import type { SubscriptionPlan } from "@prisma/client";
import type { ProtectedTRPCContext } from "../../trpc";

/** Discriminator used to identify links auto-blocked by a user ban */
const BAN_CASCADE_REASON = "Owner account banned" as const;

import type {
  AddBlockedDomainInput,
  BanUserInput,
  BlockLinkInput,
  GetActivityChartInput,
  GetAnalyticsInput,
  GetFlaggedLinksInput,
  GetMonthlyBreakdownInput,
  GetPeakPeriodsInput,
  GetRecentSubscriptionsInput,
  GetSubscriptionTimelineInput,
  GetTopLinksInput,
  GetTopUsersInput,
  GetUserBaseSummaryInput,
  RemoveBlockedDomainInput,
  ResolveFlaggedLinkInput,
  SearchLinksInput,
  SearchUsersInput,
  UnbanUserInput,
  UnblockLinkInput,
} from "./admin.input";

export async function getStats(ctx: ProtectedTRPCContext) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    totalLinks,
    blockedLinks,
    linksToday,
    totalUsers,
    bannedUsers,
    usersToday,
    pendingFlagged,
    blockedDomains,
  ] = await Promise.all([
    ctx.prisma.link.count(),
    ctx.prisma.link.count({ where: { blocked: true } }),
    ctx.prisma.link.count({ where: { createdAt: { gte: today } } }),
    ctx.prisma.user.count(),
    ctx.prisma.user.count({ where: { banned: true } }),
    ctx.prisma.user.count({ where: { createdAt: { gte: today } } }),
    ctx.prisma.flaggedLink.count({ where: { status: "pending" } }),
    ctx.prisma.blockedDomain.count(),
  ]);

  return {
    totalLinks,
    totalUsers,
    blockedLinks,
    pendingFlagged,
    bannedUsers,
    blockedDomains,
    linksToday,
    usersToday,
  };
}

export async function getDailyStats(ctx: ProtectedTRPCContext) {
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
  fourteenDaysAgo.setHours(0, 0, 0, 0);

  const query = `
    SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') as date, COUNT(*) as count
    FROM "__TABLE__"
    WHERE "createdAt" >= $1
    GROUP BY 1
    ORDER BY 1
  `;

  const [dailyLinks, dailyUsers] = await Promise.all([
    ctx.prisma.$queryRawUnsafe<{ date: string; count: bigint }[]>(
      query.replace("__TABLE__", "Link"),
      fourteenDaysAgo,
    ),
    ctx.prisma.$queryRawUnsafe<{ date: string; count: bigint }[]>(
      query.replace("__TABLE__", "User"),
      fourteenDaysAgo,
    ),
  ]);

  const linksByDate = new Map(dailyLinks.map((l) => [l.date, Number(l.count)]));
  const usersByDate = new Map(dailyUsers.map((u) => [u.date, Number(u.count)]));

  const result: { date: string; links: number; users: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(fourteenDaysAgo);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0]!;
    result.push({
      date: dateStr,
      links: linksByDate.get(dateStr) ?? 0,
      users: usersByDate.get(dateStr) ?? 0,
    });
  }

  return result;
}

export async function getRecentUsers(ctx: ProtectedTRPCContext) {
  const recent = await ctx.prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      createdAt: true,
      banned: true,
      _count: { select: { links: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  return recent.map((u) => {
    const { _count, ...rest } = u;
    return { ...rest, linkCount: _count.links };
  });
}

export async function getRecentActivity(ctx: ProtectedTRPCContext) {
  const [recentLinksRaw, recentBlockedRaw] = await Promise.all([
    ctx.prisma.link.findMany({
      select: {
        id: true,
        url: true,
        alias: true,
        domain: true,
        createdAt: true,
        user: { select: { email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    ctx.prisma.link.findMany({
      where: { blocked: true },
      select: {
        id: true,
        url: true,
        alias: true,
        domain: true,
        blockedAt: true,
        blockedReason: true,
        user: { select: { email: true } },
      },
      orderBy: { blockedAt: "desc" },
      take: 5,
    }),
  ]);

  return {
    recentLinks: recentLinksRaw.map((l) => {
      const { user, ...rest } = l;
      return { ...rest, userEmail: user?.email ?? null };
    }),
    recentBlocked: recentBlockedRaw.map((l) => {
      const { user, ...rest } = l;
      return { ...rest, userEmail: user?.email ?? null };
    }),
  };
}

export async function searchLinks(ctx: ProtectedTRPCContext, input: SearchLinksInput) {
  const offset = (input.page - 1) * input.pageSize;

  const searchCondition = {
    OR: [
      { url: { contains: input.query } },
      { alias: { contains: input.query } },
      { domain: { contains: input.query } },
      { user: { email: { contains: input.query } } },
    ],
  };

  const [results, total] = await Promise.all([
    ctx.prisma.link.findMany({
      where: searchCondition,
      select: {
        id: true,
        url: true,
        alias: true,
        domain: true,
        blocked: true,
        blockedReason: true,
        createdAt: true,
        userId: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: input.pageSize,
      skip: offset,
    }),
    ctx.prisma.link.count({ where: searchCondition }),
  ]);

  return {
    links: results.map((l) => {
      const { user, ...rest } = l;
      return { ...rest, userName: user?.name ?? null, userEmail: user?.email ?? null };
    }),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function blockLink(ctx: ProtectedTRPCContext, input: BlockLinkInput) {
  const linkRecord = await ctx.prisma.link.findFirst({
    where: { id: input.linkId },
    select: { id: true, alias: true, domain: true },
  });

  if (!linkRecord) {
    throw new Error("Link not found");
  }

  await ctx.prisma.link.update({
    where: { id: input.linkId },
    data: {
      blocked: true,
      blockedAt: new Date(),
      blockedReason: input.reason,
    },
  });

  if (linkRecord.alias) {
    await deleteFromCache(buildCacheKey(linkRecord.domain, linkRecord.alias));
  }
}

export async function unblockLink(ctx: ProtectedTRPCContext, input: UnblockLinkInput) {
  const linkRecord = await ctx.prisma.link.findFirst({
    where: { id: input.linkId },
    select: { id: true, alias: true, domain: true },
  });

  if (!linkRecord) {
    throw new Error("Link not found");
  }

  await ctx.prisma.link.update({
    where: { id: input.linkId },
    data: {
      blocked: false,
      blockedAt: null,
      blockedReason: null,
    },
  });

  if (linkRecord.alias) {
    await deleteFromCache(buildCacheKey(linkRecord.domain, linkRecord.alias));
  }
}

export async function searchUsers(ctx: ProtectedTRPCContext, input: SearchUsersInput) {
  const offset = (input.page - 1) * input.pageSize;

  const searchCondition = {
    OR: [{ email: { contains: input.query } }, { name: { contains: input.query } }],
  };

  const [results, total] = await Promise.all([
    ctx.prisma.user.findMany({
      where: searchCondition,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        banned: true,
        bannedReason: true,
        bannedAt: true,
        _count: { select: { links: true } },
      },
      orderBy: { createdAt: "desc" },
      take: input.pageSize,
      skip: offset,
    }),
    ctx.prisma.user.count({ where: searchCondition }),
  ]);

  return {
    users: results.map((u) => {
      const { _count, ...rest } = u;
      return { ...rest, linkCount: _count.links };
    }),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function banUser(ctx: ProtectedTRPCContext, input: BanUserInput) {
  if (input.userId === ctx.auth.userId) {
    throw new Error("Cannot ban yourself");
  }

  const userLinks = await ctx.prisma.link.findMany({
    where: { userId: input.userId },
    select: { id: true, alias: true, domain: true },
  });

  await ctx.prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: {
        banned: true,
        bannedAt: new Date(),
        bannedReason: input.reason,
      },
    });

    if (userLinks.length > 0) {
      await tx.link.updateMany({
        where: { userId: input.userId },
        data: {
          blocked: true,
          blockedAt: new Date(),
          blockedReason: BAN_CASCADE_REASON,
        },
      });
    }
  });

  if (userLinks.length > 0) {
    await Promise.all(
      userLinks.map((l) =>
        l.alias ? deleteFromCache(buildCacheKey(l.domain, l.alias)) : Promise.resolve(),
      ),
    );
  }
}

export async function unbanUser(ctx: ProtectedTRPCContext, input: UnbanUserInput) {
  const bannedLinks = await ctx.prisma.link.findMany({
    where: {
      userId: input.userId,
      blockedReason: BAN_CASCADE_REASON,
    },
    select: { id: true, alias: true, domain: true },
  });

  await ctx.prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: {
        banned: false,
        bannedAt: null,
        bannedReason: null,
      },
    });

    if (bannedLinks.length > 0) {
      await tx.link.updateMany({
        where: {
          userId: input.userId,
          blockedReason: BAN_CASCADE_REASON,
        },
        data: {
          blocked: false,
          blockedAt: null,
          blockedReason: null,
        },
      });
    }
  });

  if (bannedLinks.length > 0) {
    await Promise.all(
      bannedLinks.map((l) =>
        l.alias ? deleteFromCache(buildCacheKey(l.domain, l.alias)) : Promise.resolve(),
      ),
    );
  }
}

export async function getBlockedDomains(ctx: ProtectedTRPCContext) {
  return ctx.prisma.blockedDomain.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function addBlockedDomain(ctx: ProtectedTRPCContext, input: AddBlockedDomainInput) {
  let domain = input.domain.toLowerCase().trim();
  try {
    const parsed = new URL(domain.startsWith("http") ? domain : `https://${domain}`);
    domain = parsed.hostname;
  } catch {
    // Use as-is if not a valid URL
  }

  await ctx.prisma.blockedDomain.create({
    data: {
      domain,
      reason: input.reason ?? null,
      createdByUserId: ctx.auth.userId,
    },
  });
}

export async function removeBlockedDomain(
  ctx: ProtectedTRPCContext,
  input: RemoveBlockedDomainInput,
) {
  await ctx.prisma.blockedDomain.delete({
    where: { id: input.id },
  });
}

export async function getFlaggedLinks(ctx: ProtectedTRPCContext, input: GetFlaggedLinksInput) {
  const offset = (input.page - 1) * input.pageSize;
  const whereConditions = input.status ? { status: input.status } : {};

  const [results, total] = await Promise.all([
    ctx.prisma.flaggedLink.findMany({
      where: whereConditions,
      include: { link: { select: { url: true, alias: true, domain: true, blocked: true } } },
      orderBy: { flaggedAt: "desc" },
      take: input.pageSize,
      skip: offset,
    }),
    ctx.prisma.flaggedLink.count({ where: whereConditions }),
  ]);

  return {
    flaggedLinks: results.map((f) => {
      const { link, ...rest } = f;
      return {
        ...rest,
        linkUrl: link.url,
        linkAlias: link.alias,
        linkDomain: link.domain,
        linkBlocked: link.blocked,
      };
    }),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function resolveFlaggedLink(
  ctx: ProtectedTRPCContext,
  input: ResolveFlaggedLinkInput,
) {
  const flagged = await ctx.prisma.flaggedLink.findFirst({
    where: { id: input.id },
  });

  if (!flagged) {
    throw new Error("Flagged link not found");
  }

  await ctx.prisma.flaggedLink.update({
    where: { id: input.id },
    data: {
      status: input.action,
      resolvedAt: new Date(),
      resolvedByUserId: ctx.auth.userId,
    },
  });

  if (input.action === "blocked") {
    await blockLink(ctx, {
      linkId: flagged.linkId,
      reason: flagged.reason ?? "Flagged and blocked by admin",
    });
  }
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

function getPreviousPeriod(from: Date, to: Date) {
  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  prevTo.setHours(23, 59, 59, 999);
  const prevFrom = new Date(prevTo.getTime() - durationMs);
  prevFrom.setHours(0, 0, 0, 0);
  return { prevFrom, prevTo };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

async function countClicks(ctx: ProtectedTRPCContext, from: Date, to: Date): Promise<number> {
  return await ctx.prisma.linkVisit.count({
    where: { createdAt: { gte: from, lte: to } },
  });
}

export async function getAnalytics(ctx: ProtectedTRPCContext, input: GetAnalyticsInput) {
  const { from, to } = input;
  const { prevFrom, prevTo } = getPreviousPeriod(from, to);

  const [currentLinks, currentUsers, clicksInRange, previousLinks, previousUsers, clicksPrev] =
    await Promise.all([
      ctx.prisma.link.count({ where: { createdAt: { gte: from, lte: to } } }),
      ctx.prisma.user.count({ where: { createdAt: { gte: from, lte: to } } }),
      countClicks(ctx, from, to),
      ctx.prisma.link.count({ where: { createdAt: { gte: prevFrom, lte: prevTo } } }),
      ctx.prisma.user.count({ where: { createdAt: { gte: prevFrom, lte: prevTo } } }),
      countClicks(ctx, prevFrom, prevTo),
    ]);

  return {
    links: currentLinks,
    users: currentUsers,
    clicks: clicksInRange,
    linksGrowth: pctChange(currentLinks, previousLinks),
    usersGrowth: pctChange(currentUsers, previousUsers),
    clicksGrowth: pctChange(clicksInRange, clicksPrev),
    avgLinksPerUser: currentUsers > 0 ? Math.round((currentLinks / currentUsers) * 10) / 10 : 0,
  };
}

export async function getActivityChart(ctx: ProtectedTRPCContext, input: GetActivityChartInput) {
  const { from, to, granularity } = input;
  const pgFormat = granularity === "month" ? "YYYY-MM" : "YYYY-MM-DD";

  const query = `
    SELECT TO_CHAR("createdAt", $1) as date, COUNT(*) as count
    FROM "__TABLE__"
    WHERE "createdAt" >= $2 AND "createdAt" <= $3
    GROUP BY 1
    ORDER BY 1
  `;

  const [dailyLinks, dailyUsers, dailyClicks] = await Promise.all([
    ctx.prisma.$queryRawUnsafe<{ date: string; count: bigint }[]>(
      query.replace("__TABLE__", "Link"),
      pgFormat,
      from,
      to,
    ),
    ctx.prisma.$queryRawUnsafe<{ date: string; count: bigint }[]>(
      query.replace("__TABLE__", "User"),
      pgFormat,
      from,
      to,
    ),
    ctx.prisma.$queryRawUnsafe<{ date: string; count: bigint }[]>(
      query.replace("__TABLE__", "LinkVisit"),
      pgFormat,
      from,
      to,
    ),
  ]);

  const linksByDate = new Map(dailyLinks.map((l) => [l.date, Number(l.count)]));
  const usersByDate = new Map(dailyUsers.map((u) => [u.date, Number(u.count)]));
  const clicksByDate = new Map(dailyClicks.map((c) => [c.date, Number(c.count)]));

  const result: { date: string; links: number; users: number; clicks: number }[] = [];

  if (granularity === "month") {
    const cursor = new Date(from);
    cursor.setDate(1);
    const endMonth = to.getFullYear() * 12 + to.getMonth();
    while (cursor.getFullYear() * 12 + cursor.getMonth() <= endMonth) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      result.push({
        date: key,
        links: linksByDate.get(key) ?? 0,
        users: usersByDate.get(key) ?? 0,
        clicks: clicksByDate.get(key) ?? 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    const cursor = new Date(from);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= to) {
      const key = cursor.toISOString().split("T")[0]!;
      result.push({
        date: key,
        links: linksByDate.get(key) ?? 0,
        users: usersByDate.get(key) ?? 0,
        clicks: clicksByDate.get(key) ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return result;
}

export async function getTopUsers(ctx: ProtectedTRPCContext, input: GetTopUsersInput) {
  const { from, to, sortBy, limit: lim } = input;

  if (sortBy === "clicks") {
    const rows = await ctx.prisma.$queryRawUnsafe<
      {
        id: string;
        name: string | null;
        email: string | null;
        image: string | null;
        createdAt: Date | null;
        linkCount: bigint;
        clickCount: bigint;
      }[]
    >(
      `SELECT u.id, u.name, u.email, u."image", u."createdAt",
              COUNT(DISTINCT l.id) as "linkCount",
              COUNT(v.id) as "clickCount"
       FROM "User" u
       INNER JOIN "Link" l ON l."userId" = u.id
       INNER JOIN "LinkVisit" v ON v."linkId" = l.id
       WHERE v."createdAt" >= $1 AND v."createdAt" <= $2
       GROUP BY u.id
       ORDER BY "clickCount" DESC
       LIMIT $3`,
      from,
      to,
      lim,
    );
    return rows.map((r) => ({
      ...r,
      linkCount: Number(r.linkCount),
      clickCount: Number(r.clickCount),
    }));
  }

  const rows = await ctx.prisma.$queryRawUnsafe<
    {
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
      createdAt: Date | null;
      linkCount: bigint;
      clickCount: bigint;
    }[]
  >(
    `SELECT u.id, u.name, u.email, u."image", u."createdAt",
            COUNT(DISTINCT l.id) as "linkCount",
            SUM(CASE WHEN v."createdAt" >= $1 AND v."createdAt" <= $2 THEN 1 ELSE 0 END) as "clickCount"
     FROM "User" u
     INNER JOIN "Link" l ON l."userId" = u.id
     LEFT JOIN "LinkVisit" v ON v."linkId" = l.id
     WHERE l."createdAt" >= $1 AND l."createdAt" <= $2
     GROUP BY u.id
     ORDER BY "linkCount" DESC
     LIMIT $3`,
    from,
    to,
    lim,
  );
  return rows.map((r) => ({
    ...r,
    linkCount: Number(r.linkCount),
    clickCount: Number(r.clickCount),
  }));
}

export async function getTopLinks(ctx: ProtectedTRPCContext, input: GetTopLinksInput) {
  const { from, to, limit: lim } = input;

  const rows = await ctx.prisma.$queryRawUnsafe<
    {
      id: number;
      url: string | null;
      alias: string | null;
      domain: string;
      createdAt: Date | null;
      userEmail: string | null;
      clicks: bigint;
    }[]
  >(
    `SELECT l.id, l.url, l.alias, l.domain, l."createdAt", u.email as "userEmail", COUNT(v.id) as clicks
     FROM "LinkVisit" v
     INNER JOIN "Link" l ON v."linkId" = l.id
     LEFT JOIN "User" u ON l."userId" = u.id
     WHERE v."createdAt" >= $1 AND v."createdAt" <= $2
     GROUP BY l.id, u.email
     ORDER BY clicks DESC
     LIMIT $3`,
    from,
    to,
    lim,
  );

  return rows.map((r) => ({ ...r, clicks: Number(r.clicks) }));
}

export async function getPeakPeriods(ctx: ProtectedTRPCContext, input: GetPeakPeriodsInput) {
  const { from, to } = input;

  const queryDay = `
    SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') as date, COUNT(*) as count
    FROM "__TABLE__"
    WHERE "createdAt" >= $1 AND "createdAt" <= $2
    GROUP BY 1
    ORDER BY count DESC
    LIMIT 1
  `;
  const queryMonth = `
    SELECT TO_CHAR("createdAt", 'YYYY-MM') as month, COUNT(*) as count
    FROM "__TABLE__"
    WHERE "createdAt" >= $1 AND "createdAt" <= $2
    GROUP BY 1
    ORDER BY count DESC
    LIMIT 1
  `;

  const [peakLinkDay, peakUserDay, peakClickDay, peakLinkMonth, peakUserMonth] = await Promise.all([
    ctx.prisma.$queryRawUnsafe<{ date: string; count: bigint }[]>(
      queryDay.replace("__TABLE__", "Link"),
      from,
      to,
    ),
    ctx.prisma.$queryRawUnsafe<{ date: string; count: bigint }[]>(
      queryDay.replace("__TABLE__", "User"),
      from,
      to,
    ),
    ctx.prisma.$queryRawUnsafe<{ date: string; count: bigint }[]>(
      queryDay.replace("__TABLE__", "LinkVisit"),
      from,
      to,
    ),
    ctx.prisma.$queryRawUnsafe<{ month: string; count: bigint }[]>(
      queryMonth.replace("__TABLE__", "Link"),
      from,
      to,
    ),
    ctx.prisma.$queryRawUnsafe<{ month: string; count: bigint }[]>(
      queryMonth.replace("__TABLE__", "User"),
      from,
      to,
    ),
  ]);

  return {
    peakLinkDay: peakLinkDay[0]
      ? { date: peakLinkDay[0].date, count: Number(peakLinkDay[0].count) }
      : null,
    peakUserDay: peakUserDay[0]
      ? { date: peakUserDay[0].date, count: Number(peakUserDay[0].count) }
      : null,
    peakClickDay: peakClickDay[0]
      ? { date: peakClickDay[0].date, count: Number(peakClickDay[0].count) }
      : null,
    peakLinkMonth: peakLinkMonth[0]
      ? { month: peakLinkMonth[0].month, count: Number(peakLinkMonth[0].count) }
      : null,
    peakUserMonth: peakUserMonth[0]
      ? { month: peakUserMonth[0].month, count: Number(peakUserMonth[0].count) }
      : null,
  };
}

export async function getMonthlyBreakdown(
  ctx: ProtectedTRPCContext,
  input: GetMonthlyBreakdownInput,
) {
  const { from, to } = input;

  const query = `
    SELECT TO_CHAR("createdAt", 'YYYY-MM') as month, COUNT(*) as count
    FROM "__TABLE__"
    WHERE "createdAt" >= $1 AND "createdAt" <= $2
    GROUP BY 1
    ORDER BY 1
  `;

  const [monthlyLinks, monthlyUsers, monthlyClicks] = await Promise.all([
    ctx.prisma.$queryRawUnsafe<{ month: string; count: bigint }[]>(
      query.replace("__TABLE__", "Link"),
      from,
      to,
    ),
    ctx.prisma.$queryRawUnsafe<{ month: string; count: bigint }[]>(
      query.replace("__TABLE__", "User"),
      from,
      to,
    ),
    ctx.prisma.$queryRawUnsafe<{ month: string; count: bigint }[]>(
      query.replace("__TABLE__", "LinkVisit"),
      from,
      to,
    ),
  ]);

  const linksByMonth = new Map(monthlyLinks.map((l) => [l.month, Number(l.count)]));
  const usersByMonth = new Map(monthlyUsers.map((u) => [u.month, Number(u.count)]));
  const clicksByMonth = new Map(monthlyClicks.map((c) => [c.month, Number(c.count)]));

  const result: { month: string; links: number; users: number; clicks: number }[] = [];
  const cursor = new Date(from);
  cursor.setDate(1);
  const endMonth = to.getFullYear() * 12 + to.getMonth();
  while (cursor.getFullYear() * 12 + cursor.getMonth() <= endMonth) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    result.push({
      month: key,
      links: linksByMonth.get(key) ?? 0,
      users: usersByMonth.get(key) ?? 0,
      clicks: clicksByMonth.get(key) ?? 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return result;
}

export async function getSystemHealth(ctx: ProtectedTRPCContext) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    totalLinks,
    blockedLinks,
    totalUsers,
    bannedUsers,
    pendingFlagged,
    openFeedback,
    blockedDomains,
    totalBioPages,
    bioPagesToday,
    totalCampaigns,
    activeCampaigns,
    campaignsToday,
  ] = await Promise.all([
    ctx.prisma.link.count(),
    ctx.prisma.link.count({ where: { blocked: true } }),
    ctx.prisma.user.count(),
    ctx.prisma.user.count({ where: { banned: true } }),
    ctx.prisma.flaggedLink.count({ where: { status: "pending" } }),
    ctx.prisma.feedback.count({ where: { status: "open" } }),
    ctx.prisma.blockedDomain.count(),
    ctx.prisma.bioPage.count(),
    ctx.prisma.bioPage.count({ where: { createdAt: { gte: today } } }),
    ctx.prisma.campaign.count(),
    ctx.prisma.campaign.count({ where: { status: "active" } }),
    ctx.prisma.campaign.count({ where: { createdAt: { gte: today } } }),
  ]);

  return {
    totalLinks,
    totalUsers,
    blockedLinks,
    bannedUsers,
    blockedPercent: totalLinks > 0 ? Math.round((blockedLinks / totalLinks) * 100 * 10) / 10 : 0,
    banRate: totalUsers > 0 ? Math.round((bannedUsers / totalUsers) * 100 * 10) / 10 : 0,
    pendingFlagged,
    openFeedback,
    blockedDomains,
    totalBioPages,
    bioPagesToday,
    totalCampaigns,
    activeCampaigns,
    campaignsToday,
  };
}

function sharePct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export async function getUserBaseSummary(
  ctx: ProtectedTRPCContext,
  input: GetUserBaseSummaryInput,
) {
  const { from, to } = input;
  const { prevFrom, prevTo } = getPreviousPeriod(from, to);

  const [
    totalUsers,
    newUsersInRange,
    newUsersPrev,
    tierBreakdown,
    paidPrevCount,
    newPaidInRange,
    newPaidPrev,
  ] = await Promise.all([
    ctx.prisma.user.count(),
    ctx.prisma.user.count({ where: { createdAt: { gte: from, lte: to } } }),
    ctx.prisma.user.count({ where: { createdAt: { gte: prevFrom, lte: prevTo } } }),
    ctx.prisma.subscription.groupBy({
      by: ["plan"],
      where: { plan: { in: PAID_PLANS as SubscriptionPlan[] } },
      _count: { _all: true },
    }),
    ctx.prisma.subscription.count({
      where: {
        plan: { in: PAID_PLANS as SubscriptionPlan[] },
        createdAt: { lte: prevTo },
      },
    }),
    ctx.prisma.subscription.count({
      where: {
        plan: { in: PAID_PLANS as SubscriptionPlan[] },
        createdAt: { gte: from, lte: to },
      },
    }),
    ctx.prisma.subscription.count({
      where: {
        plan: { in: PAID_PLANS as SubscriptionPlan[] },
        createdAt: { gte: prevFrom, lte: prevTo },
      },
    }),
  ]);

  const tierMap = new Map<PaidPlan, number>();
  for (const row of tierBreakdown) {
    if (row.plan && (PAID_PLANS as string[]).includes(row.plan)) {
      tierMap.set(row.plan as PaidPlan, row._count._all);
    }
  }
  const proCount = tierMap.get("pro") ?? 0;
  const ultraCount = tierMap.get("ultra") ?? 0;
  const paidUsers = proCount + ultraCount;
  const freeUsers = totalUsers - paidUsers;

  const mrr = proCount * PLAN_PRICES_USD.pro + ultraCount * PLAN_PRICES_USD.ultra;

  return {
    totalUsers,
    freeUsers,
    paidUsers,
    paidPercent: sharePct(paidUsers, totalUsers),
    mrr,
    newUsers: newUsersInRange,
    newUsersGrowth: pctChange(newUsersInRange, newUsersPrev),
    newPaid: newPaidInRange,
    newPaidGrowth: pctChange(newPaidInRange, newPaidPrev),
    paidGrowth: pctChange(paidUsers, paidPrevCount),
    tiers: {
      free: { count: freeUsers, share: sharePct(freeUsers, totalUsers), mrr: 0 },
      pro: {
        count: proCount,
        share: sharePct(proCount, totalUsers),
        mrr: proCount * PLAN_PRICES_USD.pro,
      },
      ultra: {
        count: ultraCount,
        share: sharePct(ultraCount, totalUsers),
        mrr: ultraCount * PLAN_PRICES_USD.ultra,
      },
    },
  };
}

export async function getSubscriptionTimeline(
  ctx: ProtectedTRPCContext,
  input: GetSubscriptionTimelineInput,
) {
  const { from, to } = input;

  const rows = await ctx.prisma.$queryRawUnsafe<{ date: string; plan: string; total: bigint }[]>(
    `SELECT TO_CHAR("createdAt", 'YYYY-MM') as date, plan, COUNT(*) as total
     FROM "Subscription"
     WHERE plan IN ($1, $2) AND "createdAt" >= $3 AND "createdAt" <= $4
     GROUP BY 1, plan
     ORDER BY 1`,
    "pro",
    "ultra",
    from,
    to,
  );

  const byDate = new Map<string, { pro: number; ultra: number }>();
  for (const row of rows) {
    const key = row.date;
    const entry = byDate.get(key) ?? { pro: 0, ultra: 0 };
    if (row.plan === "pro") entry.pro = Number(row.total);
    else if (row.plan === "ultra") entry.ultra = Number(row.total);
    byDate.set(key, entry);
  }

  const result: { date: string; pro: number; ultra: number }[] = [];
  const cursor = new Date(from);
  cursor.setDate(1);
  const endMonth = to.getFullYear() * 12 + to.getMonth();
  while (cursor.getFullYear() * 12 + cursor.getMonth() <= endMonth) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const entry = byDate.get(key) ?? { pro: 0, ultra: 0 };
    result.push({ date: key, pro: entry.pro, ultra: entry.ultra });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return result;
}

export async function getRecentSubscriptions(
  ctx: ProtectedTRPCContext,
  input: GetRecentSubscriptionsInput,
) {
  const rows = await ctx.prisma.subscription.findMany({
    where: { plan: { in: PAID_PLANS as SubscriptionPlan[] } },
    select: {
      id: true,
      userId: true,
      plan: true,
      status: true,
      createdAt: true,
      renewsAt: true,
      endsAt: true,
      user: { select: { name: true, email: true, image: true } },
    },
    orderBy: { createdAt: "desc" },
    take: input.limit,
  });

  return rows.map((r) => {
    const { user, ...rest } = r;
    return {
      ...rest,
      userName: user?.name ?? null,
      userEmail: user?.email ?? null,
      userImage: user?.image ?? null,
    };
  });
}
