import { TRPCError } from "@trpc/server";

import { getPlanCaps } from "@/lib/billing/plans";
import { isPlatformDomain } from "@/lib/constants/domains";
import { prisma } from "@/server/db";
import {
  getTeamWorkspaceContextById,
  getUserTeams,
} from "@/server/lib/workspace/workspace.service";
import {
  workspaceOwnership,
} from "@/server/lib/workspace";
import { getUserPlanContext } from "@/server/lib/user-plan";

import type { WorkspaceContext } from "@/server/lib/workspace/types";
import type { WorkspaceTRPCContext } from "../../trpc";

// ============================================================================
// INPUT TYPES
// ============================================================================

export interface TransferLinksInput {
  linkIds: number[];
  targetWorkspaceType: "personal" | "team";
  targetTeamId?: number; // Required if targetWorkspaceType === "team"
}

export interface AvailableWorkspace {
  id: string; // "personal" or "team-{teamId}"
  type: "personal" | "team";
  teamId: number | null;
  name: string;
  slug: string | null;
  role: "owner" | "admin" | "member";
  plan: string;
  linkCount: number;
  linkLimit: number | undefined;
  isCurrent: boolean;
}

export interface TransferValidationResult {
  isValid: boolean;
  errors: Array<{
    type: "ALIAS_COLLISION" | "DOMAIN_MISSING" | "LIMIT_EXCEEDED" | "PERMISSION_DENIED" | "SAME_WORKSPACE";
    message: string;
    details?: Record<string, unknown>;
  }>;
  warnings: Array<{
    type: "TAGS_DROPPED" | "FOLDERS_RESET" | "QR_TRANSFERRED";
    message: string;
    count: number;
  }>;
  targetWorkspace: WorkspaceContext | null;
  linksCount: number;
}

export interface TransferResult {
  success: boolean;
  transferredCount: number;
  tagsDropped: number;
  qrCodesTransferred: number;
}

// ============================================================================
// GET AVAILABLE WORKSPACES
// ============================================================================

export async function getAvailableWorkspaces(
  ctx: WorkspaceTRPCContext
): Promise<AvailableWorkspace[]> {
  const workspaces: AvailableWorkspace[] = [];

  // Get personal workspace info
  const personalLinkCount = await prisma.link.count({
    where: { userId: ctx.auth.userId, teamId: null }
  });

  const planCtx = await getUserPlanContext(ctx.auth.userId, prisma as any);
  const personalPlan = planCtx?.plan ?? "free";
  const personalLimit = planCtx?.caps.linksLimit;

  const isCurrentPersonal = ctx.workspace.type === "personal";

  workspaces.push({
    id: "personal",
    type: "personal",
    teamId: null,
    name: "Personal Workspace",
    slug: null,
    role: "owner",
    plan: personalPlan,
    linkCount: personalLinkCount,
    linkLimit: personalLimit,
    isCurrent: isCurrentPersonal,
  });

  // Get user's teams
  const userTeams = await getUserTeams(ctx.auth.userId, prisma as any);

  for (const { team, role } of userTeams) {
    const teamLinkCount = await prisma.link.count({
      where: { teamId: team.id }
    });

    const isCurrent =
      ctx.workspace.type === "team" && ctx.workspace.teamId === team.id;

    workspaces.push({
      id: `team-${team.id}`,
      type: "team",
      teamId: team.id,
      name: team.name,
      slug: team.slug,
      role: role as "owner" | "admin" | "member",
      plan: "ultra", // Teams always have Ultra
      linkCount: teamLinkCount,
      linkLimit: undefined, // Teams have unlimited links
      isCurrent,
    });
  }

  return workspaces;
}

// ============================================================================
// VALIDATE TRANSFER
// ============================================================================

export async function validateTransfer(
  ctx: WorkspaceTRPCContext,
  input: TransferLinksInput
): Promise<TransferValidationResult> {
  const { linkIds, targetWorkspaceType, targetTeamId } = input;
  const errors: TransferValidationResult["errors"] = [];
  const warnings: TransferValidationResult["warnings"] = [];

  // Check source workspace permissions
  // For team workspaces, only admin/owner can transfer out
  if (ctx.workspace.type === "team") {
    const allowedRoles = ["owner", "admin"];
    if (!allowedRoles.includes(ctx.workspace.role)) {
      errors.push({
        type: "PERMISSION_DENIED",
        message: "Only team owners and admins can transfer links to other workspaces",
      });
      return {
        isValid: false,
        errors,
        warnings,
        targetWorkspace: null,
        linksCount: linkIds.length,
      };
    }
  }

  // Resolve target workspace
  let targetWorkspace: WorkspaceContext;

  if (targetWorkspaceType === "team") {
    if (!targetTeamId) {
      errors.push({
        type: "PERMISSION_DENIED",
        message: "Target team ID is required for team workspace transfers",
      });
      return {
        isValid: false,
        errors,
        warnings,
        targetWorkspace: null,
        linksCount: linkIds.length,
      };
    }

    try {
      targetWorkspace = await getTeamWorkspaceContextById(
        ctx.auth.userId,
        targetTeamId,
        prisma as any
      );
    } catch {
      errors.push({
        type: "PERMISSION_DENIED",
        message: "You are not a member of the target team",
      });
      return {
        isValid: false,
        errors,
        warnings,
        targetWorkspace: null,
        linksCount: linkIds.length,
      };
    }
  } else {
    // Personal workspace
    const planCtx = await getUserPlanContext(ctx.auth.userId, prisma as any);
    targetWorkspace = {
      type: "personal",
      userId: ctx.auth.userId,
      teamId: null,
      teamSlug: null,
      role: "owner",
      plan: planCtx?.plan ?? "free",
    };
  }

  // Check if transferring to same workspace
  if (
    (ctx.workspace.type === "personal" && targetWorkspace.type === "personal") ||
    (ctx.workspace.type === "team" &&
      targetWorkspace.type === "team" &&
      ctx.workspace.teamId === targetWorkspace.teamId)
  ) {
    errors.push({
      type: "SAME_WORKSPACE",
      message: "Cannot transfer links to the same workspace",
    });
    return {
      isValid: false,
      errors,
      warnings,
      targetWorkspace,
      linksCount: linkIds.length,
    };
  }

  // Verify all links exist and belong to source workspace
  const sourceLinks = await prisma.link.findMany({
    where: {
      id: { in: linkIds },
      ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null })
    }
  });

  if (sourceLinks.length !== linkIds.length) {
    errors.push({
      type: "PERMISSION_DENIED",
      message: `Some links not found in current workspace. Found ${sourceLinks.length} of ${linkIds.length} links.`,
    });
    return {
      isValid: false,
      errors,
      warnings,
      targetWorkspace,
      linksCount: linkIds.length,
    };
  }

  // Check target workspace link limits (only for personal workspace)
  if (targetWorkspace.type === "personal") {
    const planCtx = await getUserPlanContext(ctx.auth.userId, prisma as any);
    const limit = planCtx?.caps.linksLimit;

    if (limit !== undefined) {
      const currentCount = await prisma.link.count({
        where: { userId: ctx.auth.userId, teamId: null }
      });

      const newTotal = currentCount + linkIds.length;

      if (newTotal > limit) {
        errors.push({
          type: "LIMIT_EXCEEDED",
          message: `Transfer would exceed target workspace limit. Current: ${currentCount}, Limit: ${limit}, Transferring: ${linkIds.length}`,
          details: {
            currentCount: currentCount,
            limit,
            transferring: linkIds.length,
          },
        });
      }
    }
  }

  // Check for alias collisions in target workspace
  const domains = Array.from(new Set(sourceLinks.map((l) => l.domain)));

  for (const domain of domains) {
    const aliasesForDomain = sourceLinks
      .filter((l) => l.domain === domain)
      .map((l) => l.alias)
      .filter(Boolean) as string[];

    if (aliasesForDomain.length === 0) continue;

    const existingAliases = await prisma.link.findMany({
      select: { alias: true },
      where: {
        alias: { in: aliasesForDomain },
        domain: domain,
        ...(targetWorkspace.type === "team" ? { teamId: targetWorkspace.teamId } : { userId: ctx.auth.userId, teamId: null })
      }
    });

    if (existingAliases.length > 0) {
      errors.push({
        type: "ALIAS_COLLISION",
        message: `Alias collision on ${domain}: ${existingAliases.map((a) => a.alias).join(", ")}`,
        details: {
          domain,
          aliases: existingAliases.map((a) => a.alias),
        },
      });
    }
  }

  // Check custom domain availability in target workspace
  const customDomains = [
    ...new Set(sourceLinks.filter((l) => !isPlatformDomain(l.domain)).map((l) => l.domain)),
  ];

  if (customDomains.length > 0) {
    const targetDomains = await prisma.customDomain.findMany({
      where: {
        domain: { in: customDomains },
        ...(targetWorkspace.type === "team" ? { teamId: targetWorkspace.teamId } : { userId: ctx.auth.userId, teamId: null })
      }
    });

    const targetDomainSet = new Set(targetDomains.map((d) => d.domain));
    const missingDomains = customDomains.filter((d) => !targetDomainSet.has(d));

    if (missingDomains.length > 0) {
      errors.push({
        type: "DOMAIN_MISSING",
        message: `Custom domains not available in target workspace: ${missingDomains.join(", ")}`,
        details: { domains: missingDomains },
      });
    }
  }

  // Calculate warnings
  // Tags to be dropped
  const tagCount = await prisma.linkTag.count({
    where: { linkId: { in: linkIds } }
  });

  if (tagCount > 0) {
    warnings.push({
      type: "TAGS_DROPPED",
      message: `${tagCount} tag associations will be removed (tags are workspace-specific)`,
      count: tagCount,
    });
  }

  // Folders to be reset
  const linksWithFolders = sourceLinks.filter((l) => l.folderId !== null);
  if (linksWithFolders.length > 0) {
    warnings.push({
      type: "FOLDERS_RESET",
      message: `${linksWithFolders.length} links will be removed from their folders`,
      count: linksWithFolders.length,
    });
  }

  // QR codes to be transferred
  const qrCodeCount = await prisma.qrCode.count({
    where: { linkId: { in: linkIds } }
  });

  if (qrCodeCount > 0) {
    warnings.push({
      type: "QR_TRANSFERRED",
      message: `${qrCodeCount} QR codes will be transferred with the links`,
      count: qrCodeCount,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    targetWorkspace,
    linksCount: linkIds.length,
  };
}

// ============================================================================
// EXECUTE TRANSFER
// ============================================================================

export async function transferLinksToWorkspace(
  ctx: WorkspaceTRPCContext,
  input: TransferLinksInput
): Promise<TransferResult> {
  const { linkIds, targetWorkspaceType, targetTeamId } = input;

  // Validate the transfer first
  const validation = await validateTransfer(ctx, input);

  if (!validation.isValid) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: validation.errors[0]?.message ?? "Transfer validation failed",
    });
  }

  if (!validation.targetWorkspace) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Target workspace could not be resolved",
    });
  }

  const targetOwnership = workspaceOwnership(validation.targetWorkspace);

  // Execute transfer in transaction
  return await prisma.$transaction(async (tx) => {
    // 1. Update link ownership and reset folder
    await tx.link.updateMany({
      where: {
        id: { in: linkIds },
        ...(ctx.workspace.type === "team" ? { teamId: ctx.workspace.teamId } : { userId: ctx.workspace.userId, teamId: null })
      },
      data: {
        userId: targetOwnership.userId,
        teamId: targetOwnership.teamId,
        folderId: null, // Reset folder assignment
        campaignId: null, // Campaigns are workspace-scoped too
      }
    });

    // 2. Delete tag associations (tags are workspace-scoped)
    await tx.linkTag.deleteMany({
      where: { linkId: { in: linkIds } }
    });

    // 3. Transfer QR codes
    await tx.qrCode.updateMany({
      where: { linkId: { in: linkIds } },
      data: {
        userId: targetOwnership.userId,
        teamId: targetOwnership.teamId,
      }
    });

    // Note: linkVisit and uniqueLinkVisit are NOT updated
    // They reference linkId, not workspace, so analytics are preserved

    return {
      success: true,
      transferredCount: linkIds.length,
      tagsDropped: validation.warnings.find((w) => w.type === "TAGS_DROPPED")?.count ?? 0,
      qrCodesTransferred: validation.warnings.find((w) => w.type === "QR_TRANSFERRED")?.count ?? 0,
    };
  });
}
