import type { PrismaClient, Team } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { resolvePlan } from "@/lib/billing/plans";
import { prisma } from "@/server/db";

import type { PersonalWorkspaceContext, TeamWorkspaceContext, WorkspaceContext } from "./types";

type DbClient = PrismaClient;



/**
 * Resolves the workspace context for the current request.
 *
 * @param userId - The authenticated user's ID
 * @param workspaceCookie - The clickpath-workspace cookie value
 * @param dbClient - Optional database client (defaults to main db)
 * @returns The resolved workspace context
 */
export async function resolveWorkspaceContext(
  userId: string,
  workspaceCookie: string | null,
  dbClient: DbClient = prisma,
): Promise<WorkspaceContext> {
  let teamSlug: string | null = null;
  
  if (workspaceCookie) {
    const match = workspaceCookie.match(/^team:(.+)$/);
    if (match && match[1]) {
      teamSlug = match[1];
    }
  }

  if (!teamSlug) {
    // No team cookie or it's 'personal' -> personal workspace
    return getPersonalWorkspaceContext(userId, dbClient);
  }

  try {
    return await getTeamWorkspaceContext(userId, teamSlug, dbClient);
  } catch (error) {
    // Fallback to personal workspace if the team doesn't exist or user lost access
    return getPersonalWorkspaceContext(userId, dbClient);
  }
}

/**
 * Gets the personal workspace context for a user.
 */
async function getPersonalWorkspaceContext(
  userId: string,
  dbClient: DbClient,
): Promise<PersonalWorkspaceContext> {
  // Fetch user with subscription to determine plan
  const userRecord = await dbClient.user.findFirst({
    where: { id: userId },
    include: {
      subscription: true,
    },
  });

  if (!userRecord) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "User not found",
    });
  }

  const plan = resolvePlan(userRecord.subscription ?? null);

  return {
    type: "personal",
    userId,
    teamId: null,
    teamSlug: null,
    role: "owner",
    plan,
  };
}

/**
 * Gets the team workspace context for a user by team slug.
 */
async function getTeamWorkspaceContext(
  userId: string,
  teamSlug: string,
  dbClient: DbClient,
): Promise<TeamWorkspaceContext> {
  // Fetch team by slug (exclude soft-deleted teams)
  const teamRecord = await dbClient.team.findFirst({
    where: { slug: teamSlug, deletedAt: null },
  });

  if (!teamRecord) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Team not found",
    });
  }

  // Check if user is a member of this team
  const membership = await dbClient.teamMember.findFirst({
    where: { teamId: teamRecord.id, userId: userId },
  });

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this team",
    });
  }

  return {
    type: "team",
    userId,
    teamId: teamRecord.id,
    teamSlug: teamRecord.slug,
    team: teamRecord,
    membership,
    role: membership.role,
    plan: "ultra", // Teams always have Ultra features
  };
}

/**
 * Gets the team workspace context by team ID (for internal use).
 */
export async function getTeamWorkspaceContextById(
  userId: string,
  teamId: number,
  dbClient: DbClient = prisma,
): Promise<TeamWorkspaceContext> {
  // Fetch team by ID (exclude soft-deleted teams)
  const teamRecord = await dbClient.team.findFirst({
    where: { id: teamId, deletedAt: null },
  });

  if (!teamRecord) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Team not found",
    });
  }

  // Check if user is a member of this team
  const membership = await dbClient.teamMember.findFirst({
    where: { teamId: teamRecord.id, userId: userId },
  });

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this team",
    });
  }

  return {
    type: "team",
    userId,
    teamId: teamRecord.id,
    teamSlug: teamRecord.slug,
    team: teamRecord,
    membership,
    role: membership.role,
    plan: "ultra",
  };
}

/**
 * Checks if a user has an Ultra plan subscription.
 * Required for team creation.
 */
export async function userHasUltraPlan(
  userId: string,
  dbClient: DbClient = prisma,
): Promise<boolean> {
  const userRecord = await dbClient.user.findFirst({
    where: { id: userId },
    include: {
      subscription: true,
    },
  });

  if (!userRecord) {
    return false;
  }

  const plan = resolvePlan(userRecord.subscription ?? null);
  return plan === "ultra";
}

/**
 * Gets all teams that a user is a member of (excludes soft-deleted teams).
 */
export async function getUserTeams(
  userId: string,
  dbClient: DbClient = prisma,
): Promise<Array<{ team: Team; role: string }>> {
  const memberships = await dbClient.teamMember.findMany({
    where: { userId: userId },
    include: {
      team: true,
    },
  });

  // Filter out soft-deleted teams
  return memberships
    .filter((m) => m.team.deletedAt === null)
    .map((m) => ({
      team: m.team,
      role: m.role,
    }));
}
