import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { canUseCampaignUtmDefaults } from "@/lib/billing/plans";
import { buildCacheKey, deleteFromCache } from "@/lib/core/cache";
import { isWorkspaceAdmin, requirePermission, workspaceOwnership } from "@/server/lib/workspace";

import {
  checkCampaignLimit,
  getCampaignDisplayState,
  mergeCampaignUtm,
  normalizeCampaignSlug,
  normalizeUtmValue,
  resolveRangeWindow,
  rethrowCampaignDuplicate,
  utmParamsEqual,
} from "./utils";

import type { Campaign } from "@prisma/client";
import type { WorkspaceTRPCContext } from "../../trpc";
import type {
  AddLinksInput,
  CampaignAnalyticsInput,
  CreateCampaignInput,
  ListCampaignsInput,
  RemoveLinkInput,
  UpdateCampaignInput,
} from "./campaign.input";

const getWorkspaceWhere = (workspace: WorkspaceTRPCContext["workspace"]) =>
  workspace.type === "team"
    ? { teamId: workspace.teamId }
    : { userId: workspace.userId, teamId: null };

async function getPrismaAccessibleFolderIds(
  prisma: PrismaClient,
  workspace: WorkspaceTRPCContext["workspace"],
  teamFolderIds: number[],
): Promise<number[]> {
  if (teamFolderIds.length === 0) return [];
  if (workspace.type === "personal" || isWorkspaceAdmin(workspace)) return teamFolderIds;

  const folders = await prisma.folder.findMany({
    where: { id: { in: teamFolderIds } },
    select: { id: true, isRestricted: true },
  });

  const folderRestrictionMap = new Map<number, boolean>();
  for (const f of folders) folderRestrictionMap.set(f.id, f.isRestricted);

  const restrictedFolderIds = folders.filter((f) => f.isRestricted).map((f) => f.id);
  const allPermissions =
    restrictedFolderIds.length > 0
      ? await prisma.folderPermission.findMany({
          where: { folderId: { in: restrictedFolderIds } },
        })
      : [];

  const folderPermissionMap = new Map<number, string[]>();
  for (const perm of allPermissions) {
    if (!folderPermissionMap.has(perm.folderId)) {
      folderPermissionMap.set(perm.folderId, []);
    }
    folderPermissionMap.get(perm.folderId)!.push(perm.userId);
  }

  return teamFolderIds.filter((folderId) => {
    const isRestricted = folderRestrictionMap.get(folderId) ?? false;
    if (!isRestricted) return true;
    const permittedUsers = folderPermissionMap.get(folderId);
    if (!permittedUsers || permittedUsers.length === 0) return false;
    return permittedUsers.includes(workspace.userId);
  });
}

async function fetchWorkspaceCampaign(ctx: WorkspaceTRPCContext, id: number): Promise<Campaign> {
  const row = await ctx.prisma.campaign.findFirst({
    where: {
      id,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  }
  return row;
}

async function folderAccessCondition(
  ctx: WorkspaceTRPCContext,
): Promise<Prisma.LinkWhereInput | undefined> {
  if (ctx.workspace.type !== "team" || isWorkspaceAdmin(ctx.workspace)) return undefined;

  const allFolders = await ctx.prisma.folder.findMany({
    where: getWorkspaceWhere(ctx.workspace),
    select: { id: true },
  });
  const accessibleFolderIds = await getPrismaAccessibleFolderIds(
    ctx.prisma as PrismaClient,
    ctx.workspace,
    allFolders.map((f) => f.id),
  );

  return accessibleFolderIds.length > 0
    ? { OR: [{ folderId: { in: accessibleFolderIds } }, { folderId: null }] }
    : { folderId: null };
}

async function memberLinkConditions(
  ctx: WorkspaceTRPCContext,
  campaignId: number,
): Promise<Prisma.LinkWhereInput> {
  const condition: Prisma.LinkWhereInput = {
    campaignId,
    ...getWorkspaceWhere(ctx.workspace),
    isBioLink: false,
  };

  const folderCondition = await folderAccessCondition(ctx);
  if (folderCondition) {
    return { AND: [condition, folderCondition] };
  }
  return condition;
}

async function assertNoDuplicate(
  ctx: WorkspaceTRPCContext,
  values: { name?: string; slug?: string },
  excludeId?: number,
): Promise<void> {
  const scope = getWorkspaceWhere(ctx.workspace);
  if (values.name) {
    const existing = await ctx.prisma.campaign.findFirst({
      where: {
        ...scope,
        name: values.name,
      },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A campaign with this name already exists in this workspace.",
      });
    }
  }
  if (values.slug) {
    const existing = await ctx.prisma.campaign.findFirst({
      where: {
        ...scope,
        slug: values.slug,
      },
    });
    if (existing && existing.id !== excludeId) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Another campaign already uses this slug. Reusing a utm_campaign value would mix their analytics.",
      });
    }
  }
}

export async function listCampaigns(ctx: WorkspaceTRPCContext, input: ListCampaignsInput) {
  const condition: Prisma.CampaignWhereInput = {
    ...getWorkspaceWhere(ctx.workspace),
  };
  if (input.status !== "all") {
    condition.status = input.status as any;
  }

  const rows = await ctx.prisma.campaign.findMany({
    where: condition,
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  const folderCondition = await folderAccessCondition(ctx);
  const memberScope: Prisma.LinkWhereInput = {
    campaignId: { in: ids },
    ...getWorkspaceWhere(ctx.workspace),
    isBioLink: false,
  };
  const finalMemberScope = folderCondition ? { AND: [memberScope, folderCondition] } : memberScope;

  const [memberCounts, clickCounts] = await Promise.all([
    ctx.prisma.link.groupBy({
      by: ["campaignId", "isQrCode"],
      where: finalMemberScope,
      _count: true,
    }),
    ctx.prisma.linkVisit
      .groupBy({
        by: ["linkId"],
        where: {
          link: finalMemberScope,
        },
        _count: true,
      })
      .then(async (visits) => {
        const linkIds = visits.map((v) => v.linkId);
        const links = await ctx.prisma.link.findMany({
          where: { id: { in: linkIds } },
          select: { id: true, campaignId: true },
        });
        const map = new Map<number, number>();
        for (const v of visits) {
          const link = links.find((l) => l.id === v.linkId);
          if (link && link.campaignId !== null) {
            map.set(link.campaignId, (map.get(link.campaignId) || 0) + v._count);
          }
        }
        return Array.from(map.entries()).map(([campaignId, count]) => ({ campaignId, count }));
      }),
  ]);

  const linkCountMap = new Map<number, number>();
  const qrCountMap = new Map<number, number>();
  for (const row of memberCounts) {
    if (row.campaignId === null) continue;
    const target = row.isQrCode ? qrCountMap : linkCountMap;
    target.set(row.campaignId, (target.get(row.campaignId) || 0) + row._count);
  }
  const clickMap = new Map(clickCounts.map((r) => [r.campaignId, r.count]));

  return rows.map((row) => ({
    ...row,
    displayState: getCampaignDisplayState(row),
    linkCount: linkCountMap.get(row.id) ?? 0,
    qrCount: qrCountMap.get(row.id) ?? 0,
    totalClicks: clickMap.get(row.id) ?? 0,
  }));
}

export async function listCampaignNames(ctx: WorkspaceTRPCContext) {
  return ctx.prisma.campaign.findMany({
    where: {
      ...getWorkspaceWhere(ctx.workspace),
      status: "active",
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      utmSource: true,
      utmMedium: true,
      utmTerm: true,
      utmContent: true,
    },
  });
}

export async function listLinkCandidates(ctx: WorkspaceTRPCContext) {
  const folderCondition = await folderAccessCondition(ctx);
  const scope: Prisma.LinkWhereInput = {
    ...getWorkspaceWhere(ctx.workspace),
    isBioLink: false,
    archived: false,
  };

  const rows = await ctx.prisma.link.findMany({
    where: folderCondition ? { AND: [scope, folderCondition] } : scope,
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      name: true,
      alias: true,
      domain: true,
      isQrCode: true,
      campaignId: true,
    },
  });

  return rows;
}

export async function getCampaign(ctx: WorkspaceTRPCContext, id: number) {
  const row = await fetchWorkspaceCampaign(ctx, id);
  return assembleCampaign(ctx, row);
}

export async function getCampaignBySlug(ctx: WorkspaceTRPCContext, slug: string) {
  const row = await ctx.prisma.campaign.findFirst({
    where: {
      slug,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  }
  return assembleCampaign(ctx, row);
}

async function assembleCampaign(ctx: WorkspaceTRPCContext, row: Campaign) {
  const condition = await memberLinkConditions(ctx, row.id);
  const members = await ctx.prisma.link.findMany({
    where: condition,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      alias: true,
      domain: true,
      url: true,
      isQrCode: true,
      archived: true,
      utmParams: true,
      createdAt: true,
    },
  });

  const memberIds = members.map((m) => m.id);
  const clickRows = memberIds.length
    ? await ctx.prisma.linkVisit.groupBy({
        by: ["linkId"],
        where: { linkId: { in: memberIds } },
        _count: true,
      })
    : [];
  const clickMap = new Map(clickRows.map((r) => [r.linkId, r._count]));

  return {
    ...row,
    displayState: getCampaignDisplayState(row),
    canUseUtmDefaults: canUseCampaignUtmDefaults(ctx.workspace.plan),
    links: members.map((member) => ({
      ...member,
      clicks: clickMap.get(member.id) ?? 0,
    })),
  };
}

export async function createCampaign(ctx: WorkspaceTRPCContext, input: CreateCampaignInput) {
  requirePermission(ctx.workspace, "campaigns.create", "create campaigns");
  await checkCampaignLimit(ctx);

  const slug = normalizeCampaignSlug(input.slug ?? input.name);
  if (!slug) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The campaign slug must contain letters or numbers.",
    });
  }

  await assertNoDuplicate(ctx, { name: input.name, slug });

  const ownership = workspaceOwnership(ctx.workspace);
  try {
    const result = await ctx.prisma.campaign.create({
      data: {
        name: input.name,
        slug,
        description: input.description,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        userId: ownership.userId,
        teamId: ownership.teamId,
        createdByUserId: ctx.auth.userId,
      },
    });

    return { id: result.id, slug };
  } catch (error) {
    rethrowCampaignDuplicate(error);
  }
}

export async function updateCampaign(ctx: WorkspaceTRPCContext, input: UpdateCampaignInput) {
  requirePermission(ctx.workspace, "campaigns.edit", "edit campaigns");
  const existing = await fetchWorkspaceCampaign(ctx, input.id);

  if (input.status === "active" && existing.status === "archived") {
    await checkCampaignLimit(ctx);
  }

  const utmInputs = {
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmTerm: input.utmTerm,
    utmContent: input.utmContent,
  };
  const touchesUtm = Object.values(utmInputs).some((value) => value !== undefined);
  if (touchesUtm && !canUseCampaignUtmDefaults(ctx.workspace.plan)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Campaign UTM defaults are available on Pro and Ultra. Upgrade to use them.",
    });
  }

  const slug = input.slug !== undefined ? normalizeCampaignSlug(input.slug) : undefined;
  if (slug === "") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The campaign slug must contain letters or numbers.",
    });
  }

  await assertNoDuplicate(
    ctx,
    {
      name: input.name !== undefined && input.name !== existing.name ? input.name : undefined,
      slug: slug !== undefined && slug !== existing.slug ? slug : undefined,
    },
    existing.id,
  );

  try {
    await ctx.prisma.campaign.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        slug,
        description: input.description,
        status: input.status !== undefined ? (input.status as any) : undefined,
        startDate: input.startDate,
        endDate: input.endDate,
        utmSource: input.utmSource !== undefined ? normalizeUtmValue(input.utmSource) : undefined,
        utmMedium: input.utmMedium !== undefined ? normalizeUtmValue(input.utmMedium) : undefined,
        utmTerm: input.utmTerm !== undefined ? normalizeUtmValue(input.utmTerm) : undefined,
        utmContent:
          input.utmContent !== undefined ? normalizeUtmValue(input.utmContent) : undefined,
      },
    });
  } catch (error) {
    rethrowCampaignDuplicate(error);
  }

  return { id: existing.id, slug: slug ?? existing.slug };
}

export async function deleteCampaign(ctx: WorkspaceTRPCContext, id: number) {
  requirePermission(ctx.workspace, "campaigns.delete", "delete campaigns");
  const existing = await fetchWorkspaceCampaign(ctx, id);

  await ctx.prisma.$transaction([
    ctx.prisma.link.updateMany({
      where: { campaignId: existing.id },
      data: { campaignId: null },
    }),
    ctx.prisma.campaign.delete({
      where: { id: existing.id },
    }),
  ]);

  return { id: existing.id };
}

export async function addLinks(ctx: WorkspaceTRPCContext, input: AddLinksInput) {
  requirePermission(ctx.workspace, "campaigns.edit", "edit campaigns");
  const row = await fetchWorkspaceCampaign(ctx, input.id);

  if (row.status === "archived") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This campaign is archived. Restore it before adding links.",
    });
  }

  if (input.applyUtmDefaults && !canUseCampaignUtmDefaults(ctx.workspace.plan)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Campaign UTM defaults are available on Pro and Ultra. Upgrade to use them.",
    });
  }

  const folderCondition = await folderAccessCondition(ctx);
  const candidateScope: Prisma.LinkWhereInput = {
    id: { in: input.linkIds },
    ...getWorkspaceWhere(ctx.workspace),
    isBioLink: false,
  };

  const candidates = await ctx.prisma.link.findMany({
    where: folderCondition ? { AND: [candidateScope, folderCondition] } : candidateScope,
    select: { id: true, alias: true, domain: true, utmParams: true },
  });
  if (candidates.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No eligible links to add." });
  }

  await ctx.prisma.link.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: { campaignId: row.id },
  });

  if (input.applyUtmDefaults) {
    await Promise.all(
      candidates.map(async (candidate) => {
        const merged = mergeCampaignUtm(row, candidate.utmParams as any);
        if (!merged || utmParamsEqual(merged, candidate.utmParams as any)) return;
        await ctx.prisma.link.update({
          where: { id: candidate.id },
          data: { utmParams: merged as any },
        });
        if (candidate.alias) {
          await deleteFromCache(buildCacheKey(candidate.domain, candidate.alias));
        }
      }),
    );
  }

  return { added: candidates.length };
}

export async function removeLink(ctx: WorkspaceTRPCContext, input: RemoveLinkInput) {
  requirePermission(ctx.workspace, "campaigns.edit", "edit campaigns");
  await fetchWorkspaceCampaign(ctx, input.id);

  const folderCondition = await folderAccessCondition(ctx);
  const scope: Prisma.LinkWhereInput = {
    id: input.linkId,
    campaignId: input.id,
    ...getWorkspaceWhere(ctx.workspace),
  };

  await ctx.prisma.link.updateMany({
    where: folderCondition ? { AND: [scope, folderCondition] } : scope,
    data: { campaignId: null },
  });

  return { removed: input.linkId };
}

const BREAKDOWN_LIMIT = 10;

export async function getCampaignAnalytics(
  ctx: WorkspaceTRPCContext,
  input: CampaignAnalyticsInput,
) {
  const row = await fetchWorkspaceCampaign(ctx, input.id);
  const plan = ctx.workspace.plan;
  const isProPlan = plan !== "free";

  const range = !isProPlan && !["24h", "7d"].includes(input.range) ? "7d" : input.range;
  const { start, end } = resolveRangeWindow(range);
  const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));

  const condition = await memberLinkConditions(ctx, row.id);
  const members = await ctx.prisma.link.findMany({
    where: condition,
    select: {
      id: true,
      name: true,
      alias: true,
      domain: true,
      url: true,
      isQrCode: true,
      utmParams: true,
    },
  });

  const emptyPayload = {
    totals: { clicks: 0, scans: 0, engagements: 0, uniqueVisitors: 0, prevEngagements: 0 },
    series: [] as { date: string; clicks: number; scans: number }[],
    links: [] as {
      id: number;
      name: string | null;
      alias: string | null;
      domain: string;
      url: string | null;
      isQrCode: boolean | null;
      clicks: number;
      share: number;
    }[],
    channels: {} as Record<string, number>,
    countries: {} as Record<string, number>,
    devices: {} as Record<string, number>,
    referrers: {} as Record<string, number>,
    range,
    isProPlan,
  };
  if (members.length === 0) return emptyPayload;

  const memberIds = members.map((m) => m.id);
  const inWindow: Prisma.LinkVisitWhereInput = {
    linkId: { in: memberIds },
    createdAt: { gte: start, lte: end },
  };

  // We fetch visits in memory because Drizzle was doing a huge series of complex raw aggregations.
  // Prisma doesn't natively support `DATE(createdAt)` inside `groupBy` out of the box in a type-safe way.
  const [prevTotal, uniqueVisitorsRows, perLinkRows, visits] = await Promise.all([
    ctx.prisma.linkVisit.count({
      where: {
        linkId: { in: memberIds },
        createdAt: { gte: prevStart, lt: start },
      },
    }),
    ctx.prisma.uniqueLinkVisit.groupBy({
      by: ["ipHash"],
      where: {
        linkId: { in: memberIds },
        createdAt: { gte: start, lte: end },
      },
    }),
    ctx.prisma.linkVisit.groupBy({
      by: ["linkId"],
      where: inWindow,
      _count: true,
    }),
    ctx.prisma.linkVisit.findMany({
      where: inWindow,
      select: {
        link: { select: { isQrCode: true } },
        createdAt: true,
        country: true,
        device: true,
        referer: true,
      },
    }),
  ]);

  let clicks = 0;
  let scans = 0;
  const seriesMap = new Map<string, { date: string; clicks: number; scans: number }>();

  const countryMap = new Map<string, number>();
  const deviceMap = new Map<string, number>();
  const refererMap = new Map<string, number>();

  for (const v of visits) {
    if (v.link?.isQrCode) scans++;
    else clicks++;

    const dateStr = v.createdAt
      ? (v.createdAt.toISOString().split("T")[0] ?? "Unknown")
      : "Unknown";
    const entry = seriesMap.get(dateStr) ?? { date: dateStr, clicks: 0, scans: 0 };
    if (v.link?.isQrCode) entry.scans++;
    else entry.clicks++;
    seriesMap.set(dateStr, entry);

    const country = v.country && v.country !== "" ? v.country : "Unknown";
    countryMap.set(country, (countryMap.get(country) || 0) + 1);

    const device = v.device && v.device !== "" ? v.device : "Unknown";
    deviceMap.set(device, (deviceMap.get(device) || 0) + 1);

    const referer = v.referer && v.referer !== "" ? v.referer : "Unknown";
    refererMap.set(referer, (refererMap.get(referer) || 0) + 1);
  }

  const engagements = clicks + scans;
  const series = [...seriesMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const perLinkMap = new Map(perLinkRows.map((r) => [r.linkId, r._count]));
  const links = members
    .map((member) => {
      const memberClicks = perLinkMap.get(member.id) ?? 0;
      return {
        id: member.id,
        name: member.name,
        alias: member.alias,
        domain: member.domain,
        url: member.url,
        isQrCode: member.isQrCode,
        clicks: memberClicks,
        share: engagements > 0 ? memberClicks / engagements : 0,
      };
    })
    .sort((a, b) => b.clicks - a.clicks);

  const channels: Record<string, number> = {};
  for (const member of members) {
    const params = member.utmParams as Record<string, string> | null;
    const source = params?.utm_source?.trim();
    const key = member.isQrCode ? "qr" : source && source !== "" ? source : "untagged";
    channels[key] = (channels[key] ?? 0) + (perLinkMap.get(member.id) ?? 0);
  }

  const toRecord = (map: Map<string, number>): Record<string, number> => {
    return Object.fromEntries(
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, BREAKDOWN_LIMIT),
    );
  };

  return {
    totals: {
      clicks,
      scans,
      engagements,
      uniqueVisitors: uniqueVisitorsRows.length,
      prevEngagements: prevTotal,
    },
    series,
    links,
    channels,
    countries: toRecord(countryMap),
    devices: toRecord(deviceMap),
    referrers: toRecord(refererMap),
    range,
    isProPlan,
  };
}
