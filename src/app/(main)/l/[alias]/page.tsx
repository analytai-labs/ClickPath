import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { socialMediaAgents } from "@/lib/constants/app";
import { isBot } from "@/lib/utils/is-bot";
import { resolveShortLink } from "@/middlewares/resolve-link";
import { api } from "@/trpc/server";

import CloakedPage from "../../cloaked/[url]/page";
import VerifiedRedirectPage from "../../verified-redirect/[alias]/page";
import LinkPreview from "./link-preview";
import { readRequestContext } from "./request-context";

import type { Metadata } from "next";

/**
 * Short links are served here rather than from the proxy.
 *
 * The proxy runs in the Edge runtime, where neither Prisma nor ioredis can be
 * loaded — the redirect pipeline needs both, so resolving there crashed the
 * module on evaluation and every short link returned a 500. A page runs on Node,
 * so the existing `resolveShortLink` pipeline is reused unchanged: geo rules,
 * UTM stamping, expiry, click limits, passwords, click recording and verified
 * clicks all keep working exactly as before.
 */

// Never cached: every hit must resolve fresh and be counted.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type ShortLinkPageProps = {
  params: Promise<{ alias: string }>;
};

export type LinkMetadata = {
  title: string;
  description: string;
  image: string;
};

/** A trailing "!" asks for the preview page instead of a redirect. */
const cleanAlias = (incomingAlias: string): string =>
  (incomingAlias.endsWith("!") ? incomingAlias.slice(0, -1) : incomingAlias).toLowerCase();

/**
 * Crawlers get the page, not a redirect, so link previews render.
 *
 * `isBot` is the broad check the proxy used; `socialMediaAgents` is a narrow,
 * case-sensitive list that misses common agents like `facebookexternalhit`, so
 * it is kept only as a supplement.
 */
const isCrawler = (userAgent: string | null): boolean =>
  !!userAgent && (isBot(userAgent) || socialMediaAgents.some((agent) => userAgent.includes(agent)));

export async function generateMetadata(props: ShortLinkPageProps): Promise<Metadata> {
  const params = await props.params;
  const { domain } = readRequestContext(await headers());

  if (params.alias.toLowerCase().endsWith(".png")) {
    return {};
  }

  const link = await api.link.retrieveOriginalUrl.query({
    alias: cleanAlias(params.alias),
    domain,
    from: "metadata",
  });

  const linkMetadata = link?.metadata as LinkMetadata;

  return {
    title: { absolute: linkMetadata?.title ?? "" },
    description: linkMetadata?.description ?? "",
    openGraph: { images: [linkMetadata?.image ?? ""] },
    twitter: {
      card: "summary_large_image",
      site: linkMetadata?.title ?? "",
      title: linkMetadata?.title ?? "",
      description: linkMetadata?.description ?? "",
      images: [linkMetadata?.image ?? ""],
    },
  };
}

const ShortLinkPage = async (props: ShortLinkPageProps) => {
  const params = await props.params;
  const headersList = await headers();
  const ctx = readRequestContext(headersList);

  if (params.alias.toLowerCase().endsWith(".png")) {
    return notFound();
  }

  const alias = cleanAlias(params.alias);
  const wantsPreview = params.alias.endsWith("!");

  // Social crawlers and the explicit preview need to see the page and its OG
  // tags, not a redirect — and neither should be counted as a visit.
  if (wantsPreview || isCrawler(ctx.userAgent)) {
    const link = await api.link.retrieveOriginalUrl.query({
      alias,
      domain: ctx.domain,
      from: "metadata",
    });
    if (!link) return notFound();
    return wantsPreview ? <LinkPreview link={link} /> : <div>Redirecting...</div>;
  }

  const resolution = await resolveShortLink({
    domain: ctx.domain,
    alias,
    country: ctx.country,
    city: ctx.city,
    ip: ctx.ip,
    headers: new Headers(headersList),
    baseUrl: ctx.origin,
  });

  if (!resolution?.url) return notFound();

  // Cloaked links and the verified-click interstitial must keep the short URL in
  // the address bar, so their pages are rendered here instead of redirected to.
  if (resolution.cloaking) {
    return (
      <CloakedPage
        params={Promise.resolve({ url: encodeURIComponent(resolution.url) })}
        searchParams={Promise.resolve(
          resolution.verificationToken ? { t: resolution.verificationToken } : {},
        )}
      />
    );
  }

  if (resolution.verificationToken) {
    return (
      <VerifiedRedirectPage
        params={Promise.resolve({ alias })}
        searchParams={Promise.resolve({ to: resolution.url, t: resolution.verificationToken })}
      />
    );
  }

  redirect(resolution.url);
};

export default ShortLinkPage;
