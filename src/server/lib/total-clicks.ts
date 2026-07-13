import { prisma } from "@/server/db";

/**
 * Get the true total click count for a link by combining:
 * - Archived clicks from the daily summary table (survives analytics cleanup)
 * - Recent raw clicks not yet rolled up
 */
export async function getTotalClicks(linkId: number): Promise<number> {
  const [summaryResult, rawResult] = await Promise.all([
    prisma.linkVisitDailySummary.aggregate({
      where: { linkId },
      _sum: { clicks: true },
    }),
    prisma.linkVisit.count({
      where: { linkId },
    }),
  ]);

  const archivedClicks = summaryResult._sum.clicks ?? 0;
  const recentClicks = rawResult;
  return archivedClicks + recentClicks;
}
