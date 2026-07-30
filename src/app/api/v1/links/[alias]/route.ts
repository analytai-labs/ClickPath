import { logger } from "@/lib/logger";
import { prisma } from "@/server/db";

import {
  getApiDomainParamsFromSearchParams,
  resolveApiDomainForUser,
  validateAndGetToken,
} from "../../utils";

import type { NextRequest } from "next/server";
import { shortLinkUrl } from "@/lib/links/short-link";

const log = logger.child({ component: "api.v1.links" });

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

  const retrievedLink = await getLinkByAlias(alias, domain);
  if (!retrievedLink) {
    return new Response("Link not found", { status: 404 });
  }

  return Response.json(retrievedLink);
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ alias: string }> }) {
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

  let updateData: {
    url?: string;
    alias?: string;
    disableLinkAfterDate?: Date | null;
    disableLinkAfterClicks?: number | null;
  };
  try {
    updateData = await request.json();
  } catch (error) {
    return new Response("Invalid request body", { status: 400 });
  }

  const existingLink = await getLinkByAlias(alias, domain);
  if (!existingLink) {
    return new Response("Link not found", { status: 404 });
  }

  // Filter out undefined values from updateData
  const filteredUpdateData = Object.entries(updateData).reduce(
    (acc, [key, value]) => {
      if (value !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        (acc as any)[key] = value;
      }
      return acc;
    },
    {} as typeof updateData,
  );

  if (Object.keys(filteredUpdateData).length === 0) {
    return new Response("No update fields provided", { status: 400 });
  }

  try {
    await prisma.link.updateMany({
      where: { alias, domain },
      data: filteredUpdateData,
    });

    // Fetch the updated link data to return
    const updatedAlias = filteredUpdateData.alias ?? alias; // Use new alias if provided
    const updatedLink = await getLinkByAlias(updatedAlias, domain);

    if (!updatedLink) {
      // This case should ideally not happen if the update was successful and alias wasn't changed
      // Or if it was changed, the fetch used the new alias
      return new Response("Failed to retrieve updated link", { status: 500 });
    }

    return Response.json(updatedLink);
  } catch (error) {
    log.error({ err: error, alias, domain }, "failed to update link");

    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    const isDuplicateKey = (candidate: unknown) =>
      candidate !== null && typeof candidate === "object" && (candidate as any).code === "P2002";

    if ((isDuplicateKey(error) || isDuplicateKey(cause)) && filteredUpdateData.alias) {
      return new Response("Alias already exists for this domain", {
        status: 409,
      }); // 409 Conflict
    }

    // Generic error for other database issues or unexpected errors
    return new Response("Failed to update link due to a server error", {
      status: 500,
    });
  }
}

async function getLinkByAlias(alias: string, domain: string) {
  const retrievedLink = await prisma.link.findFirst({
    where: { alias, domain },
  });
  if (!retrievedLink) return null;

  return {
    shortLink: shortLinkUrl(retrievedLink.domain, retrievedLink.alias ?? ""),
    url: retrievedLink.url,
    alias: retrievedLink.alias,
    expiresAt: retrievedLink.disableLinkAfterDate,
    expiresAfter: retrievedLink.disableLinkAfterClicks,
  };
}
