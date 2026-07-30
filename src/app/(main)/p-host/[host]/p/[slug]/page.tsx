import { notFound } from "next/navigation";

import { TemplatePublicView } from "@/components/templates/public-views";
import { api } from "@/trpc/server";

import type { Metadata } from "next";

// Reached only via the middleware rewrite for a customer domain
// (brand.com/p/<slug> -> /p-host/brand.com/p/<slug>). Host-specific, and the
// resolver refuses to serve a page to a host that isn't verified for its
// workspace, so a stranger cannot point a domain here and mirror someone else.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ host: string; slug: string }> };

// decodeURIComponent throws a synchronous URIError on malformed percent-encoding.
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function resolve({ params }: Props) {
  const { host, slug } = await params;
  const domain = safeDecode(host);
  const pageSlug = safeDecode(slug);
  if (!domain || !pageSlug) return null;
  return api.templatePage.getBySlugForHost.query({ slug: pageSlug, host: domain });
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const page = await resolve(props).catch(() => null);
  if (!page) return {};

  const { host, slug } = await props.params;
  const domain = safeDecode(host);
  const title = page.seoTitle || page.displayTitle || page.slug;
  const description = page.seoDescription || page.description || undefined;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `https://${domain}/p/${slug}` },
    openGraph: { title, description, type: "profile" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CustomDomainTemplatePageBySlug(props: Props) {
  const page = await resolve(props);
  if (!page) notFound();

  return <TemplatePublicView page={page} />;
}
