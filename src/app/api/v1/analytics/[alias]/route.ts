import { aggregateVisits } from "@/lib/core/analytics";
import { prisma } from "@/server/db";

import {
  getApiDomainParamsFromSearchParams,
  resolveApiDomainForUser,
  validateAndGetToken,
} from "../../utils";

import type { NextRequest } from "next/server";
export async function GET(request: NextRequest, props: { params: Promise<{ alias: string }> }) {
  const params = await props.params;
  const alias = params.alias;
  const apiKey = request.headers.get("x-api-key");

  const token = await validateAndGetToken(apiKey);
  if (!token) {
    return new Response("Invalid or missing API key", { status: 401 });
  }

  const domain = await resolveApiDomainForUser(
    token.userId,
    getApiDomainParamsFromSearchParams(request.nextUrl.searchParams),
  );

  const link = await prisma.link.findFirst({
    where: { alias, domain },
    include: {
      linkVisits: true,
      uniqueLinkVisits: true,
    },
  });

  if (!link) {
    return new Response("Link not found", { status: 404 });
  }

  if (link.userId !== token.userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const aggregatedVisits = aggregateVisits(link.linkVisits, link.uniqueLinkVisits);

  return Response.json(aggregatedVisits);
}
