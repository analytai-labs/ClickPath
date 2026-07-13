import bcrypt from "bcryptjs";
import { parse } from "csv-parse/sync";
import { endOfYear, startOfMonth, startOfYear, subDays } from "date-fns";
import { Prisma } from "@prisma/client";
import {
  canUseCampaignUtmDefaults,
  canUseGeoRules,
  getGeoRulesLimit,
  isUnlimitedGeoRules,
} from "@/lib/billing/plans";
import { assertUrlSafe } from "@/server/lib/phishing";
import { DEFAULT_PLATFORM_DOMAIN } from "@/lib/constants/domains";
import { retrieveDeviceAndGeolocationData } from "@/lib/core/analytics";
import { logger } from "@/lib/logger";
import { hashIp } from "@/lib/utils/ip-hash";
import {
  assertCanEnableVerifiedClicks,
  issueVerifiedClickToken,
} from "@/server/lib/verified-click";
import {
  buildCacheKey,
  deleteFromCache,
  deleteGeoRulesFromCache,
  getFromCache,
  setInCache,
} from "@/lib/core/cache";
import { generateShortLink } from "@/lib/core/links";
import { runBackgroundTask } from "@/lib/utils/background";
import { fetchMetadataInfo } from "@/lib/utils/fetch-link-metadata";
import { prisma } from "@/server/db";
import { mergeCampaignUtm } from "../campaign/utils";
import { checkAndFireMilestones } from "@/server/lib/milestone-check";
import { deleteImage, uploadImage } from "@/server/lib/storage";
import {
  getAccessibleFolderIds,
  isWorkspaceAdmin,
  requireFolderAccess,
  workspaceFilter,
  workspaceOwnership,
} from "@/server/lib/workspace";

import { associateTagsWithLink, getTagsForLink } from "../tag/tag.service";

import {
  assertDomainAllowed,
  checkWorkspaceLinkLimit,
  getWorkspaceDefaultDomain,
  incrementWorkspaceLinkCount,
  validateAlias,
} from "./utils";

import type { Link } from "@prisma/client";
import type { PublicTRPCContext, WorkspaceTRPCContext } from "../../trpc";
import type {
  BulkArchiveLinksInput,
  BulkToggleLinkStatusInput,
  CreateLinkInput,
  GetLinkInput,
  ListLinksInput,
  QuickLinkShorteningInput,
  RetrieveOriginalUrlInput,
  ToggleArchiveInput,
  UpdateLinkInput,
} from "./link.input";

const log = logger.child({ component: "link.service" });

export const getLinks = async (
  ctx: WorkspaceTRPCContext,
  input: ListLinksInput,
) => {
  const {
    page,
    pageSize,
    orderBy,
    orderDirection,
    tag: tagName,
    campaignId,
    archivedFilter,
    search,
  } = input;

  const workspaceWhere = ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null };

  let where: any = {
    ...workspaceWhere,
    isQrCode: false,
    isBioLink: false,
  };

  // If filtering by tag, first get the link IDs that have this tag
  if (tagName && tagName.trim() !== "") {
    const tagRecord = await prisma.tag.findFirst({
      where: {
        name: tagName.trim().toLowerCase(),
        ...workspaceWhere
      },
    });

    if (tagRecord) {
      where.linkTags = {
        some: { tagId: tagRecord.id }
      };
    } else {
      // No links with this tag, return empty results
      return {
        links: [],
        totalLinks: 0,
        totalClicks: 0,
        currentPage: page,
        totalPages: 0,
      };
    }
  }

  if (campaignId !== undefined) {
    where.campaignId = campaignId;
  }

  // Add archived filtering
  if (archivedFilter === "archived") {
    where.archived = true;
  } else if (archivedFilter === "active" || !archivedFilter) {
    where.archived = false;
  }

  // Add search filtering
  if (search && search.trim() !== "") {
    const searchLower = search.trim().toLowerCase();
    where.OR = [
      { name: { contains: searchLower, mode: "insensitive" } },
      { alias: { contains: searchLower, mode: "insensitive" } },
      { url: { contains: searchLower, mode: "insensitive" } },
    ];
  }

  // Add folder access filtering for team members (non-admin/owner)
  if (ctx.workspace.type === "team" && !isWorkspaceAdmin(ctx.workspace)) {
    const allFolders = await prisma.folder.findMany({
      where: workspaceWhere,
      select: { id: true }
    });

    const folderIds = allFolders.map((f) => f.id);
    const accessibleFolderIds = await getAccessibleFolderIds(
      prisma as any,
      ctx.workspace,
      folderIds,
    );

    if (accessibleFolderIds.length > 0) {
      where.OR = [
        ...(where.OR || []),
        { folderId: { in: accessibleFolderIds } },
        { folderId: null }
      ];
    } else {
      where.folderId = null;
    }
  }

  let orderByPrisma: any = { createdAt: orderDirection };
  if (orderBy === "totalClicks") {
    orderByPrisma = { linkVisits: { _count: orderDirection } };
  } else if (orderBy === "lastClicked") {
    // Approximated: order by createdAt as prisma can't easily order by relation MAX field
    orderByPrisma = { createdAt: orderDirection }; 
  }

  const [totalLinks, totalVisitsCount, archivedClicksAgg, links] = await Promise.all([
    prisma.link.count({ where }),
    prisma.linkVisit.count({
      where: {
        link: {
          ...workspaceWhere,
          isQrCode: false,
          isBioLink: false,
        }
      }
    }),
    prisma.linkVisitDailySummary.aggregate({
      _sum: { clicks: true },
      where: {
        link: {
          ...workspaceWhere,
          isQrCode: false,
          isBioLink: false,
        }
      }
    }),
    prisma.link.findMany({
      where,
      include: {
        _count: {
          select: { linkVisits: true }
        },
        dailySummaries: {
          select: { clicks: true }
        },
        linkTags: {
          include: { tag: true }
        },
        folder: {
          select: { id: true, name: true }
        },
        user: {
          select: { id: true, name: true, imageUrl: true }
        },
        campaign: true,
      },
      take: pageSize,
      skip: (page - 1) * pageSize,
      orderBy: orderByPrisma
    })
  ]);

  const linksWithTags = links.map(l => {
    const archivedClicks = l.dailySummaries.reduce((sum, s) => sum + s.clicks, 0);
    
    // Clean up prisma specific relation returns to match previous drizzle return format somewhat
    const { _count, dailySummaries, linkTags, user, ...rest } = l;
    
    return {
      ...rest,
      totalClicks: _count.linkVisits + archivedClicks,
      tags: linkTags.map(lt => lt.tag.name),
      createdBy: user ? {
        id: user.id,
        name: user.name,
        imageUrl: user.imageUrl,
      } : null,
    };
  });
  
  if (orderBy === "totalClicks") {
    linksWithTags.sort((a, b) => orderDirection === "desc" ? b.totalClicks - a.totalClicks : a.totalClicks - b.totalClicks);
  }

  const totalClicks = totalVisitsCount + (archivedClicksAgg._sum.clicks || 0);

  return {
    links: linksWithTags,
    totalLinks,
    totalClicks,
    currentPage: page,
    totalPages: Math.ceil(totalLinks / pageSize),
  };
};

export const getLink = async (
  ctx: WorkspaceTRPCContext,
  input: GetLinkInput,
) => {
  const linkData = await prisma.link.findFirst({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  // Check folder access permission for team members
  if (linkData?.folderId) {
    await requireFolderAccess(prisma as any, ctx.workspace, linkData.folderId);
  }

  return linkData;
};

export const getLinkByAlias = async (input: {
  alias: string;
  domain: string;
}) => {
  return prisma.link.findMany({
    where: {
      domain: input.domain,
      alias: { equals: input.alias, mode: "insensitive" }
    },
  });
};

export const createLink = async (
  ctx: WorkspaceTRPCContext,
  input: CreateLinkInput,
) => {
  const { plan, currentCount, limit } = await checkWorkspaceLinkLimit(ctx);
  const isPaidPlan = plan !== "free";

  const domain = input.domain?.trim() || DEFAULT_PLATFORM_DOMAIN;
  await assertDomainAllowed(ctx, domain);
  const alias =
    input.alias && input.alias !== "" ? input.alias : await generateShortLink();

  await assertUrlSafe(input.url);

  const fetchedMetadata = await fetchMetadataInfo(input.url);

  if (input.alias) {
    await validateAlias(ctx, input.alias, domain, isPaidPlan);
  }

  if (input.password) {
    if (!isPaidPlan) {
      throw new Error(
        "You need to upgrade to a pro plan to use password protection",
      );
    }

    input.password = await bcrypt.hash(input.password, 10);
  }

  const inputMetaData = input.metadata;
  const metadataValues = Object.values(inputMetaData ?? {});
  const hasUserFilledMetadata = metadataValues.some(
    (value) => value !== undefined && value !== null && value !== "",
  );
  if (hasUserFilledMetadata) {
    if (!isPaidPlan) {
      throw new Error(
        "You need to upgrade to a pro plan to use custom social media previews",
      );
    }
  }

  // Check for UTM params - Ultra plan only
  const utmParamsValues = Object.values(input.utmParams ?? {});
  const hasUtmParams = utmParamsValues.some(
    (value) => value !== undefined && value !== null && value !== "",
  );
  if (hasUtmParams) {
    if (plan !== "ultra") {
      throw new Error(
        "UTM parameters are only available on the Ultra plan. Please upgrade to use this feature.",
      );
    }
  }

  // Check for link cloaking - Ultra plan only
  if (input.cloaking) {
    if (plan !== "ultra") {
      throw new Error(
        "Link cloaking is only available on the Ultra plan. Please upgrade to use this feature.",
      );
    }
  }

  if (input.verifiedClicksEnabled) assertCanEnableVerifiedClicks(plan);

  // Campaign membership: the campaign must belong to this workspace. On Pro+
  // its UTM defaults are stamped server-side (explicit user params win), which
  // is why this sits after the Ultra gate above — that gate only applies to
  // hand-entered params.
  if (input.campaignId) {
    const campaignRow = await prisma.campaign.findFirst({
      where: {
        id: input.campaignId,
        ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
      },
    });
    if (!campaignRow) {
      throw new Error("Campaign not found");
    }
    if (campaignRow.status === "archived") {
      throw new Error("This campaign is archived. Restore it before adding links.");
    }
    if (canUseCampaignUtmDefaults(plan)) {
      input.utmParams = mergeCampaignUtm(campaignRow, input.utmParams);
    }
  }

  input.metadata = {
    title: inputMetaData?.title ?? fetchedMetadata.title,
    description: inputMetaData?.description ?? fetchedMetadata.description,
    image: inputMetaData?.image ?? fetchedMetadata.image,
  };

  const name = input.name ?? fetchedMetadata.title ?? "Untitled Link";
  const tagNames = input.tags ?? [];

  // Create link without tags and geoRules fields
  const { tags, geoRules, ...linkData } = input;
  const ownership = workspaceOwnership(ctx.workspace);
  const createdLink = await prisma.link.create({
    data: {
      ...linkData,
      name,
      alias,
      userId: ownership.userId,
      teamId: ownership.teamId,
      createdByUserId: ctx.auth.userId, // Track the actual user who created the link
      passwordHash: input.password,
      domain,
      note: input.note,
      metadata: input.metadata ? (input.metadata as any) : Prisma.JsonNull,
      cloaking: input.cloaking ?? false,
      verifiedClicksEnabled: input.verifiedClicksEnabled ?? false,
    }
  });

  // Associate tags with the link
  const linkId = createdLink.id;
  const result = { insertId: linkId };
  if (tagNames.length > 0) {
    await associateTagsWithLink(ctx, linkId, tagNames);
  }

  // Handle geo rules if provided
  const geoRulesInput = input.geoRules;
  if (geoRulesInput && geoRulesInput.length > 0) {
    // Check plan limits
    if (!canUseGeoRules(plan)) {
      throw new Error(
        "Geotargeting is only available on Pro and Ultra plans. Please upgrade to use this feature.",
      );
    }

    const geoLimit = getGeoRulesLimit(plan);
    if (
      !isUnlimitedGeoRules(plan) &&
      geoLimit !== undefined &&
      geoRulesInput.length > geoLimit
    ) {
      throw new Error(
        `Your plan allows a maximum of ${geoLimit} geo rules per link. Please upgrade to Ultra for unlimited rules.`,
      );
    }

    // Insert geo rules
    await prisma.geoRule.createMany({
      data: geoRulesInput.map((rule, index) => ({
        linkId,
        type: rule.type,
        condition: rule.condition,
        values: rule.values ? (rule.values as any) : Prisma.JsonNull,
        action: rule.action,
        destination: rule.action === "redirect" ? rule.destination : null,
        blockMessage: rule.action === "block" ? rule.blockMessage : null,
        priority: index,
      }))
    });
  }

  // Upload OG image to R2 if it's base64
  if (input.metadata?.image) {
    try {
      const imageUrl = await uploadImage(ctx, {
        image: input.metadata.image,
        resourceId: linkId,
        imageType: "og-image",
      });

      // Update link with the R2 URL if upload was successful and URL changed
      if (imageUrl && imageUrl !== input.metadata.image) {
        await prisma.link.update({
          where: { id: linkId },
          data: {
            metadata: {
              ...(input.metadata as any),
              image: imageUrl,
            },
          }
        });
      }
    } catch (error) {
      log.error(
        { err: error, linkId, action: "create" },
        "failed to upload OG image",
      );
      // Don't fail link creation if image upload fails - base64 is already saved
    }
  }

  await incrementWorkspaceLinkCount(ctx, currentCount, limit);

  return result;
};

export const updateLink = async (
  ctx: WorkspaceTRPCContext,
  input: UpdateLinkInput,
) => {
  // Get existing link first
  const existingLink = await prisma.link.findFirst({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (!existingLink) {
    throw new Error("Link not found");
  }

  // Check folder access permission for team members
  if (existingLink.folderId) {
    await requireFolderAccess(prisma as any, ctx.workspace, existingLink.folderId);
  }

  // Use workspace plan - team workspaces have Ultra features
  const workspacePlan = ctx.workspace.plan;
  const isPaidUser = workspacePlan !== "free";

  // If domain is being changed, it must be platform-owned or a verified
  // custom domain for this workspace.
  if (input.domain !== undefined && input.domain !== existingLink.domain) {
    await assertDomainAllowed(ctx, input.domain);
  }

  // If alias is being changed, validate it
  if (input.alias && input.alias !== existingLink.alias) {
    const domain = input.domain ?? existingLink.domain;
    await validateAlias(ctx, input.alias, domain, isPaidUser);
  }

  // Check for UTM params - Ultra plan only
  if (input.utmParams) {
    const utmParamsValues = Object.values(input.utmParams);
    const hasUtmParams = utmParamsValues.some(
      (value) => value !== undefined && value !== null && value !== "",
    );
    if (hasUtmParams) {
      if (workspacePlan !== "ultra") {
        throw new Error(
          "UTM parameters are only available on the Ultra plan. Please upgrade to use this feature.",
        );
      }
    }
  }

  // Check for link cloaking - Ultra plan only
  if (input.cloaking) {
    if (workspacePlan !== "ultra") {
      throw new Error(
        "Link cloaking is only available on the Ultra plan. Please upgrade to use this feature.",
      );
    }
  }

  // Downgrades are caught again at token-issuance time in resolveShortLink, so a
  // stale `verifiedClicksEnabled=true` doesn't produce tokens for free users.
  if (input.verifiedClicksEnabled) assertCanEnableVerifiedClicks(workspacePlan);

  // If assigning to a campaign, it must belong to this workspace and be
  // active (null clears membership).
  if (input.campaignId !== undefined && input.campaignId !== null) {
    const campaignRow = await prisma.campaign.findFirst({
      where: {
        id: input.campaignId,
        ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
      },
    });
    if (!campaignRow) {
      throw new Error("Campaign not found");
    }
    if (campaignRow.status === "archived") {
      throw new Error("This campaign is archived. Restore it before adding links.");
    }
  }

  // Extract tags and geoRules from input
  const { tags: tagNames, geoRules: geoRulesInput, ...linkData } = input;

  // Upload OG image to R2 if it's base64
  if (linkData.metadata?.image) {
    try {
      const imageUrl = await uploadImage(ctx, {
        image: linkData.metadata.image,
        resourceId: input.id,
        imageType: "og-image",
      });

      // Update metadata with the R2 URL if upload was successful
      if (imageUrl) {
        linkData.metadata = {
          ...linkData.metadata,
          image: imageUrl,
        };
      }
    } catch (error) {
      log.error(
        { err: error, linkId: input.id, action: "update" },
        "failed to upload OG image",
      );
      // Continue with the original image (base64 or URL) if upload fails
    }
  }

  // Update link data - use workspace filtering
  await prisma.link.update({
    where: { id: input.id },
    data: linkData as any,
  });

  // Update tags if provided
  if (tagNames) {
    await associateTagsWithLink(ctx, input.id, tagNames);
  }

  // Handle geo rules if provided
  if (geoRulesInput !== undefined) {
    // Check plan limits for new rules
    if (geoRulesInput.length > 0) {
      if (!canUseGeoRules(workspacePlan)) {
        throw new Error(
          "Geotargeting is only available on Pro and Ultra plans. Please upgrade to use this feature.",
        );
      }

      const geoLimit = getGeoRulesLimit(workspacePlan);
      if (
        !isUnlimitedGeoRules(workspacePlan) &&
        geoLimit !== undefined &&
        geoRulesInput.length > geoLimit
      ) {
        throw new Error(
          `Your plan allows a maximum of ${geoLimit} geo rules per link. Please upgrade to Ultra for unlimited rules.`,
        );
      }
    }

    // Delete existing geo rules for this link
    await prisma.geoRule.deleteMany({
      where: { linkId: input.id }
    });

    // Insert new geo rules if any
    if (geoRulesInput.length > 0) {
      await prisma.geoRule.createMany({
        data: geoRulesInput.map((rule, index) => ({
          linkId: input.id,
          type: rule.type,
          condition: rule.condition,
          values: rule.values ? (rule.values as any) : Prisma.JsonNull,
          action: rule.action,
          destination: rule.action === "redirect" ? rule.destination : null,
          blockMessage: rule.action === "block" ? rule.blockMessage : null,
          priority: index,
        }))
      });
    }

    // Invalidate geo rules cache
    await deleteGeoRulesFromCache(input.id);
  }

  const updatedLink = await prisma.link.findFirst({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (!updatedLink) {
    throw new Error("Link not found after update");
  }

  // Get tags for the updated link
  const tagRecords = await getTagsForLink(ctx, input.id);
  const updatedLinkWithTags = {
    ...updatedLink,
    tags: tagRecords.map((tagRecord) => tagRecord.name),
  };

  // If alias or domain changed, delete the OLD cache key (existingLink has the old values)
  if (
    existingLink.alias !== updatedLink.alias ||
    existingLink.domain !== updatedLink.domain
  ) {
    await deleteFromCache(
      buildCacheKey(existingLink.domain, existingLink.alias!),
    );
  }
  // Always set the new cache entry with updated values
  await setInCache(
    buildCacheKey(updatedLink.domain, updatedLink.alias!),
    updatedLinkWithTags,
  );
};

export const deleteLink = async (
  ctx: WorkspaceTRPCContext,
  input: GetLinkInput,
) => {
  const linkToDelete = await prisma.link.findFirst({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (!linkToDelete) {
    return null;
  }

  // Check folder access permission for team members
  if (linkToDelete.folderId) {
    await requireFolderAccess(prisma as any, ctx.workspace, linkToDelete.folderId);
  }

  // Delete OG image from R2 if present
  const metadata = linkToDelete.metadata as { image?: string } | null;
  if (metadata?.image) {
    try {
      await deleteImage(metadata.image);
    } catch (error) {
      log.error(
        { err: error, linkId: input.id },
        "failed to delete OG image from R2",
      );
    }
  }

  await prisma.linkMilestone.deleteMany({ where: { linkId: input.id } });

  await Promise.all([
    deleteFromCache(
      buildCacheKey(linkToDelete.domain, linkToDelete.alias!),
    ),
    prisma.link.deleteMany({
      where: {
        id: input.id,
        ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
      },
    }),
  ]);
};

export const bulkDeleteLinks = async (
  ctx: WorkspaceTRPCContext,
  linkIds: number[],
) => {
  if (linkIds.length === 0) {
    return { success: true, count: 0 };
  }

  // Fetch links to delete (for cache invalidation)
  let linksToDelete = await prisma.link.findMany({
    where: {
      id: { in: linkIds },
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (linksToDelete.length === 0) {
    return { success: true, count: 0 };
  }

  // Filter by folder access for team members
  if (ctx.workspace.type === "team" && !isWorkspaceAdmin(ctx.workspace)) {
    const folderIds = Array.from(
      new Set(
        linksToDelete
          .map((l) => l.folderId)
          .filter((id): id is number => id !== null),
      ),
    );
    const accessibleFolderIds =
      folderIds.length > 0
        ? await getAccessibleFolderIds(prisma as any, ctx.workspace, folderIds)
        : [];
    linksToDelete = linksToDelete.filter(
      (l) => l.folderId === null || accessibleFolderIds.includes(l.folderId),
    );
  }

  if (linksToDelete.length === 0) {
    return { success: true, count: 0 };
  }

  const validLinkIds = linksToDelete.map((l) => l.id);

  // Delete OG images from R2 before removing links
  for (const l of linksToDelete) {
    const metadata = l.metadata as { image?: string } | null;
    if (metadata?.image) {
      try {
        await deleteImage(metadata.image);
      } catch (error) {
        log.error(
          { err: error, linkId: l.id },
          "failed to delete OG image for link",
        );
      }
    }
  }

  // Delete from database in transaction (delete dependents first)
  await prisma.$transaction(async (tx) => {
    // 1. Delete link visits
    await tx.linkVisit.deleteMany({ where: { linkId: { in: validLinkIds } } });

    // 2. Delete unique link visits
    await tx.uniqueLinkVisit.deleteMany({ where: { linkId: { in: validLinkIds } } });

    // 3. Delete link-tag associations
    await tx.linkTag.deleteMany({ where: { linkId: { in: validLinkIds } } });

    // 4. Delete QR codes associated with links
    await tx.qrCode.deleteMany({ where: { linkId: { in: validLinkIds } } });

    // 5. Delete milestone notifications
    await tx.linkMilestone.deleteMany({ where: { linkId: { in: validLinkIds } } });

    // 6. Finally delete the links themselves
    await tx.link.deleteMany({ where: { id: { in: validLinkIds } } });
  });

  // Invalidate cache for all deleted links in the background. waitUntil keeps
  // the serverless function alive until every deleteFromCache settles.
  void runBackgroundTask(
    Promise.all(
      linksToDelete.map((l) => deleteFromCache(buildCacheKey(l.domain, l.alias!))),
    ).catch((err) => {
      log.error(
        { err, count: linksToDelete.length },
        "failed to invalidate cache for deleted links",
      );
    }),
  );

  return { success: true, count: linksToDelete.length };
};

export const bulkArchiveLinks = async (
  ctx: WorkspaceTRPCContext,
  input: BulkArchiveLinksInput,
) => {
  const { linkIds, archive } = input;

  if (linkIds.length === 0) {
    return { success: true, count: 0 };
  }

  // Verify links belong to workspace
  let linksToUpdate = await prisma.link.findMany({
    where: {
      id: { in: linkIds },
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (linksToUpdate.length === 0) {
    return { success: true, count: 0 };
  }

  // Filter by folder access for team members
  if (ctx.workspace.type === "team" && !isWorkspaceAdmin(ctx.workspace)) {
    const folderIds = Array.from(
      new Set(
        linksToUpdate
          .map((l) => l.folderId)
          .filter((id): id is number => id !== null),
      ),
    );
    const accessibleFolderIds =
      folderIds.length > 0
        ? await getAccessibleFolderIds(prisma as any, ctx.workspace, folderIds)
        : [];
    linksToUpdate = linksToUpdate.filter(
      (l) => l.folderId === null || accessibleFolderIds.includes(l.folderId),
    );
  }

  if (linksToUpdate.length === 0) {
    return { success: true, count: 0 };
  }

  const validLinkIds = linksToUpdate.map((l) => l.id);

  await prisma.link.updateMany({
    where: { id: { in: validLinkIds } },
    data: { archived: archive }
  });

  return { success: true, count: linksToUpdate.length, archived: archive };
};

export const bulkToggleLinkStatus = async (
  ctx: WorkspaceTRPCContext,
  input: BulkToggleLinkStatusInput,
) => {
  const { linkIds, disable } = input;

  if (linkIds.length === 0) {
    return { success: true, count: 0 };
  }

  // Verify links belong to workspace
  let linksToUpdate = await prisma.link.findMany({
    where: {
      id: { in: linkIds },
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (linksToUpdate.length === 0) {
    return { success: true, count: 0 };
  }

  // Filter by folder access for team members
  if (ctx.workspace.type === "team" && !isWorkspaceAdmin(ctx.workspace)) {
    const folderIds = Array.from(
      new Set(
        linksToUpdate
          .map((l) => l.folderId)
          .filter((id): id is number => id !== null),
      ),
    );
    const accessibleFolderIds =
      folderIds.length > 0
        ? await getAccessibleFolderIds(prisma as any, ctx.workspace, folderIds)
        : [];
    linksToUpdate = linksToUpdate.filter(
      (l) => l.folderId === null || accessibleFolderIds.includes(l.folderId),
    );
  }

  if (linksToUpdate.length === 0) {
    return { success: true, count: 0 };
  }

  const validLinkIds = linksToUpdate.map((l) => l.id);

  await prisma.link.updateMany({
    where: { id: { in: validLinkIds } },
    data: { disabled: disable }
  });

  // Invalidate cache for all affected links
  await Promise.all(
    linksToUpdate
      .filter((l) => l.alias)
      .map((l) => deleteFromCache(buildCacheKey(l.domain, l.alias!))),
  );

  return { success: true, count: linksToUpdate.length, disabled: disable };
};

export const retrieveOriginalUrl = async (
  ctx: PublicTRPCContext,
  input: RetrieveOriginalUrlInput,
) => {
  const { alias, domain } = input;
  const cacheKey = buildCacheKey(domain, alias);

  let link: Link | undefined | null = await getFromCache(cacheKey);

  if (!link?.alias) {
    link = await prisma.link.findFirst({
      where: {
        alias: { equals: input.alias, mode: "insensitive" },
        domain: domain,
      }
    });

    if (!link) {
      return null;
    }

    await setInCache(buildCacheKey(link.domain, link.alias!), link);
  }

  return link;
};

export const shortenLinkWithAutoAlias = async (
  ctx: WorkspaceTRPCContext,
  input: QuickLinkShorteningInput,
) => {
  const { currentCount, limit } = await checkWorkspaceLinkLimit(ctx);

  const alias = await generateShortLink();
  const domain = await getWorkspaceDefaultDomain(ctx);

  await assertUrlSafe(input.url);

  const fetchedMetadata = await fetchMetadataInfo(input.url);
  const name = fetchedMetadata.title ?? "Untitled Link";
  const tagNames = input.tags ?? [];
  const ownership = workspaceOwnership(ctx.workspace);

  // Create link without tags field
  const createdLink = await prisma.link.create({
    data: {
      url: input.url,
      alias,
      domain,
      userId: ownership.userId,
      teamId: ownership.teamId,
      createdByUserId: ctx.auth.userId, // Track the actual user who created the link
      name,
      metadata: {
        title: fetchedMetadata.title,
        description: fetchedMetadata.description,
        image: fetchedMetadata.image,
      } as any,
    }
  });

  // Associate tags with the link
  if (tagNames.length > 0) {
    await associateTagsWithLink(ctx, createdLink.id, tagNames);
  }

  await incrementWorkspaceLinkCount(ctx, currentCount, limit);

  return {
    id: createdLink.id,
    alias,
    domain,
  };
};

export const getLinkVisits = async (
  ctx: WorkspaceTRPCContext,
  input: { id: string; domain: string; range: string },
) => {
  // Use workspace plan - team workspaces inherit Ultra features
  const plan = ctx.workspace.plan;
  const userHasPaidPlan = plan !== "free";

  // Use workspace filtering to ensure the link belongs to the current workspace
  const foundLink = await prisma.link.findFirst({
    where: {
      alias: input.id,
      domain: input.domain,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (!foundLink) {
    return {
      totalVisits: [],
      uniqueVisits: [],
      topCountry: "N/A",
      referers: {},
      topReferrer: "N/A",
      isProPlan: userHasPaidPlan,
      geoRules: [],
      previous: null,
    };
  }

  let now = new Date();
  let startDate: Date;
  let range = input.range;

  // Enforce 7-day limit for free users
  if (!userHasPaidPlan && !["24h", "7d"].includes(range)) {
    range = "7d";
  }

  switch (range) {
    case "24h":
      startDate = subDays(now, 1);
      break;
    case "7d":
      startDate = subDays(now, 7);
      break;
    case "30d":
      startDate = subDays(now, 30);
      break;
    case "90d":
      startDate = subDays(now, 90);
      break;
    case "this_month":
      startDate = startOfMonth(now);
      break;
    case "last_month":
      startDate = startOfMonth(subDays(now, 30));
      now.setDate(0); // Set to last day of previous month
      break;
    case "this_year":
      startDate = startOfYear(now);
      break;
    case "last_year":
      startDate = startOfYear(subDays(now, 365));
      now = endOfYear(subDays(now, 365));
      break;
    case "all":
      startDate = new Date(0); // Beginning of time
      break;
    default:
      startDate = subDays(now, 7); // Default to last 7 days
  }

  // Previous-period window for % delta: same duration immediately before
  // the current window. Skip for "all" and for inverted windows that can
  // arise from calendar ranges landing on a non-positive duration.
  const windowMs = now.getTime() - startDate.getTime();
  const hasPreviousPeriod = range !== "all" && windowMs > 0;
  const prevEnd = startDate;
  const prevStart = new Date(startDate.getTime() - windowMs);

  const [totalVisits, uniqueVisits, linkGeoRules, prevCounts] = await Promise.all([
    prisma.linkVisit.findMany({
      where: {
        linkId: foundLink.id,
        createdAt: { gte: startDate, lte: now }
      }
    }),
    prisma.uniqueLinkVisit.findMany({
      where: {
        linkId: foundLink.id,
        createdAt: { gte: startDate, lte: now }
      }
    }),
    prisma.geoRule.findMany({
      where: { linkId: foundLink.id },
      select: { id: true, action: true }
    }),
    hasPreviousPeriod
      ? Promise.all([
          prisma.linkVisit.aggregate({
            _count: { _all: true },
            where: { linkId: foundLink.id, createdAt: { gte: prevStart, lt: prevEnd } }
          }),
          prisma.linkVisit.count({
            where: { linkId: foundLink.id, createdAt: { gte: prevStart, lt: prevEnd }, verifiedAt: { not: null } }
          }),
          prisma.uniqueLinkVisit.count({
            where: { linkId: foundLink.id, createdAt: { gte: prevStart, lt: prevEnd } }
          })
        ])
      : Promise.resolve(null),
  ]);

  const previous = prevCounts
    ? {
        total: prevCounts[0]?._count?._all ?? 0,
        unique: prevCounts[2] ?? 0,
        verified: prevCounts[1] ?? 0,
      }
    : null;

  if (totalVisits.length === 0) {
    return {
      totalVisits: [],
      uniqueVisits: [],
      topCountry: "N/A",
      referers: {},
      topReferrer: "N/A",
      isProPlan: userHasPaidPlan,
      geoRules: linkGeoRules,
      previous,
    };
  }

  const countryVisits = totalVisits.reduce(
    (acc, visit) => {
      // Skip null/undefined country values
      if (visit.country) {
        acc[visit.country] = (acc[visit.country] ?? 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>,
  );
  const topCountry = Object.entries(countryVisits).reduce(
    (a, b) => (a[1] > b[1] ? a : b),
    ["", 0],
  )[0];

  const referrerVisits = totalVisits.reduce(
    (acc, visit) => {
      // Skip null/undefined referer values
      if (visit.referer) {
        acc[visit.referer] = (acc[visit.referer] ?? 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>,
  );
  const topReferrer = Object.entries(referrerVisits).reduce(
    (a, b) => (a[1] > b[1] ? a : b),
    ["", 0],
  )[0];

  return {
    totalVisits,
    uniqueVisits,
    topCountry,
    referers: referrerVisits,
    topReferrer: topReferrer !== "null" ? topReferrer : "Direct",
    isProPlan: userHasPaidPlan,
    geoRules: linkGeoRules,
    previous,
  };
};

export const getAllUserAnalytics = async (
  ctx: WorkspaceTRPCContext,
  input: {
    range: string;
    filterType: "all" | "folder" | "domain" | "link" | "campaign";
    filterId?: string | number;
  },
) => {
  // Use workspace plan - team workspaces inherit Ultra features
  const plan = ctx.workspace.plan;
  const userHasPaidPlan = plan !== "free";

  // Fetch workspace links with optional filtering
  const userLinks = await prisma.link.findMany({
    where: {
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
      isQrCode: false,
      isBioLink: false,
      ...(input.filterType === "folder" && input.filterId !== undefined ? { folderId: input.filterId === "null" || input.filterId === null ? null : Number(input.filterId) } : {}),
      ...(input.filterType === "domain" && input.filterId ? { domain: String(input.filterId) } : {}),
      ...(input.filterType === "link" && input.filterId ? { id: Number(input.filterId) } : {}),
      ...(input.filterType === "campaign" && input.filterId ? { campaignId: Number(input.filterId) } : {}),
    }
  });

  if (userLinks.length === 0) {
    return {
      totalVisits: [],
      uniqueVisits: [],
      topCountry: "N/A",
      referers: {},
      topReferrer: "N/A",
      isProPlan: userHasPaidPlan,
      clicksByLink: {},
      clicksByDestination: {},
    };
  }

  let now = new Date();
  let startDate: Date;
  let range = input.range;

  // Enforce 7-day limit for free users
  if (!userHasPaidPlan && !["24h", "7d"].includes(range)) {
    range = "7d";
  }

  switch (range) {
    case "24h":
      startDate = subDays(now, 1);
      break;
    case "7d":
      startDate = subDays(now, 7);
      break;
    case "30d":
      startDate = subDays(now, 30);
      break;
    case "90d":
      startDate = subDays(now, 90);
      break;
    case "this_month":
      startDate = startOfMonth(now);
      break;
    case "last_month":
      startDate = startOfMonth(subDays(now, 30));
      now.setDate(0);
      break;
    case "this_year":
      startDate = startOfYear(now);
      break;
    case "last_year":
      startDate = startOfYear(subDays(now, 365));
      now = endOfYear(subDays(now, 365));
      break;
    case "all":
      startDate = new Date(0);
      break;
    default:
      startDate = subDays(now, 7);
  }

  const linkIds = userLinks.map((link) => link.id);

  // Fetch all visits for all links
  const [totalVisits, uniqueVisits] = await Promise.all([
    prisma.linkVisit.findMany({
      where: {
        linkId: { in: linkIds },
        createdAt: { gte: startDate, lte: now }
      }
    }),
    prisma.uniqueLinkVisit.findMany({
      where: {
        linkId: { in: linkIds },
        createdAt: { gte: startDate, lte: now }
      }
    }),
  ]);

  if (totalVisits.length === 0) {
    return {
      totalVisits: [],
      uniqueVisits: [],
      topCountry: "N/A",
      referers: {},
      topReferrer: "N/A",
      isProPlan: userHasPaidPlan,
      clicksByLink: {},
      clicksByDestination: {},
    };
  }

  // Aggregate clicks by link
  const clicksByLink: Record<string, number> = {};
  const clicksByDestination: Record<string, number> = {};
  const linkIdToInfo = new Map<number, { shortLink: string; destination: string | null }>(
    userLinks.map((link) => [
      link.id,
      { shortLink: `${link.domain}/${link.alias}`, destination: link.url },
    ]),
  );

  totalVisits.forEach((visit) => {
    const linkInfo = linkIdToInfo.get(visit.linkId);
    if (linkInfo) {
      clicksByLink[linkInfo.shortLink] =
        (clicksByLink[linkInfo.shortLink] ?? 0) + 1;
      if (linkInfo.destination) {
        clicksByDestination[linkInfo.destination] =
          (clicksByDestination[linkInfo.destination] ?? 0) + 1;
      }
    }
  });

  // Calculate top country
  const countryVisits = totalVisits.reduce(
    (acc, visit) => {
      if (visit.country) {
        acc[visit.country] = (acc[visit.country] ?? 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>,
  );
  const topCountry =
    Object.entries(countryVisits).length > 0
      ? Object.entries(countryVisits).reduce((a, b) => (a[1] > b[1] ? a : b))[0]
      : "N/A";

  // Calculate referrers
  const referrerVisits = totalVisits.reduce(
    (acc, visit) => {
      const ref = visit.referer ?? "null";
      acc[ref] = (acc[ref] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const topReferrer =
    Object.entries(referrerVisits).length > 0
      ? Object.entries(referrerVisits).reduce((a, b) =>
          a[1] > b[1] ? a : b,
        )[0]
      : "null";

  return {
    totalVisits,
    uniqueVisits,
    topCountry,
    referers: referrerVisits,
    topReferrer: topReferrer !== "null" ? topReferrer : "Direct",
    isProPlan: userHasPaidPlan,
    clicksByLink,
    clicksByDestination,
  };
};

export const togglePublicStats = async (
  ctx: WorkspaceTRPCContext,
  input: GetLinkInput,
) => {
  const fetchedLink = await prisma.link.findFirst({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (!fetchedLink) {
    return null;
  }

  return prisma.link.updateMany({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
    data: {
      publicStats: !fetchedLink.publicStats,
    }
  });
};

export const toggleLinkStatus = async (
  ctx: WorkspaceTRPCContext,
  input: GetLinkInput,
) => {
  const fetchedLink = await prisma.link.findFirst({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (!fetchedLink) {
    return null;
  }

  const result = await prisma.link.updateMany({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
    data: {
      disabled: !fetchedLink.disabled,
    }
  });

  // Invalidate cache so the status change takes effect immediately
  if (fetchedLink.alias) {
    await deleteFromCache(
      buildCacheKey(fetchedLink.domain, fetchedLink.alias),
    );
  }

  return result;
};

export const resetLinkStatistics = async (
  ctx: WorkspaceTRPCContext,
  input: GetLinkInput,
) => {
  const fetchedLink = await prisma.link.findFirst({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (!fetchedLink) {
    return null;
  }

  await prisma.linkVisit.deleteMany({ where: { linkId: fetchedLink.id } });

  return fetchedLink;
};

export const verifyLinkPassword = async (
  ctx: PublicTRPCContext,
  input: { id: number; password: string },
) => {
  const link = await prisma.link.findFirst({
    where: { id: input.id },
  });

  if (!link?.passwordHash) {
    return null;
  }

  const isPasswordCorrect = await bcrypt.compare(
    input.password,
    link.passwordHash,
  );

  if (!isPasswordCorrect) {
    return null;
  }

  const deviceDetails = await retrieveDeviceAndGeolocationData(ctx.headers);
  // x-forwarded-for is a comma-separated proxy chain; the left-most token is
  // the original client. Hashing the whole header instead would count the
  // same visitor as distinct whenever the proxy chain changes.
  const clientIp = (ctx.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
  const ipHash = hashIp(clientIp);

  const tokenIssue = link.url
    ? await issueVerifiedClickToken(link, link.url)
    : null;

  await prisma.linkVisit.create({
    data: {
      linkId: link.id,
      ...deviceDetails,
      visitId: tokenIssue?.visitId ?? null,
    }
  });

  try {
    await prisma.uniqueLinkVisit.create({
      data: { linkId: link.id, ipHash }
    });
  } catch (e) {
    // Ignore duplicate key errors
  }

  // Fire milestone check for password-protected links (recordClick skips these)
  void runBackgroundTask(checkAndFireMilestones(link.id, link.userId));

  return {
    url: link.url,
    alias: link.alias,
    verificationToken: tokenIssue?.verificationToken ?? null,
  };
};

export const changeLinkPassword = async (
  ctx: WorkspaceTRPCContext,
  input: { id: number; password: string },
) => {
  const passwordHash = await bcrypt.hash(input.password, 10);

  await prisma.link.updateMany({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
    data: {
      passwordHash,
    }
  });

  const updatedLink = await prisma.link.findFirst({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  await deleteFromCache(
    buildCacheKey(updatedLink!.domain, updatedLink!.alias!),
  );

  return updatedLink;
};

export const checkAliasAvailability = async (
  ctx: PublicTRPCContext,
  input: { alias: string; domain: string },
) => {
  const existingLink = await prisma.link.findFirst({
    where: { alias: input.alias, domain: input.domain },
  });

  return { isAvailable: !existingLink };
};

type LinkRecord = {
  url: string;
  alias?: string;
  domain?: string;
  note?: string;
};

export const bulkCreateLinks = async (
  ctx: WorkspaceTRPCContext,
  csvContent: string,
) => {
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as LinkRecord[];

  const ownership = workspaceOwnership(ctx.workspace);

  // we need to check for alias clashes and report those to the user, if we use promise.all, it will
  // fail if there is an alias clash so we need to use promise.allSettled
  // promise.all settled will return an array of objects with status and value, we can then filter out
  // the rejected promises and report those to the user
  const bulkLinksCreationPromiseResults = await Promise.allSettled(
    records.map(async (record: LinkRecord) => {
      await assertUrlSafe(record.url);

      const alias = record.alias ?? (await generateShortLink());
      await prisma.link.create({
        data: {
          url: record.url,
          alias,
          userId: ownership.userId,
          teamId: ownership.teamId,
          createdByUserId: ctx.auth.userId, // Track the actual user who created the link
          domain: record.domain?.trim() || DEFAULT_PLATFORM_DOMAIN,
          note: record.note,
        }
      });
    }),
  );

  const successfulLinks = bulkLinksCreationPromiseResults.filter(
    (result) => result.status === "fulfilled",
  ).length;
  const failedLinks = bulkLinksCreationPromiseResults.filter(
    (result) => result.status === "rejected",
  ).length;

  // TODO: add a way to notify the user about links that failed. We have already added an email template.
  // so we need to filter the links that failed and attach the right reason to the email.

  return {
    success: true,
    message: `${successfulLinks} links created successfully, ${failedLinks} links failed to create`,
  };
};

export const exportAllUserLinks = async (ctx: WorkspaceTRPCContext) => {
  return prisma.link.findMany({
    select: {
      url: true,
      alias: true,
      note: true,
      domain: true,
      createdAt: true,
    },
    where: {
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
      isQrCode: false,
      isBioLink: false,
    },
  });
};

export const checkPresenceOfVercelHeaders = async (ctx: PublicTRPCContext) => {
  return {
    headers: ctx.headers,
    countryHeader: ctx.headers.get("x-vercel-ip-country"),
    cityHeader: ctx.headers.get("x-vercel-ip-city"),
  };
};

export const toggleArchive = async (
  ctx: WorkspaceTRPCContext,
  input: ToggleArchiveInput,
) => {
  const currentLink = await prisma.link.findFirst({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
    select: { archived: true },
  });

  if (!currentLink) {
    throw new Error(
      "Link not found or you don't have permission to modify it.",
    );
  }

  const newArchivedStatus = !currentLink.archived;

  await prisma.link.updateMany({
    where: {
      id: input.id,
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
    },
    data: { archived: newArchivedStatus }
  });

  // Invalidate cache if necessary (if the link was cached)
  // Consider if archived links should be cached differently or not at all
  // For simplicity, let's remove it for now
  // await deleteFromCache(buildCacheKey(link.domain, link.alias)); // Need domain/alias

  return { success: true, archived: newArchivedStatus };
};

export const getStats = async (ctx: WorkspaceTRPCContext) => {
  const totalLinks = await prisma.link.count({
    where: {
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
      isQrCode: false,
      isBioLink: false,
    }
  });

  const activeLinks = await prisma.link.count({
    where: {
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null }),
      isQrCode: false,
      isBioLink: false,
      archived: false,
    }
  });

  return {
    totalLinks,
    activeLinks,
  };
};
