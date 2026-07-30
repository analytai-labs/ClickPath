import { runBackgroundTask } from "@/lib/utils/background";
import { sendAbuseReportNotification } from "@/server/lib/notifications/discord";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "../../trpc";
import { ABUSE_CATEGORY_LABELS, reportAbuseSchema } from "./abuse.input";
import { shortLinkDisplay } from "@/lib/links/short-link";

/**
 * Parse a user-submitted short link into a domain + alias pair.
 * Accepts forms like `https://clickpath.analytai.in/abc`, `clk.path/abc`,
 * `www.clickpath.analytai.in/abc!`, with optional query/fragment.
 */
function parseShortUrl(raw: string): { domain: string; alias: string } | null {
  let s = raw.trim().replace(/^(https?:\/\/)?(www\.)?/i, "");
  s = s.split(/[?#]/)[0] ?? "";

  const slashIndex = s.indexOf("/");
  if (slashIndex === -1) return null;

  const domain = s.slice(0, slashIndex).toLowerCase();
  let alias = s.slice(slashIndex + 1).split("/")[0] ?? "";
  if (alias.endsWith("!")) alias = alias.slice(0, -1);

  if (!domain || !alias) return null;
  return { domain, alias: alias.toLowerCase() };
}

export const abuseRouter = createTRPCRouter({
  report: publicProcedure.input(reportAbuseSchema).mutation(async ({ ctx, input }) => {
    const parsed = parseShortUrl(input.shortUrl);
    if (!parsed) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "That doesn't look like a valid short link. Use a format like clk.path/abc.",
      });
    }

    const reportedLink = await ctx.prisma.link.findFirst({
      where: {
        alias: { equals: parsed.alias, mode: "insensitive" },
        domain: parsed.domain,
      },
      select: { id: true, url: true, domain: true, alias: true },
    });

    if (!reportedLink) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "We couldn't find that short link. Double-check the address and try again.",
      });
    }

    const reporterEmail = input.reporterEmail?.trim() || null;
    const details = input.details?.trim() || null;
    const categoryLabel = ABUSE_CATEGORY_LABELS[input.category];

    await ctx.prisma.flaggedLink.create({
      data: {
        linkId: reportedLink.id,
        reason: categoryLabel,
        reporterEmail,
        details,
        status: "pending",
      },
    });

    void runBackgroundTask(
      sendAbuseReportNotification({
        shortUrl: shortLinkDisplay(reportedLink.domain, reportedLink.alias ?? ""),
        destinationUrl: reportedLink.url,
        category: categoryLabel,
        reporterEmail,
        details,
      }),
    );

    return { success: true };
  }),
});
