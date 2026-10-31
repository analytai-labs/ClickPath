import { getAppBaseDomain, isPlatformDomain } from "@/lib/constants/domains";

/**
 * Where a template page lives publicly.
 *
 * A page is reachable from three kinds of host, and this module is the single
 * place that decides which one is *canonical* — the URL shown in the dashboard,
 * copied by the user, and encoded into the page's QR code:
 *
 * 1. `https://<platform>/p/<slug>`                — always works, for every page.
 * 2. `https://<shareDomain>/<pathPrefix>/<slug>`  — the customer's own verified
 *    domain. Any verified workspace domain serves any of that workspace's pages
 *    at their own prefix, so the pages (and printed QR codes) keep working if the
 *    platform domain changes.
 * 3. `https://<customDomain>/`                    — optional root binding, one page
 *    per domain.
 *
 * Preferring the customer's domain in the canonical URL is the whole point: a QR
 * code printed on packaging outlives whatever happens to the platform domain.
 *
 * `pathPrefix` is chosen from a fixed list rather than typed freely: the
 * middleware runs on the Edge with no database, so it must know from code which
 * first path segments are page routes, and a free-text prefix could shadow real
 * routes (`/l`, `/dashboard`, `/api`, …) or give one page many URLs. `p` is the
 * default; any other prefix exists to match URLs that were printed before the
 * domain moved to ClickPath (e.g. `/productdetails/<id>`), so it requires a
 * custom share domain — the platform domain only ever serves `/p/<slug>`.
 */
export const TEMPLATE_PATH_PREFIXES = ["p", "productdetails"] as const;

export type TemplatePathPrefix = (typeof TEMPLATE_PATH_PREFIXES)[number];

export const DEFAULT_TEMPLATE_PATH_PREFIX: TemplatePathPrefix = "p";

export function isTemplatePathPrefix(value: unknown): value is TemplatePathPrefix {
  return (TEMPLATE_PATH_PREFIXES as readonly unknown[]).includes(value);
}

/** Whether `prefix` may be used with `shareDomain` (null = platform domain). */
export function isPathPrefixAllowed(
  prefix: string,
  shareDomain: string | null | undefined,
): boolean {
  if (!isTemplatePathPrefix(prefix)) return false;
  return prefix === DEFAULT_TEMPLATE_PATH_PREFIX || isUsableShareDomain(shareDomain);
}

export type TemplatePageAddress = {
  slug: string;
  shareDomain?: string | null;
  customDomain?: string | null;
  pathPrefix?: string | null;
};

/** The prefix the page is actually served at: the platform domain is always `/p`. */
export function templatePagePathPrefix(page: TemplatePageAddress): string {
  if (!isUsableShareDomain(page.shareDomain)) return DEFAULT_TEMPLATE_PATH_PREFIX;
  return page.pathPrefix || DEFAULT_TEMPLATE_PATH_PREFIX;
}

/** The host the canonical URL is built from. */
export function templatePageHost(page: TemplatePageAddress): string {
  return page.customDomain || page.shareDomain || getAppBaseDomain();
}

/** True when the page is served from the root of a domain rather than /<prefix>/<slug>. */
export function isServedAtDomainRoot(page: TemplatePageAddress): boolean {
  return Boolean(page.customDomain);
}

/** Canonical absolute URL. This is what the QR code encodes. */
export function templatePageUrl(page: TemplatePageAddress): string {
  if (page.customDomain) return `https://${page.customDomain}`;
  const host = page.shareDomain || getAppBaseDomain();
  return `https://${host}/${templatePagePathPrefix(page)}/${page.slug}`;
}

/** Canonical URL without the scheme — for compact display in lists and headers. */
export function templatePageDisplayUrl(page: TemplatePageAddress): string {
  return templatePageUrl(page).replace(/^https:\/\//, "");
}

/**
 * Same-origin path for links inside the dashboard ("View live"). Always the
 * platform path — whatever the page's own prefix — so it works in local dev and
 * on preview deployments, where the customer's domain does not point at this
 * instance.
 */
export function templatePagePreviewPath(page: TemplatePageAddress): string {
  return `/p/${page.slug}`;
}

/** A share domain must be a real customer domain, never the platform's own. */
export function isUsableShareDomain(domain: string | null | undefined): domain is string {
  return Boolean(domain) && !isPlatformDomain(domain);
}
