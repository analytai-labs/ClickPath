/**
 * Where short links live.
 *
 * Every short link is served under a fixed prefix rather than at the domain
 * root. Two reasons:
 *
 * 1. An alias can never collide with an application route. A bare alias meant
 *    the router had to guess, guarded by a hand-maintained list of reserved
 *    paths — so an alias like "pricing" would silently never resolve.
 * 2. The prefix is a stable, single-segment marker, which keeps the redirect
 *    path cheap to recognise before any database work happens.
 *
 * This module is the only place the prefix is written down. Import from here
 * instead of interpolating `domain/alias` by hand, so changing the prefix stays
 * a one-line edit.
 */

/** The path segment every short link sits under. No slashes. */
export const SHORT_LINK_PREFIX = "l";

/** Root-relative path for an alias: `/l/my-alias`. */
export function shortLinkPath(alias: string): string {
  return `/${SHORT_LINK_PREFIX}/${alias}`;
}

/** Absolute short-link URL: `https://example.com/l/my-alias`. */
export function shortLinkUrl(domain: string, alias: string): string {
  return `https://${domain}${shortLinkPath(alias)}`;
}

/** Short-link URL without the scheme, for display: `example.com/l/my-alias`. */
export function shortLinkDisplay(domain: string, alias: string): string {
  return `${domain}${shortLinkPath(alias)}`;
}

/**
 * Everything before the alias: `example.com/l/`.
 *
 * For UI that dims the fixed part of a short link and emphasises the alias, so
 * those views don't have to interpolate the prefix themselves.
 */
export function shortLinkHostPrefix(domain: string): string {
  return `${domain}/${SHORT_LINK_PREFIX}/`;
}

/**
 * The alias in a short-link pathname, or null when the path isn't one.
 *
 * Only matches exactly one segment after the prefix, so `/l/a/b` is not a short
 * link and falls through to normal routing.
 */
export function shortLinkAliasFromPath(pathname: string): string | null {
  const prefix = `/${SHORT_LINK_PREFIX}/`;
  if (!pathname.startsWith(prefix)) return null;

  const alias = pathname.slice(prefix.length);
  if (!alias || alias.includes("/")) return null;

  return alias;
}
