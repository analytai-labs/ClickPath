import { notFound } from "next/navigation";

import { TemplatePublicView } from "@/components/templates/public-views";
import { isTemplatePathPrefix } from "@/lib/templates/page-url";
import { resolveShareMetadata } from "@/lib/templates/share-metadata";
import { api } from "@/trpc/server";

import type { Metadata } from "next";

// Reached only via the middleware rewrite for a customer domain
// (brand.com/<prefix>/<slug> -> /p-host/brand.com/<prefix>/<slug>, for a prefix
// in TEMPLATE_PATH_PREFIXES). Host-specific, and the resolver refuses to serve a
// page to a host that isn't verified for its workspace — so a stranger cannot
// point a domain here and mirror someone else — or at a prefix other than the
// page's own, so each page has exactly one URL per domain.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ host: string; prefix: string; slug: string }> };

// decodeURIComponent throws a synchronous URIError on malformed percent-encoding.
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function resolve({ params }: Props) {
  const { host, prefix, slug } = await params;
  const domain = safeDecode(host);
  const pageSlug = safeDecode(slug);
  if (!domain || !pageSlug || !isTemplatePathPrefix(prefix)) return null;
  return api.templatePage.getBySlugForHost.query({ slug: pageSlug, host: domain, prefix });
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const page = await resolve(props).catch(() => null);
  if (!page) return {};

  const domain = safeDecode((await props.params).host);
  const { title, description } = resolveShareMetadata(page);

  return {
    title: { absolute: title },
    description: description ?? undefined,
    alternates: { canonical: `https://${domain}/${page.pathPrefix}/${page.slug}` },
    openGraph: { title, description: description ?? undefined, type: "profile" },
    twitter: { card: "summary_large_image", title, description: description ?? undefined },
  };
}

export default async function CustomDomainTemplatePageBySlug(props: Props) {
  const page = await resolve(props);
  if (!page) notFound();

  return <TemplatePublicView page={page} />;
}
