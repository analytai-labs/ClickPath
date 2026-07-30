import { notFound } from "next/navigation";

import { TemplatePublicView } from "@/components/templates/public-views";
import { templatePageUrl } from "@/lib/templates/page-url";
import { resolveShareMetadata } from "@/lib/templates/share-metadata";
import { api } from "@/trpc/server";

import type { Metadata } from "next";

// ISR: public pages are statically served and refreshed periodically. Edits and
// publish toggles also trigger on-demand revalidation from the template-page service.
export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await api.templatePage.getBySlug.query({ slug }).catch(() => null);
  if (!page) return { title: "Page not found" };

  const { title, description } = resolveShareMetadata(page);

  return {
    title: { absolute: title },
    description: description ?? undefined,
    // Point search engines at the page's own domain when it has one, so the
    // customer's URL is the indexed one.
    alternates: { canonical: templatePageUrl(page) },
    openGraph: { title, description: description ?? undefined, type: "profile" },
    twitter: { card: "summary_large_image", title, description: description ?? undefined },
  };
}

export default async function PublicTemplatePageRoute({ params }: Props) {
  const { slug } = await params;
  const page = await api.templatePage.getBySlug.query({ slug });
  if (!page) notFound();

  return <TemplatePublicView page={page} />;
}
