import { TEMPLATE_OG_SIZE, templateOgImageResponse } from "@/components/templates/og-image";
import { prisma } from "@/server/db";

export const runtime = "nodejs";
export const alt = "Page preview";
export const size = TEMPLATE_OG_SIZE;
export const contentType = "image/png";

const OG_SELECT = {
  title: true,
  slug: true,
  description: true,
  avatarUrl: true,
  theme: true,
  socialImageUrl: true,
  templateType: true,
  templateData: true,
} as const;

type Props = { params: Promise<{ host: string }> };

export default async function Image({ params }: Props) {
  const { host } = await params;
  const domain = decodeURIComponent(host)
    .toLowerCase()
    .replace(/^www\./, "");
  const page = await prisma.templatePage
    .findFirst({ where: { customDomain: domain, isPublished: true }, select: OG_SELECT })
    .catch(() => null);

  return templateOgImageResponse(page, page?.slug ?? "");
}
