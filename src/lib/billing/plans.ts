import type { Subscription } from "@prisma/client";

export type Plan = "free" | "pro" | "ultra";
export type BillingInterval = "monthly" | "annual";

type PlanCaps = {
  eventsLimit?: number; // undefined => unlimited
  linksLimit?: number;
  folderLimit?: number;
  analyticsRangeLimitDays?: number;
  domainLimit?: number;
  geoRulesLimit?: number; // Max geo rules per link (undefined => unlimited)
  milestonesPerLinkLimit?: number; // Max milestones per link (undefined => unlimited)
  bioPageLimit?: number; // Max bio pages (undefined => unlimited)
  campaignLimit?: number; // Max ACTIVE campaigns (archived don't count; undefined => unlimited)
};

// Stripe Price IDs per plan + billing interval.
// In a real app, these should be env vars.
const PRO_MONTHLY_PRICE_ID = "price_pro_monthly";
const PRO_ANNUAL_PRICE_ID = "price_pro_annual";
const ULTRA_MONTHLY_PRICE_ID = "price_ultra_monthly";
const ULTRA_ANNUAL_PRICE_ID = "price_ultra_annual";

// Recognition sets for getPlanFromIds.
const PRO_PRICE_IDS = new Set([PRO_MONTHLY_PRICE_ID, PRO_ANNUAL_PRICE_ID]);
const ULTRA_PRICE_IDS = new Set([ULTRA_MONTHLY_PRICE_ID, ULTRA_ANNUAL_PRICE_ID]);

const ANNUAL_PRICE_IDS = new Set([PRO_ANNUAL_PRICE_ID, ULTRA_ANNUAL_PRICE_ID]);

export const PLAN_PRICE_IDS: Record<Exclude<Plan, "free">, Record<BillingInterval, string>> = {
  pro: { monthly: PRO_MONTHLY_PRICE_ID, annual: PRO_ANNUAL_PRICE_ID },
  ultra: { monthly: ULTRA_MONTHLY_PRICE_ID, annual: ULTRA_ANNUAL_PRICE_ID },
};

export function getStripePriceId(plan: Exclude<Plan, "free">, interval: BillingInterval): string {
  return PLAN_PRICE_IDS[plan][interval];
}

export function getIntervalFromPriceId(priceId?: string | null): BillingInterval {
  return priceId && ANNUAL_PRICE_IDS.has(priceId) ? "annual" : "monthly";
}

export const PLAN_CAPS: Record<Plan, PlanCaps> = {
  free: {
    eventsLimit: 1000,
    linksLimit: 30,
    folderLimit: 0,
    analyticsRangeLimitDays: 7,
    geoRulesLimit: 0, // Geotargeting not available for free plan
    milestonesPerLinkLimit: 0,
    bioPageLimit: 1,
    campaignLimit: 1,
  },
  pro: {
    eventsLimit: 10000,
    linksLimit: 1000,
    folderLimit: 5,
    domainLimit: 3,
    geoRulesLimit: 3, // Pro plan allows 3 geo rules per link
    milestonesPerLinkLimit: 5,
    bioPageLimit: 3,
    campaignLimit: 2,
  },
  ultra: {
    // unlimited
  },
};

export function getPlanFromPriceId(priceId?: string | null): Plan | null {
  if (priceId && ULTRA_PRICE_IDS.has(priceId)) return "ultra";
  if (priceId && PRO_PRICE_IDS.has(priceId)) return "pro";
  return null;
}

// Lemon Squeezy statuses that grant paid access outright.
const ENTITLED_STATUSES = new Set(["active", "on_trial", "past_due"]);

/**
 * Whether a subscription currently grants paid access. Honors the paid period:
 * active/on_trial/past_due are entitled, and a `cancelled` subscription stays
 * entitled until its `endsAt` passes (users keep access until the end of the
 * period they already paid for).
 */
export function isSubscriptionEntitled(subscription?: Subscription | null): boolean {
  if (!subscription) return false;

  const status = subscription.status ?? "";
  if (ENTITLED_STATUSES.has(status)) return true;

  if (status === "cancelled" && subscription.endsAt) {
    return subscription.endsAt.getTime() > Date.now();
  }

  return false;
}

export function resolvePlan(subscription?: Subscription | null): Plan {
  if (!subscription || !isSubscriptionEntitled(subscription)) {
    return "free";
  }

  const mappedPlan =
    getPlanFromPriceId(subscription.stripePriceId) ?? subscription.plan;

  if (mappedPlan === "ultra" || mappedPlan === "pro") {
    return mappedPlan;
  }

  return "pro"; // entitled subscription without recognized plan defaults to pro
}

export function getPlanCaps(plan: Plan): PlanCaps {
  return PLAN_CAPS[plan];
}

export function isUnlimitedEvents(plan: Plan): boolean {
  return PLAN_CAPS[plan].eventsLimit === undefined;
}

export function isUnlimitedLinks(plan: Plan): boolean {
  return PLAN_CAPS[plan].linksLimit === undefined;
}

export function isUnlimitedFolders(plan: Plan): boolean {
  return PLAN_CAPS[plan].folderLimit === undefined;
}

export function isUnlimitedDomains(plan: Plan): boolean {
  return PLAN_CAPS[plan].domainLimit === undefined;
}

export function getGeoRulesLimit(plan: Plan): number | undefined {
  return PLAN_CAPS[plan].geoRulesLimit;
}

export function isUnlimitedGeoRules(plan: Plan): boolean {
  return PLAN_CAPS[plan].geoRulesLimit === undefined;
}

export function canUseGeoRules(plan: Plan): boolean {
  const limit = PLAN_CAPS[plan].geoRulesLimit;
  return limit === undefined || limit > 0;
}

export function getMilestonesPerLinkLimit(plan: Plan): number | undefined {
  return PLAN_CAPS[plan].milestonesPerLinkLimit;
}

export function canUseMilestones(plan: Plan): boolean {
  const limit = PLAN_CAPS[plan].milestonesPerLinkLimit;
  return limit === undefined || limit > 0;
}

// ----------------------------------------------------------------------------
// Bio pages (link-in-bio)
// ----------------------------------------------------------------------------

export function getBioPageLimit(plan: Plan): number | undefined {
  return PLAN_CAPS[plan].bioPageLimit;
}

/** Pro+ may remove the "Made with ClickPath" badge from their bio page. */
export function canRemoveBioBranding(plan: Plan): boolean {
  return plan !== "free";
}

/** Pro+ may customize bio-page themes beyond the curated presets. */
export function canUseBioCustomThemes(plan: Plan): boolean {
  return plan !== "free";
}

/** Pro+ may serve a bio page on a custom domain. */
export function canUseBioCustomDomain(plan: Plan): boolean {
  return plan !== "free";
}

/** Ultra-only: per-block UTM attribution on bio links. */
export function canUseBioUtmPerBlock(plan: Plan): boolean {
  return plan === "ultra";
}

/** Ultra-only: schedule bio blocks to reveal/hide at set times. */
export function canScheduleBioBlocks(plan: Plan): boolean {
  return plan === "ultra";
}

// ----------------------------------------------------------------------------
// Campaigns
// ----------------------------------------------------------------------------

export function getCampaignLimit(plan: Plan): number | undefined {
  return PLAN_CAPS[plan].campaignLimit;
}

/** Pro+ campaigns carry UTM defaults stamped onto member links at save time. */
export function canUseCampaignUtmDefaults(plan: Plan): boolean {
  return plan !== "free";
}
