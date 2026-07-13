import { TRPCError } from "@trpc/server";
import { addDays } from "date-fns";
import * as crypto from "node:crypto";

import { redis } from "@/lib/core/cache";
import { getAppBaseDomain, isPlatformDomain } from "@/lib/constants/domains";
import { runBackgroundTask } from "@/lib/utils/background";
import { prisma } from "@/server/db";
import { RESERVED_TEAM_SLUGS } from "@/server/db/types";
import { sendTeamInviteEmail } from "@/server/lib/notifications/team-invite";
import {
  requireMinimumRole,
  requirePermission
} from "@/server/lib/workspace/permissions";

import type {
  ProtectedTRPCContext,
  TeamTRPCContext,
  WorkspaceTRPCContext,
} from "../../trpc";
import type {
  AcceptInviteInput,
  CreateTeamInput,
  InviteMemberInput,
  RemoveMemberInput,
  RevokeInviteInput,
  TransferOwnershipInput,
  UpdateMemberRoleInput,
  UpdateTeamInput,
  UpdateTeamSlugInput,
} from "./team.input";

// ============================================================================
// TEAM CRUD
// ============================================================================

/**
 * Create a new team (requires Ultra plan - enforced by procedure)
 */
export async function createTeam(
  ctx: ProtectedTRPCContext,
  input: CreateTeamInput
) {
  // Normalize and validate slug
  const normalizedSlug = input.slug.trim().toLowerCase();

  // Defense-in-depth: Check reserved slugs (also validated in Zod schema)
  if (RESERVED_TEAM_SLUGS.includes(normalizedSlug)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This team slug is reserved and cannot be used",
    });
  }

  // Check if slug is already taken (exclude soft-deleted teams)
  const existingTeam = await prisma.team.findFirst({
    where: { slug: normalizedSlug, deletedAt: null },
  });

  if (existingTeam) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This team slug is already taken",
    });
  }

  // Create team in transaction
  const result = await prisma.$transaction(async (tx) => {
    // Create the team with normalized slug
    const teamResult = await tx.team.create({
      data: {
        name: input.name,
        slug: normalizedSlug,
        ownerId: ctx.auth.userId,
      },
    });

    const teamId = teamResult.id;

    // Add owner as team member
    await tx.teamMember.create({
      data: {
        teamId,
        userId: ctx.auth.userId,
        role: "owner",
      },
    });

    return { teamId, slug: normalizedSlug };
  });

  return result;
}

/**
 * Get current team details (from workspace context)
 */
export async function getTeam(ctx: TeamTRPCContext) {
  return ctx.workspace.team;
}

/**
 * Update team settings
 */
export async function updateTeam(ctx: TeamTRPCContext, input: UpdateTeamInput) {
  requirePermission(ctx.workspace, "team.settings", "update team settings");

  if (input.defaultDomain && !isPlatformDomain(input.defaultDomain)) {
    const validDomain = await prisma.customDomain.findFirst({
      where: {
        domain: input.defaultDomain,
        teamId: ctx.workspace.teamId,
        status: "active",
      },
    });

    if (!validDomain) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid domain. Only verified custom domains belonging to this team can be set as default.",
      });
    }
  }

  const updatedTeam = await prisma.team.update({
    where: { id: ctx.workspace.teamId },
    data: {
      name: input.name,
      avatarUrl: input.avatarUrl,
      defaultDomain: input.defaultDomain,
    },
  });

  // Invalidate the team default domain cache
  await redis.del(`team_default_domain:${ctx.workspace.teamId}`);

  return updatedTeam;
}

/**
 * Update team slug (subdomain)
 */
export async function updateTeamSlug(
  ctx: TeamTRPCContext,
  input: UpdateTeamSlugInput
) {
  requireMinimumRole(ctx.workspace, "owner", "change team slug");

  // Normalize and validate slug
  const normalizedSlug = input.slug.trim().toLowerCase();

  // Defense-in-depth: Check reserved slugs (also validated in Zod schema)
  if (RESERVED_TEAM_SLUGS.includes(normalizedSlug)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This team slug is reserved and cannot be used",
    });
  }

  // Check if new slug is already taken (exclude soft-deleted teams)
  const existingTeam = await prisma.team.findFirst({
    where: { slug: normalizedSlug, deletedAt: null },
  });

  if (existingTeam && existingTeam.id !== ctx.workspace.teamId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This team slug is already taken",
    });
  }

  await prisma.team.update({
    where: { id: ctx.workspace.teamId },
    data: { slug: normalizedSlug },
  });

  return { slug: normalizedSlug };
}

/**
 * Delete team (owner only)
 * Implements soft delete with grace period - sets deletedAt timestamp.
 * A background cleanup job will permanently delete the team and its resources
 * after the grace period (30 days).
 */
export async function deleteTeam(ctx: TeamTRPCContext) {
  requirePermission(ctx.workspace, "team.delete", "delete team");

  // Soft delete: set deletedAt timestamp
  // Team resources (links, folders, QR codes, etc.) are preserved during grace period
  // A background cleanup job will permanently delete everything after 30 days
  await prisma.$transaction(async (tx) => {
    // Delete all pending invites (no need to preserve these)
    await tx.teamInvite.deleteMany({
      where: { teamId: ctx.workspace.teamId },
    });

    // Remove all members (they can no longer access the team)
    await tx.teamMember.deleteMany({
      where: { teamId: ctx.workspace.teamId },
    });

    // Soft delete the team by setting deletedAt
    await tx.team.update({
      where: { id: ctx.workspace.teamId },
      data: { deletedAt: new Date() },
    });
  });

  return { success: true };
}

/**
 * List all teams the user is a member of (excludes soft-deleted teams)
 */
export async function listUserTeams(ctx: ProtectedTRPCContext) {
  const memberships = await prisma.teamMember.findMany({
    where: { userId: ctx.auth.userId },
    include: {
      team: true,
    },
  });

  // Filter out soft-deleted teams
  return memberships
    .filter((m) => m.team.deletedAt === null)
    .map((m) => ({
      id: m.team.id,
      name: m.team.name,
      slug: m.team.slug,
      avatarUrl: m.team.avatarUrl,
      role: m.role,
    }));
}

/**
 * Check if a team slug is available
 * Excludes soft-deleted teams so slugs can be reused after cleanup
 */
export async function checkSlugAvailability(
  ctx: ProtectedTRPCContext,
  slug: string
) {
  // Check reserved slugs first
  if (RESERVED_TEAM_SLUGS.includes(slug)) {
    return { available: false, reason: "This slug is reserved and cannot be used" };
  }

  // Only check active teams (not soft-deleted)
  const existingTeam = await prisma.team.findFirst({
    where: { slug: slug, deletedAt: null },
  });

  if (existingTeam) {
    return { available: false, reason: "This slug is already taken" };
  }

  return { available: true };
}

// ============================================================================
// TEAM MEMBERS
// ============================================================================

/**
 * List all members of the current team
 */
export async function listMembers(ctx: TeamTRPCContext) {
  const members = await prisma.teamMember.findMany({
    where: { teamId: ctx.workspace.teamId },
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

  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    role: m.role,
    createdAt: m.createdAt,
    user: m.user,
  }));
}

/**
 * Update a member's role
 */
export async function updateMemberRole(
  ctx: TeamTRPCContext,
  input: UpdateMemberRoleInput
) {
  requirePermission(ctx.workspace, "team.settings", "update member role");

  // Cannot change owner's role
  const targetMember = await prisma.teamMember.findFirst({
    where: {
      teamId: ctx.workspace.teamId,
      userId: input.userId,
    },
  });

  if (!targetMember) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Member not found",
    });
  }

  if (targetMember.role === "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Cannot change the owner's role. Use transfer ownership instead.",
    });
  }

  // Admin cannot promote to admin (only owner can)
  if (input.role === "admin" && ctx.workspace.role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the team owner can promote members to admin",
    });
  }

  await prisma.teamMember.update({
    where: {
      unique_team_user: {
        teamId: ctx.workspace.teamId,
        userId: input.userId,
      }
    },
    data: { role: input.role },
  });

  return { success: true };
}

/**
 * Remove a member from the team
 */
export async function removeMember(
  ctx: TeamTRPCContext,
  input: RemoveMemberInput
) {
  requirePermission(ctx.workspace, "team.remove_member", "remove team member");

  // Cannot remove self if owner
  if (input.userId === ctx.auth.userId && ctx.workspace.role === "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Owner cannot leave the team. Transfer ownership first.",
    });
  }

  // Cannot remove owner
  const targetMember = await prisma.teamMember.findFirst({
    where: {
      teamId: ctx.workspace.teamId,
      userId: input.userId,
    },
  });

  if (!targetMember) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Member not found",
    });
  }

  if (targetMember.role === "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cannot remove the team owner",
    });
  }

  // Admin cannot remove other admins (only owner can)
  if (targetMember.role === "admin" && ctx.workspace.role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the team owner can remove admins",
    });
  }

  await prisma.teamMember.delete({
    where: {
      unique_team_user: {
        teamId: ctx.workspace.teamId,
        userId: input.userId,
      }
    },
  });

  return { success: true };
}

/**
 * Leave the team (for non-owners)
 */
export async function leaveTeam(ctx: TeamTRPCContext) {
  if (ctx.workspace.role === "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Owner cannot leave the team. Transfer ownership first or delete the team.",
    });
  }

  await prisma.teamMember.delete({
    where: {
      unique_team_user: {
        teamId: ctx.workspace.teamId,
        userId: ctx.auth.userId,
      }
    },
  });

  return { success: true };
}

/**
 * Transfer team ownership to another member
 */
export async function transferOwnership(
  ctx: TeamTRPCContext,
  input: TransferOwnershipInput
) {
  requireMinimumRole(ctx.workspace, "owner", "transfer team ownership");

  // Check if new owner is a member
  const newOwner = await prisma.teamMember.findFirst({
    where: {
      teamId: ctx.workspace.teamId,
      userId: input.newOwnerId,
    },
  });

  if (!newOwner) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "User is not a member of this team",
    });
  }

  // Transfer in transaction
  await prisma.$transaction(async (tx) => {
    // Demote current owner to admin
    await tx.teamMember.update({
      where: {
        unique_team_user: {
          teamId: ctx.workspace.teamId,
          userId: ctx.auth.userId,
        }
      },
      data: { role: "admin" },
    });

    // Promote new owner
    await tx.teamMember.update({
      where: {
        unique_team_user: {
          teamId: ctx.workspace.teamId,
          userId: input.newOwnerId,
        }
      },
      data: { role: "owner" },
    });

    // Update team owner reference
    await tx.team.update({
      where: { id: ctx.workspace.teamId },
      data: { ownerId: input.newOwnerId },
    });
  });

  return { success: true };
}

// ============================================================================
// TEAM INVITES
// ============================================================================

/**
 * Create an invite to join the team
 */
export async function createInvite(
  ctx: TeamTRPCContext,
  input: InviteMemberInput
) {
  requirePermission(ctx.workspace, "team.invite", "invite team members");

  // Only owners can create admin invites
  if (input.role === "admin" && ctx.workspace.role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the team owner can invite admins",
    });
  }

  // Generate secure token
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = addDays(new Date(), 7); // 7 day expiry

  // If email provided, check if already a member
  if (input.email) {
    const existingUser = await prisma.user.findFirst({
      where: { email: input.email },
    });

    if (existingUser) {
      const existingMember = await prisma.teamMember.findFirst({
        where: {
          teamId: ctx.workspace.teamId,
          userId: existingUser.id,
        },
      });

      if (existingMember) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This user is already a member of the team",
        });
      }
    }
  }

  const result = await prisma.teamInvite.create({
    data: {
      teamId: ctx.workspace.teamId,
      email: input.email ?? null,
      role: input.role,
      token,
      invitedBy: ctx.auth.userId,
      expiresAt,
    },
  });

  // Send email invitation if email provided
  if (input.email) {
    // Get inviter's name
    const inviter = await prisma.user.findFirst({
      where: { id: ctx.auth.userId },
      select: { name: true },
    });

    // Get recipient's name if they exist
    const recipient = await prisma.user.findFirst({
      where: { email: input.email },
      select: { name: true },
    });

    void runBackgroundTask(
      sendTeamInviteEmail({
        email: input.email,
        recipientName: recipient?.name || undefined,
        teamName: ctx.workspace.team.name,
        teamSlug: ctx.workspace.team.slug,
        inviterName: inviter?.name || "Someone",
        role: input.role,
        token,
      }),
    );
  }

  const baseDomain = getAppBaseDomain();

  return {
    inviteId: result.id,
    token,
    inviteUrl: `https://${baseDomain}/teams/accept-invite?token=${token}`,
    expiresAt,
  };
}

/**
 * List pending invites for the team
 */
export async function listInvites(ctx: TeamTRPCContext) {
  requirePermission(ctx.workspace, "team.invite", "view team invites");

  const invites = await prisma.teamInvite.findMany({
    where: { teamId: ctx.workspace.teamId },
    include: {
      inviter: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Filter out accepted invites
  return invites
    .filter((i) => !i.acceptedAt)
    .map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      token: i.token,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      invitedBy: i.inviter,
      isExpired: i.expiresAt < new Date(),
    }));
}

/**
 * Revoke a pending invite
 */
export async function revokeInvite(
  ctx: TeamTRPCContext,
  input: RevokeInviteInput
) {
  requirePermission(ctx.workspace, "team.invite", "revoke team invite");

  const invite = await prisma.teamInvite.findFirst({
    where: {
      id: input.inviteId,
      teamId: ctx.workspace.teamId,
    },
  });

  if (!invite) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invite not found",
    });
  }

  await prisma.teamInvite.delete({
    where: { id: input.inviteId },
  });

  return { success: true };
}

/**
 * Accept a team invite (called from personal context)
 */
export async function acceptInvite(
  ctx: ProtectedTRPCContext,
  input: AcceptInviteInput
) {
  const invite = await prisma.teamInvite.findFirst({
    where: { token: input.token },
    include: {
      team: true,
    },
  });

  if (!invite) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invalid invite token",
    });
  }

  // Check if team has been soft-deleted
  if (invite.team.deletedAt !== null) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This team no longer exists",
    });
  }

  if (invite.acceptedAt) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This invite has already been used",
    });
  }

  if (invite.expiresAt < new Date()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This invite has expired",
    });
  }

  // If invite is email-specific, verify it matches
  if (invite.email) {
    const currentUser = await prisma.user.findFirst({
      where: { id: ctx.auth.userId },
    });

    if (currentUser?.email !== invite.email) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This invite was sent to a different email address",
      });
    }
  }

  // Check if already a member
  const existingMember = await prisma.teamMember.findFirst({
    where: {
      teamId: invite.teamId,
      userId: ctx.auth.userId,
    },
  });

  if (existingMember) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "You are already a member of this team",
    });
  }

  // Accept invite in transaction
  await prisma.$transaction(async (tx) => {
    // Add user as member
    await tx.teamMember.create({
      data: {
        teamId: invite.teamId,
        userId: ctx.auth.userId,
        role: invite.role,
      },
    });

    // Mark invite as accepted
    await tx.teamInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
  });

  return {
    teamId: invite.team.id,
    teamSlug: invite.team.slug,
    teamName: invite.team.name,
  };
}

/**
 * Get invite details by token (public - for invite preview page)
 */
export async function getInviteByToken(
  ctx: ProtectedTRPCContext,
  token: string
) {
  const invite = await prisma.teamInvite.findFirst({
    where: { token },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          slug: true,
          avatarUrl: true,
          deletedAt: true,
        },
      },
      inviter: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!invite) {
    return null;
  }

  // Don't expose invites for soft-deleted teams
  if (invite.team.deletedAt !== null) {
    return null;
  }

  return {
    team: {
      id: invite.team.id,
      name: invite.team.name,
      slug: invite.team.slug,
      avatarUrl: invite.team.avatarUrl,
    },
    role: invite.role,
    invitedBy: invite.inviter,
    isExpired: invite.expiresAt < new Date(),
    isAccepted: !!invite.acceptedAt,
  };
}

// ============================================================================
// WORKSPACE INFO
// ============================================================================

/**
 * Get current workspace info (for UI state)
 */
export async function getCurrentWorkspace(ctx: WorkspaceTRPCContext) {
  if (ctx.workspace.type === "personal") {
    return {
      type: "personal" as const,
      plan: ctx.workspace.plan,
    };
  }

  return {
    type: "team" as const,
    teamId: ctx.workspace.teamId,
    teamSlug: ctx.workspace.teamSlug,
    teamName: ctx.workspace.team.name,
    teamAvatar: ctx.workspace.team.avatarUrl,
    role: ctx.workspace.role,
    plan: "ultra" as const,
  };
}
