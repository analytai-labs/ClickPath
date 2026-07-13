import { BIO_OG_SIZE, bioOgImageResponse } from "@/components/bio/og-image";
import { prisma } from "@/server/db";
import { type BioPageTheme } from "@/server/db/types";

export const runtime = "nodejs";
export const alt = "Bio page preview";
export const size = BIO_OG_SIZE;
export const contentType = "image/png";

type Props = { params: Promise<{ host: string }> };

export default async function Image({ params }: Props) {
  const { host } = await params;
  const domain = decodeURIComponent(host).toLowerCase().replace(/^www\./, "");
  const page = await prisma.bioPage
    .findFirst({
      where: { customDomain: domain, isPublished: true },
      select: {
        title: true,
        slug: true,
        description: true,
        avatarUrl: true,
        theme: true,
        socialImageUrl: true,
      },
    })
    .catch(() => null);

  return bioOgImageResponse(page ? { ...page, theme: page.theme as BioPageTheme } : null, page?.slug ?? "");
}
