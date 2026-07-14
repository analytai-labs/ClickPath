import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { addDays } from "date-fns";

import { getPlanCaps, resolvePlan } from "@/lib/billing/plans";
import type { Plan } from "@/lib/billing/plans";
import { runBackgroundTask } from "@/lib/utils/background";
import {
  sendAccountTransferEmail,
  sendTransferCompletedEmail,
  sendTransferDeclinedEmail,
} from "@/server/lib/notifications/account-transfer";

import type { ProtectedTRPCContext } from "../../trpc";
import type {
  AcceptTransferInput,
  CancelTransferInput,
  InitiateTransferInput,
} from "./account-transfer.input";

// ============================================================================
// TYPES
// ============================================================================

export interface ResourceCounts {
  links: number;
  customDomains: number;
  qrCodes: number;
  folders: number;
  tags: number;
  utmTemplates: number;
  qrPresets: number;
}

export interface TransferValidationResult {
  isValid: boolean;
  errors: Array<{
    type:
      | "TARGET_NOT_FOUND"
      | "SAME_ACCOUNT"
      | "PENDING_TRANSFER_EXISTS"
      | "LIMIT_EXCEEDED"
      | "TARGET_DELETED";
    message: string;
    resourceType?: string;
    currentCount?: number;
    limit?: number;
  }>;
  resourceCounts: ResourceCounts;
  targetUserId?: string;
  targetPlan?: Plan;
}

export interface TransferResult {
  success: boolean;
  linksTransferred: number;
  customDomainsTransferred: number;
  qrCodesTransferred: number;
  foldersTransferred: number;
  foldersCreated: number;
  foldersMerged: number;
  tagsTransferred: number;
  tagsCreated: number;
  tagsMerged: number;
  utmTemplatesTransferred: number;
  qrPresetsTransferred: number;
  bioPagesTransferred: number;
  campaignsTransferred: number;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Count all transferable resources in the user's personal workspace
 */
async function countUserResources(userId: string, prisma: any): Promise<ResourceCounts> {
  const [links, domains, qrCodes, folders, tags, utmTemplates, qrPresets] = await Promise.all([
    prisma.link.count({ where: { userId, teamId: null } }),
    prisma.customDomain.count({ where: { userId, teamId: null } }),
    prisma.qrcode.count({ where: { userId, teamId: null } }),
    prisma.folder.count({ where: { userId, teamId: null } }),
    prisma.tag.count({ where: { userId, teamId: null } }),
    prisma.utmTemplate.count({ where: { userId, teamId: null } }),
    prisma.qrPreset.count({ where: { userId, teamId: null } }),
  ]);

  return {
    links,
    customDomains: domains,
    qrCodes,
    folders,
    tags,
    utmTemplates,
    qrPresets,
  };
}

/**
 * Validate if account transfer is possible
 * - Target account must exist
 * - Cannot transfer to self
 * - No pending transfer exists (unless excluded)
 * - Target plan must accommodate resources
 *
 * @param ctx - Protected tRPC context
 * @param targetEmail - Email of the target account
 * @param excludeTransferId - Optional transfer ID to exclude from pending check
 *                            (used during revalidation in accept flow)
 */
export async function validateAccountTransfer(
  ctx: ProtectedTRPCContext,
  targetEmail: string,
  excludeTransferId?: number,
): Promise<TransferValidationResult> {
  const errors: TransferValidationResult["errors"] = [];

  // Get source user
  const sourceUser = await ctx.prisma.user.findFirst({
    where: { id: ctx.auth.userId },
  });

  if (!sourceUser) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Source account not found",
    });
  }

  // Check not transferring to self
  if (sourceUser.email?.toLowerCase() === targetEmail.toLowerCase()) {
    errors.push({
      type: "SAME_ACCOUNT",
      message: "Cannot transfer resources to yourself",
    });
    return {
      isValid: false,
      errors,
      resourceCounts: {
        links: 0,
        customDomains: 0,
        qrCodes: 0,
        folders: 0,
        tags: 0,
        utmTemplates: 0,
        qrPresets: 0,
      },
    };
  }

  // Check target account exists
  const targetUser = await ctx.prisma.user.findFirst({
    where: { email: targetEmail.toLowerCase() },
    include: { subscription: true },
  });

  if (!targetUser) {
    errors.push({
      type: "TARGET_NOT_FOUND",
      message: "Target account does not exist. The recipient must sign up first.",
    });
    return {
      isValid: false,
      errors,
      resourceCounts: {
        links: 0,
        customDomains: 0,
        qrCodes: 0,
        folders: 0,
        tags: 0,
        utmTemplates: 0,
        qrPresets: 0,
      },
    };
  }

  // Check target account is not soft-deleted
  if (targetUser.deletedAt !== null) {
    errors.push({
      type: "TARGET_DELETED",
      message: "Target account is marked for deletion and cannot receive transfers",
    });
    return {
      isValid: false,
      errors,
      resourceCounts: {
        links: 0,
        customDomains: 0,
        qrCodes: 0,
        folders: 0,
        tags: 0,
        utmTemplates: 0,
        qrPresets: 0,
      },
    };
  }

  // Check for existing pending transfer (excluding the current one if specified)
  const existingTransfer = await ctx.prisma.accountTransfer.findFirst({
    where: {
      fromUserId: ctx.auth.userId,
      status: "pending",
      ...(excludeTransferId !== undefined ? { id: { not: excludeTransferId } } : {}),
    },
  });

  if (existingTransfer) {
    errors.push({
      type: "PENDING_TRANSFER_EXISTS",
      message: "You already have a pending transfer. Cancel it before initiating a new one.",
    });
    return {
      isValid: false,
      errors,
      resourceCounts: {
        links: 0,
        customDomains: 0,
        qrCodes: 0,
        folders: 0,
        tags: 0,
        utmTemplates: 0,
        qrPresets: 0,
      },
    };
  }

  // Get target user's plan
  const targetPlan = resolvePlan(targetUser.subscription ?? null);
  const targetCaps = getPlanCaps(targetPlan);

  // Count source resources
  const resourceCounts = await countUserResources(ctx.auth.userId, ctx.prisma);

  // Get target's current counts
  const targetCurrentCounts = await countUserResources(targetUser.id, ctx.prisma);

  // Check limits - BLOCK entire transfer if ANY resource would exceed caps
  if (targetCaps.linksLimit !== undefined) {
    const newTotal = targetCurrentCounts.links + resourceCounts.links;
    if (newTotal > targetCaps.linksLimit) {
      errors.push({
        type: "LIMIT_EXCEEDED",
        message: `Transfer would exceed target account's link limit`,
        resourceType: "links",
        currentCount: newTotal,
        limit: targetCaps.linksLimit,
      });
    }
  }

  if (targetCaps.domainLimit !== undefined && resourceCounts.customDomains > 0) {
    const newTotal = targetCurrentCounts.customDomains + resourceCounts.customDomains;
    if (newTotal > targetCaps.domainLimit) {
      errors.push({
        type: "LIMIT_EXCEEDED",
        message: `Transfer would exceed target account's custom domain limit`,
        resourceType: "customDomains",
        currentCount: newTotal,
        limit: targetCaps.domainLimit,
      });
    }
  }

  if (targetCaps.folderLimit !== undefined && resourceCounts.folders > 0) {
    // For folders, we need to account for potential merges
    // Get folder names from both accounts to see overlap
    const [sourceFolders, targetFolders] = await Promise.all([
      ctx.prisma.folder.findMany({
        where: { userId: ctx.auth.userId, teamId: null },
        select: { name: true },
      }),
      ctx.prisma.folder.findMany({
        where: { userId: targetUser.id, teamId: null },
        select: { name: true },
      }),
    ]);

    const targetFolderNames = new Set(targetFolders.map((f) => f.name.toLowerCase()));
    const newFoldersCount = sourceFolders.filter(
      (f) => !targetFolderNames.has(f.name.toLowerCase()),
    ).length;

    const newTotal = targetCurrentCounts.folders + newFoldersCount;
    if (newTotal > targetCaps.folderLimit) {
      errors.push({
        type: "LIMIT_EXCEEDED",
        message: `Transfer would exceed target account's folder limit`,
        resourceType: "folders",
        currentCount: newTotal,
        limit: targetCaps.folderLimit,
      });
    }
  }

  // Campaigns: block the transfer if the source's ACTIVE campaigns would
  // exceed the target's active-campaign cap (archived don't count).
  if (targetCaps.campaignLimit !== undefined) {
    const [srcCampaigns, tgtCampaigns] = await Promise.all([
      ctx.prisma.campaign.count({
        where: { userId: ctx.auth.userId, teamId: null, status: "active" },
      }),
      ctx.prisma.campaign.count({
        where: { userId: targetUser.id, teamId: null, status: "active" },
      }),
    ]);
    if (srcCampaigns > 0) {
      const newTotal = tgtCampaigns + srcCampaigns;
      if (newTotal > targetCaps.campaignLimit) {
        errors.push({
          type: "LIMIT_EXCEEDED",
          message: `Transfer would exceed target account's active campaign limit`,
          resourceType: "campaigns",
          currentCount: newTotal,
          limit: targetCaps.campaignLimit,
        });
      }
    }
  }

  // Bio pages: block the transfer if it would exceed the target's bio-page cap.
  if (targetCaps.bioPageLimit !== undefined) {
    const [srcBioPages, tgtBioPages] = await Promise.all([
      ctx.prisma.bioPage.count({
        where: { userId: ctx.auth.userId, teamId: null },
      }),
      ctx.prisma.bioPage.count({
        where: { userId: targetUser.id, teamId: null },
      }),
    ]);
    if (srcBioPages > 0) {
      const newTotal = tgtBioPages + srcBioPages;
      if (newTotal > targetCaps.bioPageLimit) {
        errors.push({
          type: "LIMIT_EXCEEDED",
          message: `Transfer would exceed target account's bio page limit`,
          resourceType: "bioPages",
          currentCount: newTotal,
          limit: targetCaps.bioPageLimit,
        });
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    resourceCounts,
    targetUserId: targetUser.id,
    targetPlan,
  };
}

// ============================================================================
// INITIATE TRANSFER
// ============================================================================

export async function initiateAccountTransfer(
  ctx: ProtectedTRPCContext,
  input: InitiateTransferInput,
) {
  // Validate the transfer
  const validation = await validateAccountTransfer(ctx, input.targetEmail);

  if (!validation.isValid) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: validation.errors[0]?.message ?? "Transfer validation failed",
      cause: { blockers: validation.errors },
    });
  }

  // Generate secure token
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = addDays(new Date(), 7); // 7 day expiry

  // Create transfer record
  const result = await ctx.prisma.accountTransfer.create({
    data: {
      fromUserId: ctx.auth.userId,
      toEmail: input.targetEmail.toLowerCase(),
      toUserId: validation.targetUserId,
      token,
      status: "pending",
      linksCount: validation.resourceCounts.links,
      customDomainsCount: validation.resourceCounts.customDomains,
      qrCodesCount: validation.resourceCounts.qrCodes,
      foldersCount: validation.resourceCounts.folders,
      tagsCount: validation.resourceCounts.tags,
      utmTemplatesCount: validation.resourceCounts.utmTemplates,
      qrPresetsCount: validation.resourceCounts.qrPresets,
      expiresAt,
    },
  });

  // Get source user details for email
  const sourceUser = await ctx.prisma.user.findFirst({
    where: { id: ctx.auth.userId },
    select: { name: true, email: true },
  });

  const targetUser = await ctx.prisma.user.findFirst({
    where: { id: validation.targetUserId! },
    select: { name: true },
  });

  // Send email to target account
  void runBackgroundTask(
    sendAccountTransferEmail({
      toEmail: input.targetEmail,
      toName: targetUser?.name,
      fromEmail: sourceUser?.email ?? "unknown",
      fromName: sourceUser?.name ?? "A user",
      token,
      resourceCounts: validation.resourceCounts,
    }),
  );

  return {
    transferId: result.id,
    token,
    expiresAt,
    resourceCounts: validation.resourceCounts,
  };
}

// ============================================================================
// GET TRANSFER INFO
// ============================================================================

export async function getTransferByToken(ctx: ProtectedTRPCContext, token: string) {
  const transfer = await ctx.prisma.accountTransfer.findFirst({
    where: { token },
    include: {
      fromUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!transfer) {
    return null;
  }

  return {
    id: transfer.id,
    fromUser: {
      name: transfer.fromUser.name,
      email: transfer.fromUser.email,
    },
    status: transfer.status,
    resourceCounts: {
      links: transfer.linksCount,
      customDomains: transfer.customDomainsCount,
      qrCodes: transfer.qrCodesCount,
      folders: transfer.foldersCount,
      tags: transfer.tagsCount,
      utmTemplates: transfer.utmTemplatesCount,
      qrPresets: transfer.qrPresetsCount,
    },
    expiresAt: transfer.expiresAt,
    acceptedAt: transfer.acceptedAt,
    isExpired: transfer.expiresAt < new Date(),
    isAccepted: !!transfer.acceptedAt,
    isCancelled: transfer.status === "cancelled",
    isDeclined: transfer.status === "declined",
  };
}

export async function getPendingTransfer(ctx: ProtectedTRPCContext) {
  const transfer = await ctx.prisma.accountTransfer.findFirst({
    where: {
      fromUserId: ctx.auth.userId,
      status: "pending",
    },
  });

  if (!transfer) {
    return null;
  }

  return {
    id: transfer.id,
    targetEmail: transfer.toEmail,
    status: transfer.status,
    resourceCounts: {
      links: transfer.linksCount,
      customDomains: transfer.customDomainsCount,
      qrCodes: transfer.qrCodesCount,
      folders: transfer.foldersCount,
      tags: transfer.tagsCount,
      utmTemplates: transfer.utmTemplatesCount,
      qrPresets: transfer.qrPresetsCount,
    },
    expiresAt: transfer.expiresAt,
    createdAt: transfer.createdAt,
    isExpired: transfer.expiresAt < new Date(),
  };
}

// ============================================================================
// ACCEPT TRANSFER (Execute Resource Migration)
// ============================================================================

export async function acceptAccountTransfer(
  ctx: ProtectedTRPCContext,
  input: AcceptTransferInput,
): Promise<TransferResult> {
  const transfer = await ctx.prisma.accountTransfer.findFirst({
    where: { token: input.token },
  });

  if (!transfer) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invalid transfer token",
    });
  }

  // Verify current user is the target
  const currentUser = await ctx.prisma.user.findFirst({
    where: { id: ctx.auth.userId },
  });

  if (currentUser?.email?.toLowerCase() !== transfer.toEmail.toLowerCase()) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This transfer is for a different account",
    });
  }

  if (transfer.status !== "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This transfer is ${transfer.status} and cannot be accepted`,
    });
  }

  if (transfer.expiresAt < new Date()) {
    // Mark as expired
    await ctx.prisma.accountTransfer.update({
      where: { id: transfer.id },
      data: { status: "expired" },
    });

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This transfer has expired",
    });
  }

  // Re-validate (plan caps may have changed)
  // Create a temporary context with the source user to validate
  const sourceUserContext = {
    ...ctx,
    auth: { ...ctx.auth, userId: transfer.fromUserId },
  } as ProtectedTRPCContext;

  // Pass the current transfer ID to exclude it from the pending transfer check
  const revalidation = await validateAccountTransfer(
    sourceUserContext,
    transfer.toEmail,
    transfer.id,
  );

  if (!revalidation.isValid) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Transfer validation failed. Plan limits may have changed. " +
        revalidation.errors.map((e) => e.message).join(". "),
      cause: { blockers: revalidation.errors },
    });
  }

  // Execute transfer in transaction
  const result = await executeResourceTransfer(
    ctx,
    transfer.fromUserId,
    ctx.auth.userId,
    transfer.id,
  );

  // Notify the source user that transfer was completed
  const sourceUser = await ctx.prisma.user.findFirst({
    where: { id: transfer.fromUserId },
    select: { name: true, email: true },
  });

  if (sourceUser?.email) {
    void runBackgroundTask(
      sendTransferCompletedEmail({
        toEmail: sourceUser.email,
        toName: sourceUser.name,
        recipientName: currentUser?.name ?? "the recipient",
        recipientEmail: currentUser?.email ?? transfer.toEmail,
        resourceCounts: {
          links: transfer.linksCount,
          customDomains: transfer.customDomainsCount,
          qrCodes: transfer.qrCodesCount,
          folders: transfer.foldersCount,
          tags: transfer.tagsCount,
          utmTemplates: transfer.utmTemplatesCount,
          qrPresets: transfer.qrPresetsCount,
        },
      }),
    );
  }

  return result;
}

/**
 * Execute the actual resource transfer
 */
async function executeResourceTransfer(
  ctx: ProtectedTRPCContext,
  fromUserId: string,
  toUserId: string,
  transferId: number,
): Promise<TransferResult> {
  const result: TransferResult = {
    success: true,
    linksTransferred: 0,
    customDomainsTransferred: 0,
    qrCodesTransferred: 0,
    foldersTransferred: 0,
    foldersCreated: 0,
    foldersMerged: 0,
    tagsTransferred: 0,
    tagsCreated: 0,
    tagsMerged: 0,
    utmTemplatesTransferred: 0,
    qrPresetsTransferred: 0,
    bioPagesTransferred: 0,
    campaignsTransferred: 0,
  };

  await ctx.prisma.$transaction(async (tx) => {
    // =========================================
    // Phase 0: Atomically claim the transfer (prevent race condition)
    // =========================================
    // Use conditional update to ensure only one request can claim this transfer.
    // If another request already changed status from "pending", this will update 0 rows.
    const claimResult = await tx.accountTransfer.updateMany({
      where: {
        id: transferId,
        status: "pending",
      },
      data: {
        status: "accepted",
        acceptedAt: new Date(),
        toUserId: toUserId,
      },
    });

    if (claimResult.count === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This transfer has already been processed or is no longer pending",
      });
    }

    // =========================================
    // Phase 1: Handle Folders (by name merge)
    // =========================================
    const sourceFolders = await tx.folder.findMany({
      where: { userId: fromUserId, teamId: null },
    });

    const targetFolders = await tx.folder.findMany({
      where: { userId: toUserId, teamId: null },
    });

    const targetFoldersByName = new Map(targetFolders.map((f) => [f.name.toLowerCase(), f]));

    const folderIdMapping = new Map<number, number>(); // source ID -> target ID

    for (const sourceFolder of sourceFolders) {
      const folderNameKey = sourceFolder.name.toLowerCase();
      const existingTargetFolder = targetFoldersByName.get(folderNameKey);

      if (existingTargetFolder) {
        // Merge: map source folder ID to existing target folder ID
        folderIdMapping.set(sourceFolder.id, existingTargetFolder.id);
        result.foldersMerged++;
      } else {
        // Create new folder in target account
        const newFolder = await tx.folder.create({
          data: {
            name: sourceFolder.name,
            description: sourceFolder.description,
            userId: toUserId,
            teamId: null,
            isRestricted: false, // Reset restriction (no team context)
          },
        });
        const newFolderId = newFolder.id;
        folderIdMapping.set(sourceFolder.id, newFolderId);
        targetFoldersByName.set(folderNameKey, { ...sourceFolder, id: newFolderId });
        result.foldersCreated++;
      }
    }

    result.foldersTransferred = sourceFolders.length;

    // =========================================
    // Phase 2: Handle Tags (by name merge)
    // =========================================
    const sourceTags = await tx.tag.findMany({
      where: { userId: fromUserId, teamId: null },
    });

    const targetTags = await tx.tag.findMany({
      where: { userId: toUserId, teamId: null },
    });

    const targetTagsByName = new Map(targetTags.map((t) => [t.name.toLowerCase(), t]));

    const tagIdMapping = new Map<number, number>(); // source ID -> target ID

    for (const sourceTag of sourceTags) {
      const tagNameKey = sourceTag.name.toLowerCase();
      const existingTargetTag = targetTagsByName.get(tagNameKey);

      if (existingTargetTag) {
        // Merge: map source tag ID to existing target tag ID
        tagIdMapping.set(sourceTag.id, existingTargetTag.id);
        result.tagsMerged++;
      } else {
        // Create new tag in target account
        const newTag = await tx.tag.create({
          data: {
            name: sourceTag.name,
            userId: toUserId,
            teamId: null,
          },
        });
        const newTagId = newTag.id;
        tagIdMapping.set(sourceTag.id, newTagId);
        targetTagsByName.set(tagNameKey, { ...sourceTag, id: newTagId });
        result.tagsCreated++;
      }
    }

    result.tagsTransferred = sourceTags.length;

    // =========================================
    // Phase 3: Transfer Links (with folder remapping)
    // =========================================
    const sourceLinks = await tx.link.findMany({
      where: { userId: fromUserId, teamId: null },
    });

    if (sourceLinks.length > 0) {
      const linkIds = sourceLinks.map((l) => l.id);

      // Get all link-tag associations for these links
      const sourceLinkTags = await tx.linkTag.findMany({
        where: { linkId: { in: linkIds } },
      });

      // Update links ownership and folder IDs
      for (const sourceLink of sourceLinks) {
        const newFolderId = sourceLink.folderId
          ? (folderIdMapping.get(sourceLink.folderId) ?? null)
          : null;

        await tx.link.update({
          where: { id: sourceLink.id },
          data: {
            userId: toUserId,
            teamId: null,
            folderId: newFolderId,
          },
        });
      }

      // Delete old link-tag associations
      if (sourceLinkTags.length > 0) {
        await tx.linkTag.deleteMany({
          where: { linkId: { in: linkIds } },
        });
      }

      // Recreate link-tag associations with new tag IDs
      // Deduplicate by (linkId, tagId) to prevent PK conflicts when multiple
      // source tags merge into the same target tag
      const linkTagSet = new Map<string, { linkId: number; tagId: number }>();
      for (const lt of sourceLinkTags) {
        const newTagId = tagIdMapping.get(lt.tagId);
        if (newTagId) {
          const key = `${lt.linkId}:${newTagId}`;
          if (!linkTagSet.has(key)) {
            linkTagSet.set(key, { linkId: lt.linkId, tagId: newTagId });
          }
        }
      }

      const newLinkTags = Array.from(linkTagSet.values());
      if (newLinkTags.length > 0) {
        await tx.linkTag.createMany({
          data: newLinkTags,
        });
      }

      result.linksTransferred = sourceLinks.length;
    }

    // Note: linkVisit and uniqueLinkVisit are NOT updated
    // They reference linkId, so analytics are preserved automatically

    // =========================================
    // Phase 4: Transfer QR Codes
    // =========================================
    const qrCodesUpdate = await tx.qrCode.updateMany({
      where: { userId: fromUserId, teamId: null },
      data: { userId: toUserId, teamId: null },
    });

    result.qrCodesTransferred = qrCodesUpdate.count;

    // =========================================
    // Phase 5: Transfer QR Presets
    // =========================================
    const qrPresetsUpdate = await tx.qrPreset.updateMany({
      where: { userId: fromUserId, teamId: null },
      data: { userId: toUserId, teamId: null },
    });

    result.qrPresetsTransferred = qrPresetsUpdate.count;

    // =========================================
    // Phase 6: Transfer Custom Domains
    // =========================================
    const domainsUpdate = await tx.customDomain.updateMany({
      where: { userId: fromUserId, teamId: null },
      data: { userId: toUserId, teamId: null },
    });

    result.customDomainsTransferred = domainsUpdate.count;

    // =========================================
    // Phase 7: Transfer UTM Templates
    // =========================================
    const utmUpdate = await tx.utmTemplate.updateMany({
      where: { userId: fromUserId, teamId: null },
      data: { userId: toUserId, teamId: null },
    });

    result.utmTemplatesTransferred = utmUpdate.count;

    // =========================================
    // Phase 7b: Transfer Bio Pages
    // =========================================
    // Backing links already moved in Phase 3 (they're personal links).
    // Reassigning BioPage ownership keeps the page + its blocks consistent with
    // those links. bioBlock / bioPageView rows reference ids, so need no change.
    const bioPagesUpdate = await tx.bioPage.updateMany({
      where: { userId: fromUserId, teamId: null },
      data: { userId: toUserId, teamId: null },
    });

    result.bioPagesTransferred = bioPagesUpdate.count;

    // =========================================
    // Phase 7c: Transfer Campaigns
    // =========================================
    // Member links already moved in Phase 3, so link.campaignId stays valid —
    // the campaign container just follows them to the new owner. Names and
    // slugs are unique per workspace (campaign_slug_workspace_unique), so any
    // source campaign colliding with the target's gets a numeric suffix
    // before the ownership flip.
    const [sourceCampaigns, targetCampaigns] = await Promise.all([
      tx.campaign.findMany({
        where: { userId: fromUserId, teamId: null },
        select: { id: true, slug: true, name: true },
      }),
      tx.campaign.findMany({
        where: { userId: toUserId, teamId: null },
        select: { slug: true, name: true },
      }),
    ]);

    const targetSlugs = new Set(targetCampaigns.map((c) => c.slug));
    const targetNames = new Set(targetCampaigns.map((c) => c.name.toLowerCase()));
    const allSlugs = new Set([...targetSlugs, ...sourceCampaigns.map((c) => c.slug)]);
    const allNames = new Set([...targetNames, ...sourceCampaigns.map((c) => c.name.toLowerCase())]);

    for (const sourceCampaign of sourceCampaigns) {
      const collides =
        targetSlugs.has(sourceCampaign.slug) || targetNames.has(sourceCampaign.name.toLowerCase());
      if (!collides) continue;

      let suffix = 2;
      let newSlug: string;
      let newName: string;
      do {
        newSlug = `${sourceCampaign.slug.slice(0, 100 - `-${suffix}`.length)}-${suffix}`;
        newName = `${sourceCampaign.name.slice(0, 100 - ` (${suffix})`.length)} (${suffix})`;
        suffix += 1;
      } while (allSlugs.has(newSlug) || allNames.has(newName.toLowerCase()));

      await tx.campaign.update({
        where: { id: sourceCampaign.id },
        data: { slug: newSlug, name: newName },
      });
      allSlugs.add(newSlug);
      allNames.add(newName.toLowerCase());
    }

    const campaignsUpdate = await tx.campaign.updateMany({
      where: { userId: fromUserId, teamId: null },
      data: { userId: toUserId, teamId: null },
    });

    result.campaignsTransferred = campaignsUpdate.count;

    // =========================================
    // Phase 8: Clean up source folders and tags
    // =========================================
    // Delete source folders (they've been recreated or merged)
    if (sourceFolders.length > 0) {
      await tx.folder.deleteMany({
        where: { userId: fromUserId, teamId: null },
      });
    }

    // Delete source tags (they've been recreated or merged)
    if (sourceTags.length > 0) {
      await tx.tag.deleteMany({
        where: { userId: fromUserId, teamId: null },
      });
    }

    // Note: API tokens and subscriptions are NOT transferred
    // Note: Source account is NOT deleted - user can continue using it or delete it manually
  });

  return result;
}

// ============================================================================
// CANCEL TRANSFER
// ============================================================================

export async function cancelAccountTransfer(ctx: ProtectedTRPCContext, input: CancelTransferInput) {
  const transfer = await ctx.prisma.accountTransfer.findFirst({
    where: { id: input.transferId },
  });

  if (!transfer) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Transfer not found",
    });
  }

  if (transfer.fromUserId !== ctx.auth.userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the source account can cancel a transfer",
    });
  }

  if (transfer.status !== "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only pending transfers can be cancelled",
    });
  }

  await ctx.prisma.accountTransfer.update({
    where: { id: input.transferId },
    data: { status: "cancelled" },
  });

  return { success: true };
}

// ============================================================================
// DECLINE TRANSFER (Recipient declines)
// ============================================================================

export async function declineAccountTransfer(ctx: ProtectedTRPCContext, input: { token: string }) {
  const transfer = await ctx.prisma.accountTransfer.findFirst({
    where: { token: input.token },
  });

  if (!transfer) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Transfer not found",
    });
  }

  // Verify current user is the target
  const currentUser = await ctx.prisma.user.findFirst({
    where: { id: ctx.auth.userId },
  });

  if (currentUser?.email?.toLowerCase() !== transfer.toEmail.toLowerCase()) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This transfer is for a different account",
    });
  }

  if (transfer.status !== "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This transfer is ${transfer.status} and cannot be declined`,
    });
  }

  // Mark as declined
  await ctx.prisma.accountTransfer.update({
    where: { id: transfer.id },
    data: { status: "declined" },
  });

  // Notify the source user
  const sourceUser = await ctx.prisma.user.findFirst({
    where: { id: transfer.fromUserId },
    select: { name: true, email: true },
  });

  if (sourceUser?.email) {
    void runBackgroundTask(
      sendTransferDeclinedEmail({
        toEmail: sourceUser.email,
        toName: sourceUser.name,
        recipientName: currentUser?.name ?? "the recipient",
        recipientEmail: currentUser?.email ?? transfer.toEmail,
      }),
    );
  }

  return { success: true };
}
