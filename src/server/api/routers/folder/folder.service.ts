import { TRPCError } from "@trpc/server";

import { getPlanCaps } from "@/lib/billing/plans";
import {
  getAccessibleFolderIds,
  getFolderPermissionMap,
  isWorkspaceAdmin,
  requireFolderAccess,
  requireFolderPermissionManagement,
  shouldBypassFolderPermissions,
  workspaceOwnership,
} from "@/server/lib/workspace";
import { getTagsForLink } from "../tag/tag.service";

import type { WorkspaceTRPCContext } from "../../trpc";
import type {
  CreateFolderInput,
  DeleteFolderInput,
  GetFolderInput,
  GetFolderPermissionsInput,
  MoveBulkLinksToFolderInput,
  MoveLinkToFolderInput,
  UpdateFolderInput,
  UpdateFolderPermissionsInput,
} from "./folder.input";

const getWorkspaceWhere = (workspace: any) =>
  workspace.type === "team"
    ? { teamId: workspace.teamId }
    : { userId: workspace.userId, teamId: null };

export const createFolder = async (
  ctx: WorkspaceTRPCContext,
  input: CreateFolderInput
) => {
  // Use workspace plan - team workspaces have Ultra features (unlimited folders)
  const workspacePlan = ctx.workspace.plan;
  const caps = getPlanCaps(workspacePlan);
  const folderLimit = caps.folderLimit;

  if (folderLimit === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Folders are available on Pro and Ultra plans. Upgrade to create folders.",
    });
  }

  const ownership = workspaceOwnership(ctx.workspace);

  // Use transaction to atomically check limits, duplicates, and insert
  return await ctx.prisma.$transaction(async (tx) => {
    // Team workspaces (Ultra) have no folder limit (undefined)
    if (folderLimit !== undefined) {
      const currentFolders = await tx.folder.count({
        where: getWorkspaceWhere(ctx.workspace),
      });

      if (currentFolders >= folderLimit) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "You have reached your folder limit. Upgrade to Ultra for unlimited folders.",
        });
      }
    }

    // Check for duplicate folder name in workspace
    const existingFolder = await tx.folder.findFirst({
      where: {
        name: input.name,
        ...getWorkspaceWhere(ctx.workspace),
      },
    });

    if (existingFolder) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A folder with this name already exists",
      });
    }

    const inserted = await tx.folder.create({
      data: {
        name: input.name,
        description: input.description,
        userId: ownership.userId,
        teamId: ownership.teamId,
      },
    });

    if (!inserted) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create folder",
      });
    }

    return {
      id: inserted.id,
      name: input.name,
      description: input.description,
    };
  });
};

export const listFolders = async (ctx: WorkspaceTRPCContext) => {
  // Get all folders in workspace
  const allFolders = await ctx.prisma.folder.findMany({
    where: getWorkspaceWhere(ctx.workspace),
    orderBy: { createdAt: "desc" },
  });

  // Filter folders based on access permissions (for team members)
  let accessibleFolders = allFolders;
  if (
    ctx.workspace.type === "team" &&
    !shouldBypassFolderPermissions(ctx.workspace)
  ) {
    const folderIds = allFolders.map((f) => f.id);
    const accessibleIds = await getAccessibleFolderIds(
      ctx.prisma,
      ctx.workspace,
      folderIds
    );
    accessibleFolders = allFolders.filter((f) => accessibleIds.includes(f.id));
  }

  // Get permission info for displaying in UI (only for admins/owners in team workspaces)
  let permissionMap = new Map<number, string[]>();
  if (ctx.workspace.type === "team" && isWorkspaceAdmin(ctx.workspace)) {
    const folderIds = accessibleFolders.map((f) => f.id);
    permissionMap = await getFolderPermissionMap(ctx.prisma, folderIds);
  }

  // Get link counts for each folder
  const foldersWithCounts = await Promise.all(
    accessibleFolders.map(async (folderItem) => {
      const linkCount = await ctx.prisma.link.count({
        where: {
          ...getWorkspaceWhere(ctx.workspace),
          folderId: folderItem.id,
        },
      });

      const permittedUserIds = permissionMap.get(folderItem.id) ?? [];

      return {
        ...folderItem,
        linkCount,
        // Permission info for UI (only populated for admins/owners)
        hasRestrictions: permittedUserIds.length > 0,
        permittedUserIds,
      };
    })
  );

  return foldersWithCounts;
};

export const getFolder = async (
  ctx: WorkspaceTRPCContext,
  input: GetFolderInput
) => {
  const folderData = await ctx.prisma.folder.findFirst({
    where: {
      id: input.id,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });

  if (!folderData) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Folder not found",
    });
  }

  // Check access permission for team members
  await requireFolderAccess(ctx.prisma, ctx.workspace, input.id);

  const folderLinksRaw = await ctx.prisma.link.findMany({
    where: {
      folderId: input.id,
      ...getWorkspaceWhere(ctx.workspace),
    },
    include: {
      _count: {
        select: { linkVisits: true },
      },
      dailySummaries: {
        select: { clicks: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch tags for each link
  const linksWithTags = await Promise.all(
    folderLinksRaw.map(async (linkItem) => {
      const tagRecords = await getTagsForLink(ctx, linkItem.id);
      
      const archivedClicks = linkItem.dailySummaries.reduce((sum, s) => sum + s.clicks, 0);
      const { _count, dailySummaries, ...rest } = linkItem;

      return {
        ...rest,
        totalClicks: _count.linkVisits + archivedClicks,
        tags: tagRecords.map((tagRecord) => tagRecord.name),
        folder: { id: folderData.id, name: folderData.name },
      };
    })
  );

  return {
    ...folderData,
    links: linksWithTags,
  };
};

export const updateFolder = async (
  ctx: WorkspaceTRPCContext,
  input: UpdateFolderInput
) => {
  // Check if folder exists and belongs to workspace
  const existingFolder = await ctx.prisma.folder.findFirst({
    where: {
      id: input.id,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });

  if (!existingFolder) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Folder not found",
    });
  }

  // Check access permission for team members
  await requireFolderAccess(ctx.prisma, ctx.workspace, input.id);

  // Check for duplicate name (excluding current folder)
  const duplicateFolder = await ctx.prisma.folder.findFirst({
    where: {
      name: input.name,
      ...getWorkspaceWhere(ctx.workspace),
      id: { not: input.id },
    },
  });

  if (duplicateFolder) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A folder with this name already exists",
    });
  }

  await ctx.prisma.folder.updateMany({
    where: {
      id: input.id,
      ...getWorkspaceWhere(ctx.workspace),
    },
    data: {
      name: input.name,
      description: input.description,
    },
  });

  return {
    id: input.id,
    name: input.name,
    description: input.description,
  };
};

export const deleteFolder = async (
  ctx: WorkspaceTRPCContext,
  input: DeleteFolderInput
) => {
  // Check if folder exists and belongs to workspace
  const existingFolder = await ctx.prisma.folder.findFirst({
    where: {
      id: input.id,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });

  if (!existingFolder) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Folder not found",
    });
  }

  // Check access permission for team members
  await requireFolderAccess(ctx.prisma, ctx.workspace, input.id);

  // Use transaction to delete folder, permissions, and update links atomically
  await ctx.prisma.$transaction(async (tx) => {
    // Move all links in this folder to unfoldered (folderId = null)
    await tx.link.updateMany({
      where: {
        folderId: input.id,
        ...getWorkspaceWhere(ctx.workspace),
      },
      data: { folderId: null },
    });

    // Delete folder permissions
    await tx.folderPermission.deleteMany({
      where: { folderId: input.id },
    });

    // Delete the folder
    await tx.folder.delete({
      where: { id: input.id },
    });
  });

  return { success: true };
};

export const moveLinkToFolder = async (
  ctx: WorkspaceTRPCContext,
  input: MoveLinkToFolderInput
) => {
  // Check if link exists and belongs to workspace
  const existingLink = await ctx.prisma.link.findFirst({
    where: {
      id: input.linkId,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });

  if (!existingLink) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Link not found",
    });
  }

  // If folderId is provided, check if folder exists and belongs to workspace
  if (input.folderId !== null) {
    const folderId = input.folderId;
    const existingFolder = await ctx.prisma.folder.findFirst({
      where: {
        id: folderId,
        ...getWorkspaceWhere(ctx.workspace),
      },
    });

    if (!existingFolder) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Folder not found",
      });
    }

    // Check access permission for team members
    await requireFolderAccess(ctx.prisma, ctx.workspace, folderId);
  }

  // Update link's folderId
  await ctx.prisma.link.update({
    where: { id: input.linkId },
    data: { folderId: input.folderId },
  });

  return { success: true };
};

export const moveBulkLinksToFolder = async (
  ctx: WorkspaceTRPCContext,
  input: MoveBulkLinksToFolderInput
) => {
  if (input.linkIds.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No links selected",
    });
  }

  // If folderId is provided, check if folder exists and belongs to workspace
  if (input.folderId !== null) {
    const folderId = input.folderId;
    const existingFolder = await ctx.prisma.folder.findFirst({
      where: {
        id: folderId,
        ...getWorkspaceWhere(ctx.workspace),
      },
    });

    if (!existingFolder) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Folder not found",
      });
    }

    // Check access permission for team members
    await requireFolderAccess(ctx.prisma, ctx.workspace, folderId);
  }

  // Update all links in the array
  await ctx.prisma.link.updateMany({
    where: {
      id: { in: input.linkIds },
      ...getWorkspaceWhere(ctx.workspace),
    },
    data: { folderId: input.folderId },
  });

  return {
    success: true,
    count: input.linkIds.length,
  };
};

export const getFolderStats = async (ctx: WorkspaceTRPCContext) => {
  const folderCount = await ctx.prisma.folder.count({
    where: getWorkspaceWhere(ctx.workspace),
  });

  return {
    totalFolders: folderCount,
  };
};

/**
 * Get folder permissions (for permission management UI)
 * Only available to team admins and owners
 */
export const getFolderPermissions = async (
  ctx: WorkspaceTRPCContext,
  input: GetFolderPermissionsInput
) => {
  // Require admin/owner role
  requireFolderPermissionManagement(ctx.workspace);

  // Verify folder exists and belongs to workspace
  const folderData = await ctx.prisma.folder.findFirst({
    where: {
      id: input.folderId,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });

  if (!folderData) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Folder not found",
    });
  }

  // Get permissions with user info
  const permissions = await ctx.prisma.folderPermission.findMany({
    where: { folderId: input.folderId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          imageUrl: true,
        },
      },
    },
  });

  return {
    folderId: input.folderId,
    folderName: folderData.name,
    isRestricted: folderData.isRestricted,
    permittedUsers: permissions.map((p) => p.user),
  };
};

/**
 * Update folder permissions (set which members can access the folder)
 * Only available to team admins and owners
 *
 * Permission Semantics:
 * - isRestricted=false: all team members can access (userIds ignored)
 * - isRestricted=true with userIds: only admins/owners + specified users can access
 * - isRestricted=true with empty userIds: only admins/owners can access
 */
export const updateFolderPermissions = async (
  ctx: WorkspaceTRPCContext,
  input: UpdateFolderPermissionsInput
) => {
  // Require admin/owner role
  requireFolderPermissionManagement(ctx.workspace);

  // Verify folder exists and belongs to workspace
  const folderData = await ctx.prisma.folder.findFirst({
    where: {
      id: input.folderId,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });

  if (!folderData) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Folder not found",
    });
  }

  // De-duplicate userIds (only relevant if isRestricted=true)
  const uniqueUserIds = input.isRestricted ? [...new Set(input.userIds)] : [];

  // Validate userIds are actual team members (if any provided)
  if (
    uniqueUserIds.length > 0 &&
    ctx.workspace.type === "team" &&
    ctx.workspace.teamId
  ) {
    const validMembers = await ctx.prisma.teamMember.findMany({
      where: {
        teamId: ctx.workspace.teamId,
        userId: { in: uniqueUserIds },
      },
      select: { userId: true },
    });

    const validUserIds = new Set(validMembers.map((m) => m.userId));
    const invalidUserIds = uniqueUserIds.filter((id) => !validUserIds.has(id));

    if (invalidUserIds.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid user IDs: ${invalidUserIds.join(", ")}. Users must be team members.`,
      });
    }
  }

  await ctx.prisma.$transaction(async (tx) => {
    // Update the folder's isRestricted flag
    await tx.folder.update({
      where: { id: input.folderId },
      data: { isRestricted: input.isRestricted },
    });

    // Remove all existing permissions for this folder
    await tx.folderPermission.deleteMany({
      where: { folderId: input.folderId },
    });

    // If restricted with specific users, create permission records
    if (input.isRestricted && uniqueUserIds.length > 0) {
      await tx.folderPermission.createMany({
        data: uniqueUserIds.map((userId) => ({
          folderId: input.folderId,
          userId,
        })),
      });
    }
  });

  return {
    success: true,
    folderId: input.folderId,
    isRestricted: input.isRestricted,
    permittedUserCount: uniqueUserIds.length,
  };
};
