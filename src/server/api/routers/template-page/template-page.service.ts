import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { env } from "@/env.mjs";
import { normalizeSocialUrl } from "@/components/bio/social-links";
import {
  canRemoveBioBranding,
  canScheduleBioBlocks,
  canUseBioCustomDomain,
  canUseBioCustomThemes,
  getPlanCaps,
} from "@/lib/billing/plans";
import { isPlatformDomain } from "@/lib/constants/domains";
import { deleteImage, uploadImage } from "@/server/lib/storage";
import {
  deleteHiddenTrackingLink,
  insertHiddenTrackingLink,
  prepareHiddenTrackingLink,
  purgeTrackingLinkCache,
  updateHiddenTrackingLink,
} from "@/server/lib/tracking-link";
import { requirePermission, workspaceOwnership } from "@/server/lib/workspace";

import { assertDomainAllowed } from "../link/utils";
import {
  assertSlugAllowed,
  checkTemplatePageLimit,
  pageBelongsToWorkspace,
  rethrowBioDuplicate,
} from "./utils";

import type { ImageType } from "@/server/lib/storage/types";
import type { BioBlock, TemplatePage } from "@prisma/client";
import type { PublicTRPCContext, WorkspaceTRPCContext } from "../../trpc";
import type {
  AddBioBlockInput,
  BioThemeInput,
  CreateTemplatePageInput,
  ReorderBlocksInput,
  UpdateBioBlockInput,
  UpdatePharmaProductInput,
  UpdateTemplatePageInput,
} from "./template-page.input";

export type BioPageTheme = BioThemeInput;
export type BioSocialLink = { platform: string; url: string };

const getWorkspaceWhere = (workspace: any) =>
  workspace.type === "team"
    ? { teamId: workspace.teamId }
    : { userId: workspace.userId, teamId: null };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function forbidden(message: string): TRPCError {
  return new TRPCError({ code: "FORBIDDEN", message });
}

function revalidateTemplatePath(slug: string): void {
  try {
    revalidatePath(`/p/${slug}`);
  } catch {
    // not in a revalidatable context
  }
}

function parseSocials(content: string | null): BioSocialLink[] {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as BioSocialLink[]) : [];
  } catch {
    return [];
  }
}

function normalizeSocials(socials: BioSocialLink[]): BioSocialLink[] {
  return socials.map((s) => {
    const url = normalizeSocialUrl(s.platform, s.url);
    if (!url) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          s.platform === "email"
            ? "Enter a valid email address for the Email link."
            : `Enter a valid handle or URL for the ${s.platform} link.`,
      });
    }
    return { platform: s.platform, url };
  });
}

function themeHasCustomization(theme: BioPageTheme): boolean {
  return Boolean(theme.accentColor || theme.background || theme.font || theme.buttonStyle);
}

function assertSchedulingAllowed(
  ctx: WorkspaceTRPCContext,
  scheduledAt?: Date | null,
  scheduledUntil?: Date | null,
): void {
  if ((scheduledAt || scheduledUntil) && !canScheduleBioBlocks(ctx.workspace.plan)) {
    throw forbidden("Scheduled blocks are available on the Ultra plan.");
  }
}

async function resolveImageUpdate(
  ctx: WorkspaceTRPCContext,
  resourceId: number,
  imageType: ImageType,
  next: string | null | undefined,
  previous: string | null,
): Promise<{ value: string | null; previousToDelete: string | null }> {
  const value = next
    ? ((await uploadImage(ctx, { image: next, resourceId, imageType })) ?? next)
    : null;
  return { value, previousToDelete: previous && previous !== value ? previous : null };
}

async function fetchTemplatePageForWorkspace(ctx: WorkspaceTRPCContext, id: number) {
  const page = await ctx.prisma.templatePage.findFirst({
    where: {
      id,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });
  if (!page) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Page not found." });
  }
  return page;
}

async function fetchBlockForWorkspace(ctx: WorkspaceTRPCContext, blockId: number) {
  const block = await ctx.prisma.bioBlock.findFirst({
    where: { id: blockId },
    include: { templatePage: true },
  });
  if (!block || !block.templatePage || !pageBelongsToWorkspace(ctx, block.templatePage)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Block not found." });
  }
  return block;
}

// ---------------------------------------------------------------------------
// Page CRUD
// ---------------------------------------------------------------------------

export async function listTemplatePages(ctx: WorkspaceTRPCContext) {
  const pages = await ctx.prisma.templatePage.findMany({
    where: getWorkspaceWhere(ctx.workspace),
    orderBy: { createdAt: "desc" },
  });

  const ids = pages.map((p) => p.id);
  const counts = ids.length
    ? await ctx.prisma.bioBlock.groupBy({
        by: ["templatePageId"],
        where: { templatePageId: { in: ids } },
        _count: { templatePageId: true },
      })
    : [];
  const countMap = new Map(counts.map((c) => [c.templatePageId, Number(c._count.templatePageId)]));

  return pages.map((p) => ({ ...p, blockCount: countMap.get(p.id) ?? 0 }));
}

// Backward-compat alias
export const listBioPages = listTemplatePages;

function toEditorBlock(
  b: BioBlock,
  linkMap: Map<number, { domain: string; alias: string | null; blocked: boolean | null }>,
) {
  const base = {
    id: b.id,
    type: b.type,
    title: b.title,
    content: b.content,
    url: b.url,
    isVisible: b.isVisible,
    position: b.position,
    scheduledAt: b.scheduledAt,
    scheduledUntil: b.scheduledUntil,
    socials: b.type === "social" ? parseSocials(b.content) : undefined,
    shortUrl: null as string | null,
    blocked: false,
  };
  if (b.type === "link" && b.linkId) {
    const l = linkMap.get(b.linkId);
    base.shortUrl = l?.alias ? `https://${l.domain}/${l.alias}` : null;
    base.blocked = l?.blocked ?? false;
  }
  return base;
}

export async function getTemplatePage(ctx: WorkspaceTRPCContext, id: number) {
  const page = await fetchTemplatePageForWorkspace(ctx, id);
  const blocks = await ctx.prisma.bioBlock.findMany({
    where: { templatePageId: id },
    orderBy: { position: "asc" },
  });

  const linkIds = blocks.map((b) => b.linkId).filter((x): x is number => !!x);
  const links = linkIds.length
    ? await ctx.prisma.link.findMany({ where: { id: { in: linkIds } } })
    : [];
  const linkMap = new Map(
    links.map((l) => [l.id, { domain: l.domain, alias: l.alias, blocked: l.blocked }]),
  );

  return { ...page, blocks: blocks.map((b) => toEditorBlock(b, linkMap)) };
}

export const getBioPage = getTemplatePage;

export async function createTemplatePage(
  ctx: WorkspaceTRPCContext,
  input: CreateTemplatePageInput,
) {
  requirePermission(ctx.workspace, "bio.create", "create template pages");
  assertSlugAllowed(input.slug);
  await checkTemplatePageLimit(ctx);

  const ownership = workspaceOwnership(ctx.workspace);
  try {
    const res = await ctx.prisma.templatePage.create({
      data: {
        slug: input.slug,
        title: input.title ?? null,
        description: input.description ?? null,
        userId: ownership.userId,
        teamId: ownership.teamId,
        createdByUserId: ctx.auth.userId,
        templateType: input.templateType ?? "bio",
      },
    });
    return { id: res.id, slug: input.slug };
  } catch (error) {
    rethrowBioDuplicate(error);
  }
}

export const createBioPage = createTemplatePage;

export async function updateTemplatePage(
  ctx: WorkspaceTRPCContext,
  input: UpdateTemplatePageInput,
) {
  const page = await fetchTemplatePageForWorkspace(ctx, input.id);
  requirePermission(ctx.workspace, "bio.edit", "edit template pages");
  const plan = ctx.workspace.plan;
  const updates: any = {};

  if (input.slug !== undefined) {
    assertSlugAllowed(input.slug);
    updates.slug = input.slug;
  }
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.seoTitle !== undefined) updates.seoTitle = input.seoTitle;
  if (input.seoDescription !== undefined) updates.seoDescription = input.seoDescription;

  if (input.removeBranding !== undefined) {
    if (input.removeBranding && !canRemoveBioBranding(plan)) {
      throw forbidden("Removing ClickPath branding is available on Pro and Ultra plans.");
    }
    updates.removeBranding = input.removeBranding;
  }

  if (input.theme !== undefined) {
    if (input.theme && themeHasCustomization(input.theme) && !canUseBioCustomThemes(plan)) {
      throw forbidden("Theme customization is available on Pro and Ultra plans.");
    }
    updates.theme = input.theme ?? null;
  }

  if (input.customDomain !== undefined) {
    if (input.customDomain) {
      if (!canUseBioCustomDomain(plan)) {
        throw forbidden("Custom domains are available on Pro and Ultra plans.");
      }
      const normalized = input.customDomain
        .trim()
        .toLowerCase()
        .replace(/^www\./, "");
      if (isPlatformDomain(normalized)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Use a custom domain you own, not the platform domain.",
        });
      }
      await assertDomainAllowed(ctx, normalized);
      updates.customDomain = normalized;
    } else {
      updates.customDomain = null;
    }
  }

  const imagesToDelete: string[] = [];
  if (input.avatarUrl !== undefined) {
    const { value, previousToDelete } = await resolveImageUpdate(
      ctx,
      page.id,
      "bio-avatar",
      input.avatarUrl,
      page.avatarUrl,
    );
    updates.avatarUrl = value;
    if (previousToDelete) imagesToDelete.push(previousToDelete);
  }
  if (input.socialImageUrl !== undefined) {
    const { value, previousToDelete } = await resolveImageUpdate(
      ctx,
      page.id,
      "bio-og",
      input.socialImageUrl,
      page.socialImageUrl,
    );
    updates.socialImageUrl = value;
    if (previousToDelete) imagesToDelete.push(previousToDelete);
  }

  if (Object.keys(updates).length > 0) {
    try {
      await ctx.prisma.templatePage.update({
        where: { id: page.id },
        data: updates,
      });
    } catch (error) {
      rethrowBioDuplicate(error);
    }
  }

  for (const url of imagesToDelete) await deleteImage(url).catch(() => {});
  revalidateTemplatePath(page.slug);
  if (updates.slug && updates.slug !== page.slug) revalidateTemplatePath(updates.slug);
  return { success: true };
}

export const updateBioPage = updateTemplatePage;

export async function updatePharmaProduct(
  ctx: WorkspaceTRPCContext,
  input: UpdatePharmaProductInput,
) {
  const page = await fetchTemplatePageForWorkspace(ctx, input.id);
  requirePermission(ctx.workspace, "bio.edit", "edit template pages");
  const plan = ctx.workspace.plan;

  // ─── 1. Resolve product images — upload base64 → R2, keep existing URLs ──────
  const prevData = page.templateData as {
    productImages?: string[];
    documents?: { imageUrl: string; name: string }[];
  } | null;

  const prevProductImages: string[] = prevData?.productImages ?? [];
  const prevDocImages: string[] = (prevData?.documents ?? []).map((d) => d.imageUrl);

  // Upload any item that is a base64 data URL; pass through R2 URLs untouched.
  const resolvedProductImages: string[] = await Promise.all(
    input.data.productImages.map(async (img, idx) => {
      if (!img) return "";
      if (img.startsWith(env.R2_PUBLIC_URL ?? "https://")) return img; // already an R2 URL
      const uploaded = await uploadImage(ctx, {
        image: img,
        resourceId: Date.now() + idx, // globally unique
        imageType: "pharma-product-image",
      });
      return uploaded ?? img;
    }),
  );
  // Remove empty slots
  const productImages = resolvedProductImages.filter(Boolean);

  const resolvedDocuments = await Promise.all(
    input.data.documents.map(async (doc, idx) => {
      if (!doc.imageUrl) return { ...doc, imageUrl: "" };
      if (doc.imageUrl.startsWith(env.R2_PUBLIC_URL ?? "https://")) return doc; // existing R2 URL
      const uploaded = await uploadImage(ctx, {
        image: doc.imageUrl,
        resourceId: Date.now() + 1000 + idx, // globally unique
        imageType: "pharma-document-image",
      });
      return { ...doc, imageUrl: uploaded ?? doc.imageUrl };
    }),
  );

  const resolvedData = { ...input.data, productImages, documents: resolvedDocuments };

  // ─── 2. Delete stale R2 files that were removed ────────────────────────────
  // Combine all current URLs into a single set to prevent cross-array deletion bugs
  const allCurrentUrls = new Set([
    ...productImages,
    ...resolvedDocuments.map((d) => d.imageUrl)
  ]);

  const staleUrls = [
    ...prevProductImages.filter((u) => u.startsWith(env.R2_PUBLIC_URL ?? "https://") && !allCurrentUrls.has(u)),
    ...prevDocImages.filter((u) => u.startsWith(env.R2_PUBLIC_URL ?? "https://") && !allCurrentUrls.has(u)),
  ];
  await Promise.all(staleUrls.map((url) => deleteImage(url).catch(() => {})));

  // ─── 3. Handle optional settings fields ────────────────────────────────────
  const updates: Record<string, unknown> = { templateData: resolvedData };

  if (input.theme !== undefined) {
    if (input.theme && themeHasCustomization(input.theme) && !canUseBioCustomThemes(plan)) {
      throw forbidden("Theme customization is available on Pro and Ultra plans.");
    }
    updates.theme = input.theme ?? null;
  }
  if (input.seoTitle !== undefined) updates.seoTitle = input.seoTitle;
  if (input.seoDescription !== undefined) updates.seoDescription = input.seoDescription;
  if (input.removeBranding !== undefined) {
    if (input.removeBranding && !canRemoveBioBranding(plan)) {
      throw forbidden("Removing ClickPath branding is available on Pro and Ultra plans.");
    }
    updates.removeBranding = input.removeBranding;
  }
  if (input.customDomain !== undefined) {
    if (input.customDomain) {
      if (!canUseBioCustomDomain(plan)) {
        throw forbidden("Custom domains are available on Pro and Ultra plans.");
      }
      const normalized = input.customDomain.trim().toLowerCase().replace(/^www\./, "");
      if (isPlatformDomain(normalized)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Use a custom domain you own." });
      }
      await assertDomainAllowed(ctx, normalized);
      updates.customDomain = normalized;
    } else {
      updates.customDomain = null;
    }
  }
  if (input.socialImageUrl !== undefined) {
    const { value, previousToDelete } = await resolveImageUpdate(
      ctx,
      page.id,
      "bio-og",
      input.socialImageUrl,
      page.socialImageUrl,
    );
    updates.socialImageUrl = value;
    if (previousToDelete) await deleteImage(previousToDelete).catch(() => {});
  }

  await ctx.prisma.templatePage.update({
    where: { id: page.id },
    data: updates,
  });
  revalidateTemplatePath(page.slug);
  return { success: true };
}


export async function togglePublished(
  ctx: WorkspaceTRPCContext,
  input: { id: number; isPublished: boolean },
) {
  const page = await fetchTemplatePageForWorkspace(ctx, input.id);
  requirePermission(ctx.workspace, "bio.edit", "edit template pages");
  await ctx.prisma.templatePage.update({
    where: { id: page.id },
    data: { isPublished: input.isPublished },
  });
  revalidateTemplatePath(page.slug);
  return { success: true, isPublished: input.isPublished };
}

export async function deleteTemplatePage(ctx: WorkspaceTRPCContext, id: number) {
  const page = await fetchTemplatePageForWorkspace(ctx, id);
  requirePermission(ctx.workspace, "bio.delete", "delete template pages");

  const blocks = await ctx.prisma.bioBlock.findMany({ where: { templatePageId: page.id } });
  const linkIds = blocks.map((b) => b.linkId).filter((x): x is number => !!x);
  const backingLinks = linkIds.length
    ? await ctx.prisma.link.findMany({ where: { id: { in: linkIds } } })
    : [];

  await ctx.prisma.$transaction(async (tx) => {
    for (const linkId of linkIds) {
      await deleteHiddenTrackingLink(tx, linkId);
    }
    await tx.bioBlock.deleteMany({ where: { templatePageId: page.id } });
    await tx.templatePageView.deleteMany({ where: { templatePageId: page.id } });
    await tx.uniqueTemplatePageView.deleteMany({ where: { templatePageId: page.id } });
    await tx.templatePageViewDailySummary.deleteMany({ where: { templatePageId: page.id } });
    await tx.templatePage.delete({ where: { id: page.id } });
  });

  for (const l of backingLinks) {
    if (l.alias) purgeTrackingLinkCache(l.domain, l.alias);
  }

  await Promise.all(
    [page.avatarUrl, page.socialImageUrl]
      .filter((url): url is string => !!url)
      .map((url) => deleteImage(url).catch(() => {})),
  );

  revalidateTemplatePath(page.slug);
  return { success: true };
}

export const deleteBioPage = deleteTemplatePage;

// ---------------------------------------------------------------------------
// Block CRUD
// ---------------------------------------------------------------------------

export async function addBlock(ctx: WorkspaceTRPCContext, input: AddBioBlockInput) {
  const page = await fetchTemplatePageForWorkspace(ctx, input.bioPageId);
  requirePermission(ctx.workspace, "bio.edit", "edit template pages");
  assertSchedulingAllowed(ctx, input.scheduledAt, input.scheduledUntil);

  const maxPosRow = await ctx.prisma.bioBlock.aggregate({
    where: { templatePageId: page.id },
    _max: { position: true },
  });
  const position = (maxPosRow._max.position ?? -1) + 1;

  const content =
    input.type === "social"
      ? JSON.stringify(normalizeSocials(input.socials ?? []))
      : (input.content ?? null);

  if (input.type === "link") {
    const destination = input.url?.trim();
    if (!destination) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A link block needs a destination URL.",
      });
    }
    const prepared = await prepareHiddenTrackingLink(ctx, {
      url: destination,
      name: input.title || page.title || "Bio link",
      kind: "bio",
    });
    const id = await ctx.prisma.$transaction(async (tx) => {
      const linkId = await insertHiddenTrackingLink(tx, ctx, prepared);
      const res = await tx.bioBlock.create({
        data: {
          templatePageId: page.id,
          type: "link",
          title: input.title ?? null,
          url: destination,
          linkId,
          position,
          scheduledAt: input.scheduledAt ?? null,
          scheduledUntil: input.scheduledUntil ?? null,
        },
      });
      return res.id;
    });
    revalidateTemplatePath(page.slug);
    return { id };
  }

  const res = await ctx.prisma.bioBlock.create({
    data: {
      templatePageId: page.id,
      type: input.type,
      title: input.title ?? null,
      content,
      url: input.url ?? null,
      position,
      scheduledAt: input.scheduledAt ?? null,
      scheduledUntil: input.scheduledUntil ?? null,
    },
  });
  revalidateTemplatePath(page.slug);
  return { id: res.id };
}

export async function updateBlock(ctx: WorkspaceTRPCContext, input: UpdateBioBlockInput) {
  const block = await fetchBlockForWorkspace(ctx, input.id);
  requirePermission(ctx.workspace, "bio.edit", "edit template pages");
  assertSchedulingAllowed(ctx, input.scheduledAt, input.scheduledUntil);

  const updates: any = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.isVisible !== undefined) updates.isVisible = input.isVisible;
  if (input.scheduledAt !== undefined) updates.scheduledAt = input.scheduledAt;
  if (input.scheduledUntil !== undefined) updates.scheduledUntil = input.scheduledUntil;

  if (block.type === "social") {
    if (input.socials !== undefined)
      updates.content = JSON.stringify(normalizeSocials(input.socials));
  } else if (input.content !== undefined) {
    updates.content = input.content;
  }

  if (input.url !== undefined) {
    updates.url = input.url;
    if (block.type === "link" && block.linkId && input.url) {
      await updateHiddenTrackingLink(ctx, block.linkId, {
        url: input.url,
        name: input.title ?? block.title ?? undefined,
      });
    }
  }

  if (Object.keys(updates).length > 0) {
    await ctx.prisma.bioBlock.update({
      where: { id: block.id },
      data: updates,
    });
  }
  revalidateTemplatePath(block.templatePage.slug);
  return { success: true };
}

export async function deleteBlock(ctx: WorkspaceTRPCContext, id: number) {
  const block = await fetchBlockForWorkspace(ctx, id);
  requirePermission(ctx.workspace, "bio.edit", "edit template pages");

  if (block.type === "link" && block.linkId) {
    const linkId = block.linkId;
    const backing = await ctx.prisma.link.findFirst({ where: { id: linkId } });
    await ctx.prisma.$transaction(async (tx) => {
      await deleteHiddenTrackingLink(tx, linkId);
      await tx.bioBlock.delete({ where: { id } });
    });
    if (backing?.alias) purgeTrackingLinkCache(backing.domain, backing.alias);
  } else {
    await ctx.prisma.bioBlock.delete({ where: { id } });
  }
  revalidateTemplatePath(block.templatePage.slug);
  return { success: true };
}

export async function reorderBlocks(ctx: WorkspaceTRPCContext, input: ReorderBlocksInput) {
  const page = await fetchTemplatePageForWorkspace(ctx, input.bioPageId);
  requirePermission(ctx.workspace, "bio.edit", "edit template pages");
  const blocks = await ctx.prisma.bioBlock.findMany({
    where: { templatePageId: page.id },
    select: { id: true },
  });
  const validIds = new Set(blocks.map((b) => b.id));
  const seen = new Set<number>();
  const ordered = input.blockIds.filter(
    (id) => validIds.has(id) && !seen.has(id) && (seen.add(id), true),
  );
  if (ordered.length !== validIds.size) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Reorder must include every block exactly once.",
    });
  }

  await ctx.prisma.$transaction(async (tx) => {
    for (let i = 0; i < ordered.length; i++) {
      await tx.bioBlock.update({
        where: { id: ordered[i]! },
        data: { position: i },
      });
    }
  });
  revalidateTemplatePath(page.slug);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Public rendering
// ---------------------------------------------------------------------------

export type PublicBioBlock =
  | { id: number; type: "link"; title: string | null; href: string }
  | { id: number; type: "email"; title: string | null; href: string | null }
  | { id: number; type: "social"; socials: BioSocialLink[] }
  | {
      id: number;
      type: "heading" | "text" | "divider";
      title: string | null;
      content: string | null;
    };

export type PublicBioPage = {
  id: number;
  slug: string;
  title: string | null;
  description: string | null;
  avatarUrl: string | null;
  theme: BioPageTheme | null;
  removeBranding: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  socialImageUrl: string | null;
  customDomain: string | null;
  ownerId: string;
  templateType: string;
  templateData: unknown | null;
  blocks: PublicBioBlock[];
};

function isBlockLive(block: BioBlock, now: number): boolean {
  if (!block.isVisible) return false;
  if (block.scheduledAt && block.scheduledAt.getTime() > now) return false;
  if (block.scheduledUntil && block.scheduledUntil.getTime() <= now) return false;
  return true;
}

async function assemblePublicTemplatePage(
  prisma: PublicTRPCContext["prisma"],
  page: TemplatePage,
): Promise<PublicBioPage> {
  const blocks = await prisma.bioBlock.findMany({
    where: { templatePageId: page.id },
    orderBy: { position: "asc" },
  });

  const now = Date.now();
  const live = blocks.filter((b) => isBlockLive(b, now));

  const linkIds = live.map((b) => b.linkId).filter((x): x is number => !!x);
  const links = linkIds.length
    ? await prisma.link.findMany({ where: { id: { in: linkIds } } })
    : [];
  const linkMap = new Map(links.map((l) => [l.id, l]));

  const publicBlocks: PublicBioBlock[] = live
    .map((b): PublicBioBlock | null => {
      if (b.type === "link") {
        const l = b.linkId ? linkMap.get(b.linkId) : undefined;
        if (!l || l.blocked || l.disabled || !l.alias) return null;
        return { id: b.id, type: "link", title: b.title, href: `https://${l.domain}/${l.alias}` };
      }
      if (b.type === "social") {
        return { id: b.id, type: "social", socials: parseSocials(b.content) };
      }
      if (b.type === "email") {
        return { id: b.id, type: "email", title: b.title, href: b.url ? `mailto:${b.url}` : null };
      }
      return { id: b.id, type: b.type as any, title: b.title, content: b.content };
    })
    .filter((b): b is PublicBioBlock => b !== null);

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    description: page.description,
    avatarUrl: page.avatarUrl,
    theme: page.theme as any,
    removeBranding: page.removeBranding ?? false,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    socialImageUrl: page.socialImageUrl,
    customDomain: page.customDomain,
    ownerId: page.userId,
    templateType: page.templateType,
    templateData: page.templateData,
    blocks: publicBlocks,
  };
}

export async function getPublicBioPageBySlug(
  ctx: PublicTRPCContext,
  slug: string,
): Promise<PublicBioPage | null> {
  const page = await ctx.prisma.templatePage.findFirst({
    where: { slug, isPublished: true },
  });
  if (!page) return null;
  return assemblePublicTemplatePage(ctx.prisma, page);
}

export async function getPublicBioPageByDomain(
  ctx: PublicTRPCContext,
  domain: string,
): Promise<PublicBioPage | null> {
  const normalized = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  const page = await ctx.prisma.templatePage.findFirst({
    where: { customDomain: normalized, isPublished: true },
  });
  if (!page) return null;
  return assemblePublicTemplatePage(ctx.prisma, page);
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

const RANGE_DAYS: Record<"7d" | "30d" | "90d" | "all", number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: 3650,
};

function resolveRangeDays(range: keyof typeof RANGE_DAYS, capDays?: number): number {
  const base = RANGE_DAYS[range];
  return capDays !== undefined ? Math.min(base, capDays) : base;
}

export async function getBioPageAnalytics(
  ctx: WorkspaceTRPCContext,
  input: { id: number; range: "7d" | "30d" | "90d" | "all" },
) {
  const page = await fetchTemplatePageForWorkspace(ctx, input.id);
  const caps = getPlanCaps(ctx.workspace.plan);
  const rangeDays = resolveRangeDays(input.range, caps.analyticsRangeLimitDays);
  const start = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

  const viewsAgg = await ctx.prisma.templatePageView.count({
    where: { templatePageId: page.id, createdAt: { gte: start } },
  });
  const uniqueAgg = await ctx.prisma.uniqueTemplatePageView.count({
    where: { templatePageId: page.id, createdAt: { gte: start } },
  });

  // Raw query uses the actual DB table name (BioPageView) and column (bioPageId) via @@map/@map
  const viewsByDayRaw = await ctx.prisma.$queryRaw<{ date: string; count: bigint }[]>`
    SELECT DATE("createdAt") as date, COUNT(*) as count 
    FROM "BioPageView" 
    WHERE "bioPageId" = ${page.id} AND "createdAt" >= ${start}
    GROUP BY DATE("createdAt")
  `;

  const blocks = await ctx.prisma.bioBlock.findMany({
    where: { templatePageId: page.id },
    orderBy: { position: "asc" },
  });
  const linkBlocks = blocks.filter((b) => b.type === "link" && b.linkId);
  const linkIds = linkBlocks.map((b) => b.linkId!);

  const clickRows = linkIds.length
    ? await ctx.prisma.linkVisit.groupBy({
        by: ["linkId"],
        where: {
          linkId: { in: linkIds },
          createdAt: { gte: start },
        },
        _count: { linkId: true },
      })
    : [];
  const clickMap = new Map(clickRows.map((r) => [r.linkId, Number(r._count.linkId)]));

  const perBlock = linkBlocks
    .map((b) => ({
      blockId: b.id,
      title: b.title || b.url || "Link",
      clicks: clickMap.get(b.linkId!) ?? 0,
    }))
    .sort((a, b) => b.clicks - a.clicks);

  const totalClicks = perBlock.reduce((sum, b) => sum + b.clicks, 0);
  const views = Number(viewsAgg ?? 0);
  const uniqueViews = Number(uniqueAgg ?? 0);

  const viewsPerDay: Record<string, number> = {};
  for (const row of viewsByDayRaw) {
    viewsPerDay[String(row.date)] = Number(row.count);
  }

  return {
    views,
    uniqueViews,
    totalClicks,
    ctr: views > 0 ? totalClicks / views : 0,
    perBlock,
    viewsPerDay,
    rangeDays,
    isProPlan: ctx.workspace.plan !== "free",
  };
}
