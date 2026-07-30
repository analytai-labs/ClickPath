import { workspaceFilter } from "@/server/lib/workspace";

import { collectManagedImageUrls } from "./json-images";

import type { WorkspaceTRPCContext } from "@/server/api/trpc";

export type AssetUsageKind = "qr-code" | "qr-preset" | "link" | "template-page";

export type AssetUsageRef = {
  kind: AssetUsageKind;
  id: number;
  label: string;
};

/**
 * Everything in the workspace that currently points at an image URL.
 *
 * Computed by reading the resources themselves rather than kept in a join
 * table: the reference lives inside JSON documents that are rewritten wholesale
 * on every save, so a cached index would drift the first time one of those
 * writes missed an update. These tables are workspace-scoped and small.
 */
export async function findAssetUsage(
  ctx: WorkspaceTRPCContext,
  url: string,
): Promise<AssetUsageRef[]> {
  const scope = workspaceFilter(ctx.workspace);

  const [qrCodes, presets, links, pages] = await Promise.all([
    ctx.prisma.qrCode.findMany({
      where: { ...scope, logoImage: url },
      select: { id: true, title: true, content: true },
    }),
    ctx.prisma.qrPreset.findMany({
      where: { ...scope, logoImage: url },
      select: { id: true, name: true },
    }),
    ctx.prisma.link.findMany({
      where: { ...scope, metadata: { path: ["image"], equals: url } },
      select: { id: true, alias: true },
    }),
    ctx.prisma.templatePage.findMany({
      where: scope,
      select: {
        id: true,
        slug: true,
        title: true,
        avatarUrl: true,
        socialImageUrl: true,
        templateData: true,
        qrDesign: true,
      },
    }),
  ]);

  const refs: AssetUsageRef[] = [
    ...qrCodes.map((qr) => ({
      kind: "qr-code" as const,
      id: qr.id,
      label: qr.title?.trim() || qr.content || `QR code #${qr.id}`,
    })),
    ...presets.map((preset) => ({
      kind: "qr-preset" as const,
      id: preset.id,
      label: preset.name,
    })),
    ...links.map((link) => ({
      kind: "link" as const,
      id: link.id,
      label: `/${link.alias}`,
    })),
  ];

  for (const page of pages) {
    const referenced =
      page.avatarUrl === url ||
      page.socialImageUrl === url ||
      collectManagedImageUrls(page.templateData).includes(url) ||
      collectManagedImageUrls(page.qrDesign).includes(url);

    if (referenced) {
      refs.push({
        kind: "template-page",
        id: page.id,
        label: page.title?.trim() || `/${page.slug}`,
      });
    }
  }

  return refs;
}
