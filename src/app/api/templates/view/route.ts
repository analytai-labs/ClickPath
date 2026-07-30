import { geolocation, ipAddress } from "@vercel/functions";
import type { NextRequest } from "next/server";

import { redis } from "@/lib/core/cache";
import { runBackgroundTask } from "@/lib/utils/background";
import { hashIp } from "@/lib/utils/ip-hash";
import { recordTemplatePageView } from "@/middlewares/record-template-page-view";
import { prisma } from "@/server/db";

const isLocalhost = process.env.NODE_ENV === "development";

export async function POST(request: NextRequest) {
  let templatePageId: unknown;
  try {
    const body = (await request.json()) as { templatePageId?: unknown };
    templatePageId = body?.templatePageId;
  } catch {
    return new Response(null, { status: 400 });
  }

  if (typeof templatePageId !== "number" || !Number.isFinite(templatePageId)) {
    return new Response(null, { status: 400 });
  }

  // Only record for a page that actually exists and is published.
  const page = await prisma.templatePage.findFirst({
    where: { id: templatePageId, isPublished: true },
    select: { id: true, userId: true },
  });
  if (!page) return new Response(null, { status: 204 });

  const ip = ipAddress(request);

  // Rate-limit: record at most one view per IP per page per minute, so this
  // unauthenticated endpoint can't be spammed to inflate views or drain the
  // page owner's monthly event quota.
  if (ip) {
    const fresh = await redis.set(`tplbeacon:${page.id}:${hashIp(ip)}`, "1", "EX", 60, "NX");
    if (fresh !== "OK") return new Response(null, { status: 204 });
  }

  const geo = geolocation(request);

  void runBackgroundTask(
    recordTemplatePageView({
      headers: request.headers,
      templatePageId: page.id,
      ownerId: page.userId,
      ip: ip ?? "",
      country: geo.country ?? (isLocalhost ? "US" : ""),
      city: geo.city ?? (isLocalhost ? "San Francisco" : ""),
    }),
  );

  return new Response(null, { status: 204 });
}
