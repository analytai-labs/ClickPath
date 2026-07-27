import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";
import { sendDomainReminderEmail } from "@/server/lib/notifications/domain-reminder";

const log = logger.child({ component: "domain-reminder" });

// Reminder throttle: don't send more than once per 7 days
const REMINDER_INTERVAL_DAYS = 7;



import { getCustomHostnameFromCloudflare } from "./utils";

/**
 * Verify domain status with Cloudflare APIs.
 * Returns true if domain is actually valid (verified and active).
 */
async function verifyDomainWithCloudflare(domain: string): Promise<boolean> {
  try {
    const cfDomain = await getCustomHostnameFromCloudflare(domain);

    if (!cfDomain) {
      log.error({ domain }, "Cloudflare API check failed or domain not found");
      return false;
    }

    // Domain is valid if it's active and ssl is active
    const isValid = cfDomain.status === "active" && cfDomain.ssl.status === "active";

    log.debug(
      {
        domain,
        status: cfDomain.status,
        sslStatus: cfDomain.ssl.status,
        isValid,
      },
      "Cloudflare domain check result",
    );

    return isValid;
  } catch (error) {
    log.error({ err: error, domain }, "error checking Cloudflare API");
    // On error, assume domain is still invalid to be safe
    return false;
  }
}

type Challenge = {
  type: "TXT" | "A" | "CNAME";
  domain: string;
  value: string;
};

interface ReminderResult {
  domainsChecked: number;
  remindersSent: number;
  domainsUpdatedToActive: number;
  errors: Array<{ domain: string; error: string }>;
}

/**
 * Parse verification details from JSON storage.
 * Handles both stringified JSON and already-parsed arrays.
 */
function parseVerificationDetails(verificationDetails: unknown): Challenge[] {
  try {
    if (Array.isArray(verificationDetails)) {
      return verificationDetails as Challenge[];
    }
    if (typeof verificationDetails === "string") {
      return JSON.parse(verificationDetails) as Challenge[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Calculate the number of days since a given date.
 */
function calculateDaysSince(date: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Send configuration reminder emails for domains with 'invalid' status.
 * Only sends reminders to domains that haven't received one in the past 7 days.
 *
 * For personal workspaces: sends to the user who owns the domain
 * For team workspaces: sends to the team owner
 */
export async function sendDomainConfigurationReminders(): Promise<ReminderResult> {
  const result: ReminderResult = {
    domainsChecked: 0,
    remindersSent: 0,
    domainsUpdatedToActive: 0,
    errors: [],
  };

  // Calculate cutoff date for reminder throttling
  const reminderCutoffDate = new Date();
  reminderCutoffDate.setDate(reminderCutoffDate.getDate() - REMINDER_INTERVAL_DAYS);

  // Query all invalid domains that need reminders
  // Conditions:
  // 1. status = 'invalid'
  // 2. lastReminderSentAt is NULL (never reminded) OR older than 7 days ago
  const invalidDomains = await prisma.customDomain.findMany({
    where: {
      status: "invalid",
      OR: [{ lastReminderSentAt: null }, { lastReminderSentAt: { lt: reminderCutoffDate } }],
    },
    include: {
      user: {
        select: { email: true, name: true },
      },
    },
  });

  result.domainsChecked = invalidDomains.length;

  if (invalidDomains.length === 0) {
    log.debug("no domains need reminders");
    return result;
  }

  // Process each domain
  for (const domainRecord of invalidDomains) {
    const domainName = domainRecord.domain ?? "unknown";

    try {
      // First, verify with Cloudflare API if the domain is actually invalid
      // This prevents sending emails to users who have already fixed their domain configuration
      const isActuallyValid = await verifyDomainWithCloudflare(domainName);

      if (isActuallyValid) {
        // Domain is now valid according to Vercel, update our database and skip sending email
        await prisma.customDomain.update({
          where: { id: domainRecord.id },
          data: { status: "active" },
        });

        result.domainsUpdatedToActive++;
        log.info({ domain: domainName }, "domain now valid, updated status to 'active'");
        continue;
      }

      // Determine recipient based on workspace type
      let recipientEmail: string | null = null;
      let recipientName: string | null = null;

      if (domainRecord.teamId) {
        // Team workspace: get team owner's email
        const teamRecord = await prisma.team.findFirst({
          where: { id: domainRecord.teamId },
          select: { ownerId: true },
        });

        if (teamRecord) {
          const ownerRecord = await prisma.user.findFirst({
            where: { id: teamRecord.ownerId },
            select: { email: true, name: true },
          });

          if (ownerRecord) {
            recipientEmail = ownerRecord.email;
            recipientName = ownerRecord.name;
          }
        }
      } else {
        // Personal workspace: use the user's email
        recipientEmail = domainRecord.user?.email ?? null;
        recipientName = domainRecord.user?.name ?? null;
      }

      if (!recipientEmail) {
        log.warn({ domain: domainName }, "no recipient email found");
        result.errors.push({
          domain: domainName,
          error: "No recipient email found",
        });
        continue;
      }

      // Parse verification challenges
      const challenges = parseVerificationDetails(domainRecord.verificationDetails);

      if (challenges.length === 0) {
        log.warn({ domain: domainName }, "no verification challenges found");
        result.errors.push({
          domain: domainName,
          error: "No verification challenges found",
        });
        continue;
      }

      // Calculate days misconfigured
      const daysMisconfigured = domainRecord.createdAt
        ? calculateDaysSince(new Date(domainRecord.createdAt))
        : 0;

      // Send the reminder email
      await sendDomainReminderEmail({
        email: recipientEmail,
        recipientName,
        domain: domainName,
        daysMisconfigured,
        challenges,
      });

      // Update lastReminderSentAt after successful send
      await prisma.customDomain.update({
        where: { id: domainRecord.id },
        data: { lastReminderSentAt: new Date() },
      });

      result.remindersSent++;
      log.info({ domain: domainName, recipientEmail }, "reminder sent");
    } catch (error) {
      log.error({ err: error, domain: domainName }, "reminder processing failed");
      result.errors.push({
        domain: domainName,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return result;
}

/**
 * Get stats about domains that may need reminders (for monitoring).
 */
export async function getDomainReminderStats() {
  const reminderCutoffDate = new Date();
  reminderCutoffDate.setDate(reminderCutoffDate.getDate() - REMINDER_INTERVAL_DAYS);

  // Domains needing reminders
  const needingReminders = await prisma.customDomain.count({
    where: {
      status: "invalid",
      OR: [{ lastReminderSentAt: null }, { lastReminderSentAt: { lt: reminderCutoffDate } }],
    },
  });

  // Total invalid domains
  const totalInvalid = await prisma.customDomain.count({
    where: { status: "invalid" },
  });

  // Recently reminded (within last 7 days)
  const recentlyReminded = await prisma.customDomain.count({
    where: {
      status: "invalid",
      lastReminderSentAt: { gte: reminderCutoffDate },
    },
  });

  return {
    needingReminders,
    totalInvalid,
    recentlyReminded,
    reminderIntervalDays: REMINDER_INTERVAL_DAYS,
  };
}
