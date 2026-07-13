import { TRPCError } from "@trpc/server";
import { PrismaClient, Team } from "@prisma/client";

import { resolvePlan } from "@/lib/billing/plans";
import { extractPlatformSubdomain } from "@/lib/constants/domains";
import { prisma } from "@/server/db";
import { RESERVED_TEAM_SLUGS } from "@/server/db/types";

import type { WorkspaceContext, PersonalWorkspaceContext, TeamWorkspaceContext } from "./types";

type DbClient = PrismaClient;

/**
 * Extracts the subdomain from a hostname.
 *
 * Any catalogue platform domain is accepted, so `acme.isht.ink` and
 * `acme.ishortn.ink` both resolve to team slug `acme`.
 *
 * Examples:
 * - "acme.isht.ink" -> "acme"
 * - "acme.ishortn.ink" -> "acme"
 * - "isht.ink" -> null
 * - "localhost:3000" -> null
 * - "acme.localhost:3000" -> "acme" (for local development)
 *
 * @param hostname - The full hostname from the request
 * @returns The subdomain or null if no subdomain
 */
export function extractSubdomain(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(":")[0] ?? hostname;

  let subdomain: string | null = extractPlatformSubdomain(host);

  // Check for local development subdomains (*.localhost)
  if (!subdomain && host.endsWith(".localhost")) {
    const parts = host.split(".");
    if (parts.length === 2) {
      const candidate = parts[0]?.trim().toLowerCase();
      if (candidate && candidate.length > 0) {
        subdomain = candidate;
      }
    }
  }

  // Don't treat reserved slugs as team subdomains
  // These are system subdomains (www, api, app, etc.) that should use personal workspace
  if (subdomain && RESERVED_TEAM_SLUGS.includes(subdomain)) {
    return null;
  }

  return subdomain;
}

/**
 * Resolves the workspace context for the current request.
 *
 * @param userId - The authenticated user's ID
 * @param hostname - The request hostname
 * @param dbClient - Optional database client (defaults to main db)
 * @returns The resolved workspace context
 */
export async function resolveWorkspaceContext(
  userId: string,
  hostname: string,
  dbClient: DbClient = prisma
): Promise<WorkspaceContext> {
  const subdomain = extractSubdomain(hostname);

  if (!subdomain) {
    // No subdomain -> personal workspace
    return getPersonalWorkspaceContext(userId, dbClient);
  }

  // Subdomain exists -> try to resolve team workspace
  return getTeamWorkspaceContext(userId, subdomain, dbClient);
}

/**
 * Gets the personal workspace context for a user.
 */
async function getPersonalWorkspaceContext(
  userId: string,
  dbClient: DbClient
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
  dbClient: DbClient
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
  dbClient: DbClient = prisma
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
  dbClient: DbClient = prisma
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
  dbClient: DbClient = prisma
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
