import { TRPCError } from "@trpc/server";

import { PLAN_CAPS, isSubscriptionEntitled, resolvePlan } from "@/lib/billing/plans";
import { requirePermission, workspaceOwnership } from "@/server/lib/workspace";

import {
  addDomainToVercelProject,
  deleteDomainFromVercelProject,
  getDomainFromVercelProject,
} from "./utils";

import type { WorkspaceTRPCContext } from "../../trpc";
import type { CreateCustomDomainInput } from "./domains.input";
import type { VercelConfigResponse } from "./domains.procedure";

export async function addDomainToUserAccount(
  ctx: WorkspaceTRPCContext,
  input: CreateCustomDomainInput,
) {
  // Check permission for domain creation (owners only in team workspaces)
  requirePermission(
    ctx.workspace,
    "domains.create",
    "add custom domains. Only team owners can manage domains",
  );

  const userId = ctx.auth.userId;

  const userSubscription = await ctx.prisma.subscription.findFirst({
    where: { userId },
  });

  if (!isSubscriptionEntitled(userSubscription)) {
    throw new Error("You need to have an active subscription to add a custom domain");
  }

  // Enforce the per-plan custom-domain cap (workspace-scoped)
  const plan = resolvePlan(userSubscription);
  const domainLimit = PLAN_CAPS[plan].domainLimit;

  if (domainLimit !== undefined) {
    const existingCount = await ctx.prisma.customDomain.count({
      where:
        ctx.workspace.type === "team"
          ? { teamId: ctx.workspace.teamId }
          : { userId: ctx.workspace.userId, teamId: null },
    });

    if (existingCount >= domainLimit) {
      throw new Error(
        `You've reached your plan's limit of ${domainLimit} custom domains. Upgrade to add more.`,
      );
    }
  }

  // remove http, https, and www. from the domain
  const domain = input.domain.replace("http://", "").replace("https://", "").replace("www.", "");

  const ownership = workspaceOwnership(ctx.workspace);

  // Check if the domain already exists in the current workspace
  const existingDomainInWorkspace = await ctx.prisma.customDomain.findFirst({
    where: {
      domain,
      ...(ctx.workspace.type === "team"
        ? { teamId: ctx.workspace.teamId }
        : { userId: ctx.workspace.userId, teamId: null }),
    },
  });

  if (existingDomainInWorkspace) {
    throw new Error("This domain is already added to this workspace");
  }

  try {
    const response = await addDomainToVercelProject(domain);

    // If domain already exists in Vercel (added by another workspace), get its current config
    if (response.alreadyExists) {
      const existingVercelDomain = await getDomainFromVercelProject(domain);

      if (!existingVercelDomain) {
        throw new Error("Failed to retrieve domain configuration");
      }

      // Check if it's properly configured
      const configResponse = await fetch(
        `https://api.vercel.com/v6/domains/${domain}/config?teamId=${process.env.TEAM_ID_VERCEL}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.AUTH_BEARER_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      const configData = (await configResponse.json()) as VercelConfigResponse;
      const wellConfigured = existingVercelDomain.verified && !configData.misconfigured;

      // Get verification details from existing domain
      const verificationDetails =
        existingVercelDomain.verification?.map((challenge) => {
          if (challenge.type === "TXT") {
            return {
              type: challenge.type,
              domain: "_vercel",
              value: challenge.value,
            };
          }
          return challenge;
        }) ?? [];

      await ctx.prisma.customDomain.create({
        data: {
          userId: ownership.userId,
          teamId: ownership.teamId,
          domain: domain,
          status: wellConfigured ? "active" : "pending",
          verificationDetails: verificationDetails,
        },
      });

      return { success: true };
    }

    const verificationChallenges = response.verificationChallenges;

    // for a verification challenge that has a type of "TXT", change the domain to be just
    // _vercel
    const verificationDetails = verificationChallenges.map((challenge) => {
      if (challenge.type === "TXT") {
        return {
          type: challenge.type,
          domain: "_vercel",
          value: challenge.value,
        };
      }

      return challenge;
    });

    let wellConfigured = false;

    if (response.verified) {
      // the domain is verified so let's check if it's misconfigured
      const configResponse = await fetch(
        `https://api.vercel.com/v6/domains/${domain}/config?teamId=${process.env.TEAM_ID_VERCEL}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${process.env.AUTH_BEARER_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      const data = (await configResponse.json()) as VercelConfigResponse;
      wellConfigured = !data.misconfigured;
    }

    await ctx.prisma.customDomain.create({
      data: {
        userId: ownership.userId,
        teamId: ownership.teamId,
        domain: domain,
        status: wellConfigured ? "active" : "pending",
        verificationDetails: verificationDetails,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Failed to add domain to Vercel project");
  }

  return { success: true };
}

export async function getCustomDomainsForUser(ctx: WorkspaceTRPCContext) {
  const customDomains = await ctx.prisma.customDomain.findMany({
    where:
      ctx.workspace.type === "team"
        ? { teamId: ctx.workspace.teamId }
        : { userId: ctx.workspace.userId, teamId: null },
  });

  return customDomains;
}

export async function deleteDomainAndAssociatedLinks(ctx: WorkspaceTRPCContext, domainId: number) {
  // Check permission for domain deletion (owners only in team workspaces)
  requirePermission(
    ctx.workspace,
    "domains.delete",
    "delete custom domains. Only team owners can manage domains",
  );

  const workspaceWhere =
    ctx.workspace.type === "team"
      ? { teamId: ctx.workspace.teamId }
      : { userId: ctx.workspace.userId, teamId: null };

  const domain = await ctx.prisma.customDomain.findFirst({
    where: {
      id: domainId,
      ...workspaceWhere,
    },
  });

  if (!domain) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Domain not found or you don't have permission to delete it",
    });
  }

  // Start a transaction to ensure all operations succeed or fail together
  return await ctx.prisma.$transaction(async (tx) => {
    // Delete all links associated with this domain
    const linksToDelete = await tx.link.findMany({
      where: {
        domain: domain.domain!,
        ...workspaceWhere,
      },
      select: { id: true },
    });

    const linkIds = linksToDelete.map((link) => link.id);

    // delete all link visits
    if (linkIds.length > 0) {
      await tx.linkVisit.deleteMany({
        where: { linkId: { in: linkIds } },
      });
    }

    // delete all links
    await tx.link.deleteMany({
      where: {
        domain: domain.domain!,
        ...workspaceWhere,
      },
    });

    // Check if other workspaces are using this domain BEFORE deleting
    const otherWorkspacesUsingDomain = await tx.customDomain.findFirst({
      where: {
        domain: domain.domain!,
        id: { not: domainId },
      },
    });

    // If no other workspaces use this domain, delete from Vercel first
    if (!otherWorkspacesUsingDomain) {
      await deleteDomainFromVercelProject(domain.domain!);
    }

    // Delete the domain record from our database
    await tx.customDomain.delete({
      where: { id: domainId },
    });

    return { success: true, message: "Domain and associated links deleted successfully" };
  });
}

export async function getDomainStatistics(ctx: WorkspaceTRPCContext, domain: string) {
  const workspaceWhere =
    ctx.workspace.type === "team"
      ? { teamId: ctx.workspace.teamId }
      : { userId: ctx.workspace.userId, teamId: null };

  // Get all links for this domain in the current workspace
  const domainLinks = await ctx.prisma.link.findMany({
    where: {
      domain,
      ...workspaceWhere,
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  const linkIds = domainLinks.map((l) => l.id);

  // Calculate link count
  const linkCount = domainLinks.length;

  // Calculate total clicks (raw visits + archived clicks rolled up by the
  // analytics cleanup job)
  let totalClicks = 0;
  if (linkIds.length > 0) {
    const [clicksCount, archivedResult] = await Promise.all([
      ctx.prisma.linkVisit.count({
        where: { linkId: { in: linkIds } },
      }),
      ctx.prisma.linkVisitDailySummary.aggregate({
        _sum: { clicks: true },
        where: { linkId: { in: linkIds } },
      }),
    ]);

    totalClicks = clicksCount + (Number(archivedResult._sum.clicks) || 0);
  }

  // Find last used date (most recent link creation)
  const lastUsedAt =
    domainLinks.length > 0
      ? domainLinks.reduce(
          (latest, current) => {
            const currentDate = current.createdAt ? new Date(current.createdAt) : null;
            if (!currentDate) return latest;
            if (!latest) return currentDate;
            return currentDate > latest ? currentDate : latest;
          },
          null as Date | null,
        )
      : null;

  return {
    linkCount,
    totalClicks,
    lastUsedAt,
  };
}
