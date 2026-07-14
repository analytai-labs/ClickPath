import { Prisma } from "@prisma/client";

import { workspaceOwnership } from "@/server/lib/workspace";

import type { WorkspaceTRPCContext } from "../../trpc";

const getWorkspaceWhere = (workspace: WorkspaceTRPCContext["workspace"]) =>
  workspace.type === "team"
    ? { teamId: workspace.teamId }
    : { userId: workspace.userId, teamId: null };

// Create a new tag if it doesn't exist
// Uses transaction to prevent race conditions for personal workspace tags
// (MySQL unique constraint on (name, teamId) doesn't prevent duplicates when teamId is NULL)
export const createTag = async (ctx: WorkspaceTRPCContext, tagName: string) => {
  const normalizedName = tagName.toLowerCase().trim();
  const ownership = workspaceOwnership(ctx.workspace);

  // For team workspaces, the DB unique constraint handles uniqueness
  // For personal workspaces, we need atomic check-and-insert
  if (ctx.workspace.type === "team") {
    // Check if tag already exists for this team
    const existingTag = await ctx.prisma.tag.findFirst({
      where: {
        name: normalizedName,
        teamId: ctx.workspace.teamId,
      },
    });

    if (existingTag) {
      return existingTag;
    }

    // Create new tag - DB unique constraint prevents duplicates
    // Handle race condition: if another request creates the tag between our check and insert,
    // catch the duplicate key error and return the existing tag
    try {
      const createdTag = await ctx.prisma.tag.create({
        data: {
          name: normalizedName,
          userId: ownership.userId,
          teamId: ownership.teamId,
        },
      });

      return createdTag;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Another request created the tag concurrently, fetch and return it
        const createdTag = await ctx.prisma.tag.findFirst({
          where: {
            name: normalizedName,
            teamId: ctx.workspace.teamId,
          },
        });

        if (createdTag) {
          return createdTag;
        }
      }

      // Re-throw other errors
      throw error;
    }
  }

  // Personal workspace: use transaction for atomic check-and-insert
  // This prevents race conditions since MySQL allows multiple NULL values in unique constraint
  return ctx.prisma.$transaction(async (tx) => {
    // Check if tag already exists for this user's personal workspace
    const existingTag = await tx.tag.findFirst({
      where: {
        name: normalizedName,
        userId: ctx.auth.userId,
        teamId: null,
      },
    });

    if (existingTag) {
      return existingTag;
    }

    // Create new tag within transaction
    const createdTag = await tx.tag.create({
      data: {
        name: normalizedName,
        userId: ownership.userId,
        teamId: null,
      },
    });

    return createdTag;
  });
};

// Get all tags for a workspace
export const getUserTags = async (ctx: WorkspaceTRPCContext) => {
  return ctx.prisma.tag.findMany({
    where: getWorkspaceWhere(ctx.workspace),
    orderBy: { name: "asc" },
  });
};

// Associate tags with a link
export const associateTagsWithLink = async (
  ctx: WorkspaceTRPCContext,
  linkId: number,
  tagNames: string[],
) => {
  // Verify the link belongs to the current workspace before modifying
  const linkRecord = await ctx.prisma.link.findFirst({
    where: {
      id: linkId,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });

  if (!linkRecord) {
    // Link doesn't exist or doesn't belong to this workspace
    return;
  }

  // First, remove all existing tag associations for this link
  await ctx.prisma.linkTag.deleteMany({
    where: { linkId },
  });

  if (!tagNames.length) return;

  // Create or get tags and create associations
  const tagPromises = tagNames.map((tagName) => createTag(ctx, tagName));
  const tags = await Promise.all(tagPromises);

  // Create link-tag associations
  const linkTagValues = tags.map((tag) => ({
    linkId,
    tagId: Number(tag.id),
  }));

  await ctx.prisma.linkTag.createMany({
    data: linkTagValues,
  });
};

// Get tags for a specific link
// Verifies the link belongs to the current workspace before returning tags
export const getTagsForLink = async (ctx: WorkspaceTRPCContext, linkId: number) => {
  // Verify the link belongs to the current workspace
  const linkRecord = await ctx.prisma.link.findFirst({
    where: {
      id: linkId,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });

  if (!linkRecord) {
    // Link doesn't exist or doesn't belong to this workspace
    return [];
  }

  const result = await ctx.prisma.linkTag.findMany({
    where: { linkId },
    include: { tag: true },
  });

  return result.map((r) => ({
    id: r.tag.id,
    name: r.tag.name,
  }));
};

// Get links by tag
export const getLinksByTag = async (ctx: WorkspaceTRPCContext, tagName: string) => {
  const tagRecord = await ctx.prisma.tag.findFirst({
    where: {
      name: tagName.toLowerCase().trim(),
      ...getWorkspaceWhere(ctx.workspace),
    },
  });

  if (!tagRecord) {
    return [];
  }

  const result = await ctx.prisma.linkTag.findMany({
    where: { tagId: tagRecord.id },
    select: { linkId: true },
  });

  return result.map((r) => r.linkId);
};
