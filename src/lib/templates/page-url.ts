import { getAppBaseDomain, isPlatformDomain } from "@/lib/constants/domains";

/**
 * Where a template page lives publicly.
 *
 * A page is reachable from three kinds of host, and this module is the single
 * place that decides which one is *canonical* — the URL shown in the dashboard,
 * copied by the user, and encoded into the page's QR code:
 *
 * 1. `https://<platform>/p/<slug>`     — always works.
 * 2. `https://<shareDomain>/p/<slug>`  — the customer's own verified domain.
 *    Any verified workspace domain serves any of that workspace's pages, so the
 *    pages (and printed QR codes) keep working if the platform domain changes.
 * 3. `https://<customDomain>/`         — optional root binding, one page per domain.
 *
 * Preferring the customer's domain in the canonical URL is the whole point: a QR
 * code printed on packaging outlives whatever happens to the platform domain.
 */
export type TemplatePageAddress = {
  slug: string;
  shareDomain?: string | null;
  customDomain?: string | null;
};

/** The host the canonical URL is built from. */
export function templatePageHost(page: TemplatePageAddress): string {
  return page.customDomain || page.shareDomain || getAppBaseDomain();
}

/** True when the page is served from the root of a domain rather than /p/<slug>. */
export function isServedAtDomainRoot(page: TemplatePageAddress): boolean {
  return Boolean(page.customDomain);
}

/** Canonical absolute URL. This is what the QR code encodes. */
export function templatePageUrl(page: TemplatePageAddress): string {
  if (page.customDomain) return `https://${page.customDomain}`;
  const host = page.shareDomain || getAppBaseDomain();
  return `https://${host}/p/${page.slug}`;
}

/** Canonical URL without the scheme — for compact display in lists and headers. */
export function templatePageDisplayUrl(page: TemplatePageAddress): string {
  return templatePageUrl(page).replace(/^https:\/\//, "");
}

/**
 * Same-origin path for links inside the dashboard ("View live"). Always the
 * platform path so it works in local dev and on preview deployments, where the
 * customer's domain does not point at this instance.
 */
export function templatePagePreviewPath(page: TemplatePageAddress): string {
  return `/p/${page.slug}`;
}

/** A share domain must be a real customer domain, never the platform's own. */
export function isUsableShareDomain(domain: string | null | undefined): domain is string {
  return Boolean(domain) && !isPlatformDomain(domain);
}
