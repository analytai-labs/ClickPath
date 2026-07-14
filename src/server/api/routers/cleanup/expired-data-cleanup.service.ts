import { prisma } from "@/server/db";

// Invalid domain retention: 30 days before cleanup
const INVALID_DOMAIN_RETENTION_DAYS = 30;

interface ExpiredDataCleanupResult {
  expiredInvitesDeleted: number;
  invalidDomainsDeleted: number;
}

/**
 * Clean up expired data:
 * - Team invites that have expired (past their expiresAt date)
 * - Custom domains with 'invalid' status older than 30 days
 *
 * Should be called by a daily cron job.
 */
export async function cleanupExpiredData(): Promise<ExpiredDataCleanupResult> {
  const result: ExpiredDataCleanupResult = {
    expiredInvitesDeleted: 0,
    invalidDomainsDeleted: 0,
  };

  const now = new Date();

  // Calculate cutoff date for invalid domains
  const invalidDomainCutoffDate = new Date();
  invalidDomainCutoffDate.setDate(
    invalidDomainCutoffDate.getDate() - INVALID_DOMAIN_RETENTION_DAYS,
  );

  // Delete expired team invites (expiresAt has passed and not accepted)
  const expiredInvitesResult = await prisma.teamInvite.deleteMany({
    where: {
      expiresAt: { lt: now },
      acceptedAt: null,
    },
  });
  result.expiredInvitesDeleted = expiredInvitesResult.count;

  // Delete invalid custom domains older than 30 days
  // These are domains that users added but never configured properly
  const invalidDomainsResult = await prisma.customDomain.deleteMany({
    where: {
      status: "invalid",
      createdAt: { lt: invalidDomainCutoffDate },
    },
  });
  result.invalidDomainsDeleted = invalidDomainsResult.count;

  return result;
}

/**
 * Get stats about expired data pending cleanup (for monitoring)
 */
export async function getExpiredDataCleanupStats() {
  const now = new Date();

  const invalidDomainCutoffDate = new Date();
  invalidDomainCutoffDate.setDate(
    invalidDomainCutoffDate.getDate() - INVALID_DOMAIN_RETENTION_DAYS,
  );

  // Count expired invites
  const expiredInvites = await prisma.teamInvite.count({
    where: {
      expiresAt: { lt: now },
      acceptedAt: null,
    },
  });

  // Count invalid domains older than retention period
  const invalidDomains = await prisma.customDomain.count({
    where: {
      status: "invalid",
      createdAt: { lt: invalidDomainCutoffDate },
    },
  });

  // Count all pending invites (not yet expired)
  const pendingInvites = await prisma.teamInvite.count({
    where: {
      expiresAt: { gte: now },
      acceptedAt: null,
    },
  });

  return {
    expiredInvitesCount: expiredInvites,
    invalidDomainsCount: invalidDomains,
    pendingInvitesCount: pendingInvites,
    invalidDomainRetentionDays: INVALID_DOMAIN_RETENTION_DAYS,
  };
}
