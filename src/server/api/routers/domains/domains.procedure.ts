import { z } from "zod";

import { getPlanCaps, isUnlimitedDomains, resolvePlan } from "@/lib/billing/plans";
import { logger } from "@/lib/logger";
import { createTRPCRouter, workspaceProcedure } from "@/server/api/trpc";

import * as input from "./domains.input";
import * as services from "./domains.service";
import { getCustomHostnameFromCloudflare } from "./utils";

const log = logger.child({ component: "domains.procedure" });

export const customDomainRouter = createTRPCRouter({
  create: workspaceProcedure
    .input(input.createCustomDomainSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findFirst({
        where: { id: ctx.auth.userId },
        include: { subscription: true },
      });

      const plan = resolvePlan(user?.subscription);

      if (!isUnlimitedDomains(plan)) {
        const caps = getPlanCaps(plan);
        const domainCount = await ctx.prisma.customDomain.count({
          where:
            ctx.workspace.type === "team"
              ? { teamId: ctx.workspace.teamId }
              : { userId: ctx.workspace.userId, teamId: null },
        });

        if (domainCount >= (caps.domainLimit ?? 0)) {
          throw new Error(
            `You have reached the limit of ${caps.domainLimit} custom domains for your plan. Please upgrade to add more.`,
          );
        }
      }

      return services.addDomainToUserAccount(ctx, input);
    }),

  list: workspaceProcedure.query(async ({ ctx }) => {
    return services.getCustomDomainsForUser(ctx);
  }),

  delete: workspaceProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return services.deleteDomainAndAssociatedLinks(ctx, input.id);
    }),

  getStats: workspaceProcedure
    .input(z.object({ domain: z.string() }))
    .query(async ({ ctx, input }) => {
      return services.getDomainStatistics(ctx, input.domain);
    }),

  checkStatus: workspaceProcedure
    .input(z.object({ domain: z.string() }))
    .query(async ({ ctx, input }) => {
      const domain = input.domain;
      log.debug({ domain }, "checking domain status on Cloudflare");

      const cfDomain = await getCustomHostnameFromCloudflare(domain);

      if (!cfDomain) {
        log.warn({ domain }, "Custom hostname not found in Cloudflare");
        return { status: "invalid", verificationChallenges: [] };
      }

      const isVerified = cfDomain.status === "active" && cfDomain.ssl.status === "active";
      let status: "pending" | "active" | "invalid" = isVerified ? "active" : "pending";
      
      const challenges = [];
      
      // If not fully active, provide verification details
      if (!isVerified) {
        if (cfDomain.ownership_verification) {
          challenges.push({
            type: "TXT",
            domain: cfDomain.ownership_verification.name,
            value: cfDomain.ownership_verification.value,
          });
        }
        
        if (cfDomain.ssl?.validation_records) {
          for (const record of cfDomain.ssl.validation_records) {
            const exists = challenges.find(
              (v) => v.type === "TXT" && v.domain === record.txt_name && v.value === record.txt_value
            );
            if (!exists) {
              challenges.push({
                type: "TXT",
                domain: record.txt_name,
                value: record.txt_value,
              });
            }
          }
        }
        
        challenges.push({
          type: "CNAME",
          domain: domain,
          value: "clickpath.analytai.in",
        });
      }

      log.debug(
        { domain, status, challengeCount: challenges.length },
        "domain status resolved",
      );

      await ctx.prisma.customDomain.updateMany({
        where: {
          domain,
          ...(ctx.workspace.type === "team"
            ? { teamId: ctx.workspace.teamId }
            : { userId: ctx.workspace.userId, teamId: null }),
        },
        data: {
          status,
          verificationDetails: challenges,
        },
      });

      return {
        status,
        verificationChallenges: challenges,
      };
    }),
});
