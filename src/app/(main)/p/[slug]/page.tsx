import { notFound } from "next/navigation";

import { PharmaProductPublicView } from "@/components/templates/pharma-product/pharma-product-public-view";
import { PublicBioView } from "@/components/bio/public-bio-view";
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

  const title = page.seoTitle || page.title || `@${page.slug}`;
  const description = page.seoDescription || page.description || undefined;

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: page.customDomain ? `https://${page.customDomain}` : `/p/${slug}`,
    },
    openGraph: { title, description, type: "profile" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicTemplatePageRoute({ params }: Props) {
  const { slug } = await params;
  const page = await api.templatePage.getBySlug.query({ slug });
  if (!page) notFound();

  if (page.templateType === "pharma_product") {
    return <PharmaProductPublicView page={page} />;
  }
  return <PublicBioView page={page} />;
}
