import { prisma } from "@/server/db";

// Grace period in days before permanently deleting soft-deleted teams
const GRACE_PERIOD_DAYS = 30;

interface CleanupResult {
  teamsDeleted: number;
  linksDeleted: number;
  linkVisitsDeleted: number;
  uniqueLinkVisitsDeleted: number;
  foldersDeleted: number;
  qrCodesDeleted: number;
  tagsDeleted: number;
  linkTagsDeleted: number;
  customDomainsDeleted: number;
  utmTemplatesDeleted: number;
  campaignsDeleted: number;
  siteSettingsDeleted: number;
}

/**
 * Clean up soft-deleted teams that have passed the grace period.
 * This permanently deletes the team and all associated resources.
 *
 * Should be called by a cron job with API key authentication.
 */
export async function cleanupDeletedTeams(): Promise<CleanupResult> {
  const result: CleanupResult = {
    teamsDeleted: 0,
    linksDeleted: 0,
    linkVisitsDeleted: 0,
    uniqueLinkVisitsDeleted: 0,
    foldersDeleted: 0,
    qrCodesDeleted: 0,
    tagsDeleted: 0,
    linkTagsDeleted: 0,
    customDomainsDeleted: 0,
    utmTemplatesDeleted: 0,
    campaignsDeleted: 0,
    siteSettingsDeleted: 0,
  };

  // Calculate the cutoff date (teams deleted before this date should be cleaned up)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - GRACE_PERIOD_DAYS);

  // Find all teams that are soft-deleted and past the grace period
  const teamsToDelete = await prisma.team.findMany({
    where: {
      deletedAt: {
        not: null,
        lt: cutoffDate,
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      deletedAt: true,
    },
  });

  if (teamsToDelete.length === 0) {
    return result;
  }

  // Process each team
  for (const teamRecord of teamsToDelete) {
    const teamId = teamRecord.id;

    // Use a transaction to ensure atomic deletion of all resources
    await prisma.$transaction(async (tx) => {
      // 1. Get all links for this team to delete their related records
      const teamLinks = await tx.link.findMany({
        where: { teamId },
        select: { id: true },
      });

      const linkIds = teamLinks.map((l) => l.id);

      if (linkIds.length > 0) {
        // Delete link visits
        const linkVisitResult = await tx.linkVisit.deleteMany({
          where: { linkId: { in: linkIds } },
        });
        result.linkVisitsDeleted += linkVisitResult.count;

        // Delete unique link visits
        const uniqueVisitResult = await tx.uniqueLinkVisit.deleteMany({
          where: { linkId: { in: linkIds } },
        });
        result.uniqueLinkVisitsDeleted += uniqueVisitResult.count;

        // Delete link-tag associations
        const linkTagResult = await tx.linkTag.deleteMany({
          where: { linkId: { in: linkIds } },
        });
        result.linkTagsDeleted += linkTagResult.count;
      }

      // 2. Delete all links
      const linksResult = await tx.link.deleteMany({
        where: { teamId },
      });
      result.linksDeleted += linksResult.count;

      // 3. Delete all folders
      const foldersResult = await tx.folder.deleteMany({
        where: { teamId },
      });
      result.foldersDeleted += foldersResult.count;

      // 4. Delete all QR codes
      const qrCodesResult = await tx.qrCode.deleteMany({
        where: { teamId },
      });
      result.qrCodesDeleted += qrCodesResult.count;

      // 5. Delete all tags
      const tagsResult = await tx.tag.deleteMany({
        where: { teamId },
      });
      result.tagsDeleted += tagsResult.count;

      // 6. Delete all custom domains
      const domainsResult = await tx.customDomain.deleteMany({
        where: { teamId },
      });
      result.customDomainsDeleted += domainsResult.count;

      // 7. Delete all UTM templates
      const utmResult = await tx.utmTemplate.deleteMany({
        where: { teamId },
      });
      result.utmTemplatesDeleted += utmResult.count;

      // 8. Delete all campaigns (member links were already deleted above)
      const campaignsResult = await tx.campaign.deleteMany({
        where: { teamId },
      });
      result.campaignsDeleted += campaignsResult.count;

      // 9. Delete site settings
      const settingsResult = await tx.siteSettings.deleteMany({
        where: { teamId },
      });
      result.siteSettingsDeleted += settingsResult.count;

      // 10. Finally, delete the team itself
      await tx.team.delete({
        where: { id: teamId },
      });
      result.teamsDeleted += 1;
    });
  }

  return result;
}

/**
 * Get stats about teams pending cleanup (for monitoring)
 */
export async function getCleanupStats() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - GRACE_PERIOD_DAYS);

  // Teams ready for cleanup (past grace period)
  const readyForCleanup = await prisma.team.count({
    where: {
      deletedAt: {
        not: null,
        lt: cutoffDate,
      },
    },
  });

  // Teams in grace period (deleted but not yet ready for cleanup)
  const inGracePeriod = await prisma.team.count({
    where: {
      deletedAt: {
        not: null,
        gte: cutoffDate,
      },
    },
  });

  // Active teams
  const activeTeams = await prisma.team.count({
    where: {
      deletedAt: null,
    },
  });

  return {
    readyForCleanup,
    inGracePeriod,
    activeTeams,
    gracePeriodDays: GRACE_PERIOD_DAYS,
  };
}
