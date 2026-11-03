import { type NextRequest, NextResponse } from "next/server";

import { extractPlatformSubdomain, isPlatformDomain } from "@/lib/constants/domains";

import { isTemplatePathPrefix } from "./page-url";

/**
 * True for a host that isn't ours: a customer's own verified domain (or an
 * impostor — the routes it is rewritten to verify ownership before serving).
 */
export function isCustomerHost(bareHost: string): boolean {
  return (
    !!bareHost &&
    !bareHost.includes("localhost") &&
    !bareHost.endsWith(".vercel.app") && // preview/deploy URLs keep the marketing root
    !isPlatformDomain(bareHost) &&
    extractPlatformSubdomain(bareHost) === null
  );
}

/**
 * The internal route a customer-host path is served from, or null to leave the
 * request alone. Edge-safe: no database, the page prefixes come from code.
 *
 * - `/`                      -> the page bound to the domain root
 * - `/<prefix>/<slug>[/]`    -> that workspace's page, for any prefix in
 *                               TEMPLATE_PATH_PREFIXES. The slug is lower-cased
 *                               (slugs are stored lower-case; scanners and
 *                               people do not always keep case); the resolver
 *                               checks the prefix matches the page's own.
 *
 * Short links live at /l/<alias>, which is a real route and needs no rewrite.
 */
export function customerHostRewritePath(bareHost: string, pathname: string): string | null {
  const host = encodeURIComponent(bareHost);
  if (pathname === "/") return `/p-host/${host}`;

  const segments = pathname.replace(/\/$/, "").split("/").slice(1);
  if (segments.length !== 2) return null;
  const [prefix, slug] = segments as [string, string];
  if (!isTemplatePathPrefix(prefix) || !slug) return null;

  return `/p-host/${host}/${prefix}/${encodeURIComponent(slug.toLowerCase())}`;
}

/** Routes a customer's own domain to the pages it is allowed to serve. */
export function routeCustomerHost(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/dashboard")) {
    return;
  }

  const { pathname, host } = new URL(request.url);

  // Take the host from the request headers, not from `request.url` — behind a
  // proxy (and for `next start`) the URL carries the listening address, which
  // would silently disable all customer-domain routing.
  const requestHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? host;
  const bareHost = (requestHost.split(":")[0] ?? requestHost).toLowerCase();

  if (isCustomerHost(bareHost)) {
    const rewrite = customerHostRewritePath(bareHost, pathname);
    // The query string (e.g. `?shem=…` appended by scanning apps) is not part
    // of the match and is dropped from the internal URL.
    if (rewrite) return NextResponse.rewrite(new URL(rewrite, request.url));
  }

  return NextResponse.next();
}
