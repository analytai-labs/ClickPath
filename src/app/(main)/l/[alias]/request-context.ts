import { DEFAULT_PLATFORM_DOMAIN } from "@/lib/constants/domains";
import { normalizeDomain } from "@/lib/core/cache";

import type { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";

/**
 * Visitor details a short link needs, read straight from the request headers.
 *
 * The redirect used to run in the proxy, where `@vercel/functions` supplied geo
 * and IP. A page only has headers, so we read them directly — and since this
 * deployment sits behind Cloudflare, `cf-*` headers are the most reliable
 * source, with the Vercel equivalents kept as a fallback.
 */
export type RequestContext = {
  /**
   * Host the visitor asked for, normalized the same way link lookups are, so it
   * matches the `domain` stored on a link. Callers must not re-derive this:
   * `retrieveOriginalUrl` compares the domain exactly and would miss otherwise.
   */
  domain: string;
  origin: string;
  country: string;
  city: string;
  ip: string;
  userAgent: string | null;
};

export function readRequestContext(headersList: ReadonlyHeaders): RequestContext {
  const forwardedHost = headersList.get("x-forwarded-host") ?? headersList.get("host");
  const rawHost =
    (forwardedHost ?? DEFAULT_PLATFORM_DOMAIN).split(":")[0] ?? DEFAULT_PLATFORM_DOMAIN;
  const domain = normalizeDomain(rawHost);
  const proto = headersList.get("x-forwarded-proto") ?? "https";

  const isLocal = rawHost.includes("localhost") || rawHost.includes("127.0.0.1");

  const country =
    headersList.get("cf-ipcountry") ??
    headersList.get("x-vercel-ip-country") ??
    (isLocal ? "US" : null);

  const city =
    headersList.get("x-vercel-ip-city") ??
    headersList.get("cf-ipcity") ??
    (isLocal ? "San Francisco" : null);

  const ip =
    headersList.get("cf-connecting-ip") ??
    headersList.get("x-real-ip") ??
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "";

  return {
    domain,
    origin: `${proto}://${forwardedHost ?? domain}`,
    country: country ?? "Unknown",
    city: city ?? "Unknown",
    ip,
    userAgent: headersList.get("user-agent"),
  };
}
