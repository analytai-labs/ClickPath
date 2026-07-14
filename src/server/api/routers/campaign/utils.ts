import { TRPCError } from "@trpc/server";
import { endOfMonth, endOfYear, startOfMonth, startOfYear, subDays, subMonths } from "date-fns";

import { getCampaignLimit } from "@/lib/billing/plans";

import type { Campaign } from "@prisma/client";
import type { WorkspaceTRPCContext } from "../../trpc";
import type { RangeEnum } from "../link/link.input";

export type UtmParams = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
};

export { normalizeCampaignSlug } from "@/lib/campaigns/slug";

export function normalizeUtmValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 255);
  return normalized === "" ? null : normalized;
}

export function mergeCampaignUtm(
  campaignRow: Pick<Campaign, "slug" | "utmSource" | "utmMedium" | "utmTerm" | "utmContent">,
  existing?: UtmParams | null,
): UtmParams | undefined {
  const defaults: UtmParams = {};
  if (campaignRow.slug) defaults.utm_campaign = campaignRow.slug;
  if (campaignRow.utmSource) defaults.utm_source = campaignRow.utmSource;
  if (campaignRow.utmMedium) defaults.utm_medium = campaignRow.utmMedium;
  if (campaignRow.utmTerm) defaults.utm_term = campaignRow.utmTerm;
  if (campaignRow.utmContent) defaults.utm_content = campaignRow.utmContent;

  const merged: UtmParams = { ...defaults };
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      merged[key as keyof UtmParams] = value;
    }
  }
  if (campaignRow.slug) merged.utm_campaign = campaignRow.slug;

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function rethrowCampaignDuplicate(error: unknown): never {
  const message = String((error as { message?: string })?.message ?? "");
  if (
    /campaign_slug_workspace_unique/.test(message) ||
    /Unique constraint failed on the fields: \(`slug`,`userId`,`teamId`\)/.test(message)
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Another campaign already uses this slug. Reusing a utm_campaign value would mix their analytics.",
    });
  }
  throw error;
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

export function utmParamsEqual(a?: UtmParams | null, b?: UtmParams | null): boolean {
  return UTM_KEYS.every((key) => (a?.[key] ?? "") === (b?.[key] ?? ""));
}

export function getCampaignDisplayState(
  row: Pick<Campaign, "status" | "startDate" | "endDate">,
  now: Date = new Date(),
): "active" | "archived" | "scheduled" | "ended" {
  if (row.status === "archived") return "archived";
  if (row.startDate && row.startDate.getTime() > now.getTime()) return "scheduled";
  if (row.endDate && row.endDate.getTime() < now.getTime()) return "ended";
  return "active";
}

const getWorkspaceWhere = (workspace: WorkspaceTRPCContext["workspace"]) =>
  workspace.type === "team"
    ? { teamId: workspace.teamId }
    : { userId: workspace.userId, teamId: null };

export async function checkCampaignLimit(ctx: WorkspaceTRPCContext): Promise<void> {
  const limit = getCampaignLimit(ctx.workspace.plan);
  if (limit === undefined) return; // unlimited (Ultra / team workspaces)

  const current = await ctx.prisma.campaign.count({
    where: {
      ...getWorkspaceWhere(ctx.workspace),
      status: "active",
    },
  });

  if (current >= limit) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        ctx.workspace.plan === "free"
          ? `You've reached the free plan limit of ${limit} active campaign. Upgrade to Pro for more.`
          : `You've reached your plan's limit of ${limit} active campaigns. Upgrade to Ultra for unlimited campaigns.`,
    });
  }
}

export function resolveRangeWindow(range: RangeEnum): { start: Date; end: Date } {
  const now = new Date();
  switch (range) {
    case "24h":
      return { start: subDays(now, 1), end: now };
    case "7d":
      return { start: subDays(now, 7), end: now };
    case "30d":
      return { start: subDays(now, 30), end: now };
    case "90d":
      return { start: subDays(now, 90), end: now };
    case "this_month":
      return { start: startOfMonth(now), end: now };
    case "last_month": {
      const lastMonth = subMonths(now, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    }
    case "this_year":
      return { start: startOfYear(now), end: now };
    case "last_year": {
      const lastYear = subDays(now, 365);
      return { start: startOfYear(lastYear), end: endOfYear(lastYear) };
    }
    case "all":
      return { start: new Date(0), end: now };
    default:
      return { start: subDays(now, 7), end: now };
  }
}
