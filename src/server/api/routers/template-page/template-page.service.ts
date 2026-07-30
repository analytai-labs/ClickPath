import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { normalizeSocialUrl } from "@/components/bio/social-links";
import {
  canRemoveBioBranding,
  canScheduleBioBlocks,
  canUseBioCustomDomain,
  canUseBioCustomThemes,
} from "@/lib/billing/plans";
import { isPlatformDomain } from "@/lib/constants/domains";
import { aggregateVisits } from "@/lib/core/analytics";
import { type AnalyticsRange, resolveAnalyticsRange } from "@/lib/core/analytics/range";
import { logger } from "@/lib/logger";
import { getTemplateDefinition, resolveVariantId } from "@/lib/templates/registry";
import { releaseImages } from "@/server/lib/assets";
import { uploadImage } from "@/server/lib/storage";
import {
  deleteHiddenTrackingLink,
  insertHiddenTrackingLink,
  prepareHiddenTrackingLink,
  purgeTrackingLinkCache,
  updateHiddenTrackingLink,
} from "@/server/lib/tracking-link";
import { requirePermission, workspaceOwnership } from "@/server/lib/workspace";

import { isUsableShareDomain } from "@/lib/templates/page-url";

import { assertDomainAllowed, resolveDefaultDomain } from "../link/utils";
import { collectManagedImageUrls, materializeDataImages } from "./template-data-images";
import {
  assertSlugAllowed,
  checkTemplatePageLimit,
  pageBelongsToWorkspace,
  rethrowTemplateDuplicate,
} from "./utils";

import { shortLinkUrl } from "@/lib/links/short-link";
import type { AnyTemplateDefinition, TemplateTypeId } from "@/lib/templates/registry";
import type { ImageType } from "@/server/lib/storage/types";
import type { BioBlock, TemplatePage } from "@prisma/client";
import type { PublicTRPCContext, WorkspaceTRPCContext } from "../../trpc";
import type {
  AddBioBlockInput,
  CreateTemplatePageInput,
  ReorderBlocksInput,
  TemplateThemeInput,
  UpdateBioBlockInput,
  UpdateQrDesignInput,
  UpdateTemplateDataInput,
  UpdateTemplatePageInput,
} from "./template-page.input";

const log = logger.child({ component: "template-page" });

export type TemplatePageTheme = TemplateThemeInput;
export type BioSocialLink = { platform: string; url: string };

const getWorkspaceWhere = (workspace: WorkspaceTRPCContext["workspace"]) =>
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

function hasRichThemeCustomization(theme: TemplatePageTheme): boolean {
  return Boolean(theme.accentColor || theme.background || theme.font || theme.buttonStyle);
}

/**
 * Normalize an incoming theme for the page's own template: the variant id is
 * validated against the definition, and the richer bio-only fields are dropped
 * for templates that don't support them. Always returns an object so a nullable
 * Json column never has to be written with an ambiguous SQL/JSON null.
 */
function normalizeTheme(
  ctx: WorkspaceTRPCContext,
  definition: AnyTemplateDefinition,
  theme: TemplatePageTheme | null | undefined,
): TemplatePageTheme {
  const preset = resolveVariantId(definition, theme?.preset);
  if (!theme || !definition.supportsRichTheme) return { preset };

  const { accentColor, buttonStyle, background, font } = theme;
  const rich = { accentColor, buttonStyle, background, font };
  if (hasRichThemeCustomization(rich) && !canUseBioCustomThemes(ctx.workspace.plan)) {
    throw forbidden("Theme customization is available on Pro and Ultra plans.");
  }
  // Drop unset keys — Prisma writes this straight into a Json column.
  return Object.fromEntries(
    Object.entries({ preset, ...rich }).filter(([, v]) => v !== undefined),
  ) as TemplatePageTheme;
}

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .split(":")[0]!;
}

function assertContentModel(definition: AnyTemplateDefinition, model: "blocks" | "data"): void {
  if (definition.contentModel !== model) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        model === "blocks"
          ? `${definition.label} pages don't use content blocks.`
          : `${definition.label} pages don't store template data.`,
    });
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

/** Resolve a custom domain input to the value to persist (null clears it). */
async function resolveCustomerDomain(
  ctx: WorkspaceTRPCContext,
  domain: string | null,
): Promise<string | null> {
  if (!domain) return null;
  if (!canUseBioCustomDomain(ctx.workspace.plan)) {
    throw forbidden("Custom domains are available on Pro and Ultra plans.");
  }
  const normalized = normalizeHost(domain);
  if (isPlatformDomain(normalized)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Use a custom domain you own, not the platform domain.",
    });
  }
  await assertDomainAllowed(ctx, normalized);
  return normalized;
}

async function fetchTemplatePageForWorkspace(ctx: WorkspaceTRPCContext, id: number) {
  const page = await ctx.prisma.templatePage.findFirst({
    where: {
      id,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });
  if (!page) {
    throw await describeMissingPage(ctx, id);
  }
  return page;
}

/**
 * Explain a page miss instead of guessing.
 *
 * "Page not found" has two very different causes: the page is genuinely gone,
 * or it exists in another workspace — which happens whenever the workspace
 * switcher moved after a tab was opened, since the editor renders from
 * server-fetched data and only discovers the mismatch when you hit Save. The
 * second case is recoverable and the user needs to be told how, so this looks
 * the row up once (only on the failure path) and says which it is.
 */
async function describeMissingPage(ctx: WorkspaceTRPCContext, id: number): Promise<TRPCError> {
  const owner = await ctx.prisma.templatePage.findUnique({
    where: { id },
    select: { userId: true, teamId: true, team: { select: { name: true } } },
  });

  if (!owner) {
    return new TRPCError({ code: "NOT_FOUND", message: "Page not found." });
  }

  log.warn(
    {
      pageId: id,
      requestWorkspace: {
        type: ctx.workspace.type,
        userId: ctx.workspace.userId,
        teamId: ctx.workspace.type === "team" ? ctx.workspace.teamId : null,
      },
      pageOwner: { userId: owner.userId, teamId: owner.teamId },
    },
    "template page exists but belongs to a different workspace",
  );

  const where = owner.teamId
    ? `the ${owner.team?.name ?? "team"} workspace`
    : "a personal workspace";

  return new TRPCError({
    code: "FORBIDDEN",
    message: `This page belongs to ${where}. Switch workspace to edit it.`,
  });
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

/** Title to show in lists and metadata: the user's own, else one derived from content. */
function displayTitleFor(page: Pick<TemplatePage, "title" | "templateType" | "templateData">) {
  if (page.title?.trim()) return page.title;
  const definition = getTemplateDefinition(page.templateType);
  return definition.deriveTitle(page.templateData ?? definition.defaultData) ?? null;
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

// ---------------------------------------------------------------------------
// Page CRUD
// ---------------------------------------------------------------------------

export async function listTemplatePages(ctx: WorkspaceTRPCContext) {
  const pages = await ctx.prisma.templatePage.findMany({
    where: getWorkspaceWhere(ctx.workspace),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      isPublished: true,
      templateType: true,
      templateData: true,
      shareDomain: true,
      customDomain: true,
      createdAt: true,
      updatedAt: true,
    },
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

  // templateData is only read to derive a title; it never leaves the server.
  return pages.map(({ templateData, ...p }) => ({
    ...p,
    displayTitle: displayTitleFor({ ...p, templateData }),
    blockCount: countMap.get(p.id) ?? 0,
  }));
}

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
    base.shortUrl = l?.alias ? shortLinkUrl(l.domain, l.alias) : null;
    base.blocked = l?.blocked ?? false;
  }
  return base;
}

export async function getTemplatePage(ctx: WorkspaceTRPCContext, id: number) {
  const page = await fetchTemplatePageForWorkspace(ctx, id);
  const definition = getTemplateDefinition(page.templateType);

  const blocks =
    definition.contentModel === "blocks"
      ? await ctx.prisma.bioBlock.findMany({
          where: { templatePageId: id },
          orderBy: { position: "asc" },
        })
      : [];

  const linkIds = blocks.map((b) => b.linkId).filter((x): x is number => !!x);
  const links = linkIds.length
    ? await ctx.prisma.link.findMany({ where: { id: { in: linkIds } } })
    : [];
  const linkMap = new Map(
    links.map((l) => [l.id, { domain: l.domain, alias: l.alias, blocked: l.blocked }]),
  );

  return {
    ...page,
    templateType: page.templateType as TemplateTypeId,
    displayTitle: displayTitleFor(page),
    blocks: blocks.map((b) => toEditorBlock(b, linkMap)),
  };
}

export async function createTemplatePage(
  ctx: WorkspaceTRPCContext,
  input: CreateTemplatePageInput,
) {
  requirePermission(ctx.workspace, "bio.create", "create template pages");
  assertSlugAllowed(input.slug);
  await checkTemplatePageLimit(ctx);

  const definition = getTemplateDefinition(input.templateType);
  const ownership = workspaceOwnership(ctx.workspace);

  // A new page is served from the workspace's default domain, so the QR code the
  // user prints straight after creating it already points at their own domain.
  // `shareDomain` only ever holds a customer domain — null means "platform".
  const defaultDomain = await resolveDefaultDomain(ctx);
  const shareDomain = isUsableShareDomain(defaultDomain) ? defaultDomain : null;

  try {
    const res = await ctx.prisma.templatePage.create({
      data: {
        slug: input.slug,
        title: input.title ?? null,
        description: input.description ?? null,
        userId: ownership.userId,
        teamId: ownership.teamId,
        createdByUserId: ctx.auth.userId,
        templateType: definition.id,
        templateData: definition.defaultData as object,
        theme: { preset: definition.defaultVariantId },
        shareDomain,
      },
    });
    return { id: res.id, slug: input.slug, templateType: definition.id };
  } catch (error) {
    rethrowTemplateDuplicate(error);
  }
}

export async function updateTemplatePage(
  ctx: WorkspaceTRPCContext,
  input: UpdateTemplatePageInput,
) {
  const page = await fetchTemplatePageForWorkspace(ctx, input.id);
  requirePermission(ctx.workspace, "bio.edit", "edit template pages");
  const definition = getTemplateDefinition(page.templateType);
  const updates: Record<string, unknown> = {};

  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.seoTitle !== undefined) updates.seoTitle = input.seoTitle;
  if (input.seoDescription !== undefined) updates.seoDescription = input.seoDescription;

  if (input.removeBranding !== undefined) {
    if (input.removeBranding && !canRemoveBioBranding(ctx.workspace.plan)) {
      throw forbidden("Removing ClickPath branding is available on Pro and Ultra plans.");
    }
    updates.removeBranding = input.removeBranding;
  }

  if (input.theme !== undefined) {
    updates.theme = normalizeTheme(ctx, definition, input.theme);
  }

  if (input.shareDomain !== undefined) {
    updates.shareDomain = await resolveCustomerDomain(ctx, input.shareDomain ?? null);
  }

  if (input.customDomain !== undefined) {
    const rootDomain = await resolveCustomerDomain(ctx, input.customDomain ?? null);
    // The root binding only makes sense on the domain the page already lives on,
    // otherwise the canonical URL and the root would point at different hosts.
    const shareDomain = (updates.shareDomain ?? page.shareDomain) as string | null;
    if (rootDomain && rootDomain !== shareDomain) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Serving at the domain root requires that domain to be the page's public domain.",
      });
    }
    updates.customDomain = rootDomain;
  } else if (updates.shareDomain !== undefined && page.customDomain) {
    // Share domain changed (or cleared) while a root binding existed — move the
    // binding with it so the two can never drift apart.
    updates.customDomain = updates.shareDomain;
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
      rethrowTemplateDuplicate(error);
    }
  }

  await releaseImages(ctx, imagesToDelete);
  revalidateTemplatePath(page.slug);
  return { success: true };
}

/**
 * Write the content document of a `data`-model template. The payload is parsed
 * with the schema of the page's own template, base64 images anywhere inside it
 * are uploaded to R2, and R2 objects that dropped out of the document are removed.
 */
export async function updateTemplateData(
  ctx: WorkspaceTRPCContext,
  input: UpdateTemplateDataInput,
) {
  const page = await fetchTemplatePageForWorkspace(ctx, input.id);
  requirePermission(ctx.workspace, "bio.edit", "edit template pages");

  const definition = getTemplateDefinition(page.templateType);
  assertContentModel(definition, "data");

  const parsed = definition.dataSchema.safeParse(input.data);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: parsed.error.issues[0]?.message ?? "Invalid template content.",
    });
  }

  const resolved = await materializeDataImages(ctx, page.id, parsed.data);

  const currentUrls = new Set(collectManagedImageUrls(resolved));
  const staleUrls = collectManagedImageUrls(page.templateData).filter(
    (url) => !currentUrls.has(url),
  );

  const updates: Record<string, unknown> = { templateData: resolved as object };
  if (input.theme !== undefined) {
    updates.theme = normalizeTheme(ctx, definition, input.theme);
  }

  await ctx.prisma.templatePage.update({ where: { id: page.id }, data: updates });

  await releaseImages(ctx, staleUrls);
  revalidateTemplatePath(page.slug);
  return { success: true };
}

/**
 * Persist the page's QR design. A base64 logo is uploaded to R2 through the same
 * generic path as template content, and a replaced logo is cleaned up.
 */
export async function updateQrDesign(ctx: WorkspaceTRPCContext, input: UpdateQrDesignInput) {
  const page = await fetchTemplatePageForWorkspace(ctx, input.id);
  requirePermission(ctx.workspace, "bio.edit", "edit template pages");

  const resolved = await materializeDataImages(ctx, page.id, input.qrDesign);

  const currentUrls = new Set(collectManagedImageUrls(resolved));
  const staleUrls = collectManagedImageUrls(page.qrDesign).filter((url) => !currentUrls.has(url));

  await ctx.prisma.templatePage.update({
    where: { id: page.id },
    data: { qrDesign: resolved as object },
  });

  await releaseImages(ctx, staleUrls);
  return { success: true, qrDesign: resolved };
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

  // Page-level images plus every image embedded in the template's content or QR.
  const imageUrls = [
    page.avatarUrl,
    page.socialImageUrl,
    ...collectManagedImageUrls(page.templateData),
    ...collectManagedImageUrls(page.qrDesign),
  ].filter((url): url is string => !!url);
  await releaseImages(ctx, imageUrls);

  revalidateTemplatePath(page.slug);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Block CRUD (templates whose content model is `blocks`)
// ---------------------------------------------------------------------------

async function fetchBlockPage(ctx: WorkspaceTRPCContext, pageId: number) {
  const page = await fetchTemplatePageForWorkspace(ctx, pageId);
  requirePermission(ctx.workspace, "bio.edit", "edit template pages");
  assertContentModel(getTemplateDefinition(page.templateType), "blocks");
  return page;
}

export async function addBlock(ctx: WorkspaceTRPCContext, input: AddBioBlockInput) {
  const page = await fetchBlockPage(ctx, input.templatePageId);
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

  const updates: Record<string, unknown> = {};
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
  const page = await fetchBlockPage(ctx, input.templatePageId);
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

export type PublicTemplatePage = {
  id: number;
  slug: string;
  title: string | null;
  displayTitle: string | null;
  description: string | null;
  avatarUrl: string | null;
  theme: TemplatePageTheme | null;
  removeBranding: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  socialImageUrl: string | null;
  shareDomain: string | null;
  customDomain: string | null;
  ownerId: string;
  templateType: TemplateTypeId;
  templateData: unknown;
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
): Promise<PublicTemplatePage> {
  const definition = getTemplateDefinition(page.templateType);

  const blocks =
    definition.contentModel === "blocks"
      ? await prisma.bioBlock.findMany({
          where: { templatePageId: page.id },
          orderBy: { position: "asc" },
        })
      : [];

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
        return {
          id: b.id,
          type: "link",
          title: b.title,
          href: shortLinkUrl(l.domain, l.alias ?? ""),
        };
      }
      if (b.type === "social") {
        return { id: b.id, type: "social", socials: parseSocials(b.content) };
      }
      if (b.type === "email") {
        return { id: b.id, type: "email", title: b.title, href: b.url ? `mailto:${b.url}` : null };
      }
      return {
        id: b.id,
        type: b.type as "heading" | "text" | "divider",
        title: b.title,
        content: b.content,
      };
    })
    .filter((b): b is PublicBioBlock => b !== null);

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    displayTitle: displayTitleFor(page),
    description: page.description,
    avatarUrl: page.avatarUrl,
    theme: page.theme as TemplatePageTheme | null,
    removeBranding: page.removeBranding ?? false,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    socialImageUrl: page.socialImageUrl,
    shareDomain: page.shareDomain,
    customDomain: page.customDomain,
    ownerId: page.userId,
    templateType: definition.id,
    templateData: page.templateData ?? definition.defaultData,
    blocks: publicBlocks,
  };
}

export async function getPublicTemplatePageBySlug(
  ctx: PublicTRPCContext,
  slug: string,
): Promise<PublicTemplatePage | null> {
  const page = await ctx.prisma.templatePage.findFirst({
    where: { slug, isPublished: true },
  });
  if (!page) return null;
  return assemblePublicTemplatePage(ctx.prisma, page);
}

/**
 * A page requested from a customer domain at /p/<slug>.
 *
 * The host must be a verified domain of the workspace that owns the page — not
 * merely the page's own `shareDomain`. That deliberate looseness is what makes
 * the platform domain disposable: point any verified domain at this app and
 * every page in that workspace keeps resolving, printed QR codes included.
 */
export async function getPublicTemplatePageBySlugForHost(
  ctx: PublicTRPCContext,
  slug: string,
  host: string,
): Promise<PublicTemplatePage | null> {
  const normalized = normalizeHost(host);
  if (!normalized) return null;

  const page = await ctx.prisma.templatePage.findFirst({
    where: { slug, isPublished: true },
  });
  if (!page) return null;

  // The platform's own hosts always serve every page.
  if (!isPlatformDomain(normalized)) {
    const authorized = await ctx.prisma.customDomain.findFirst({
      where: {
        domain: normalized,
        status: "active",
        ...(page.teamId !== null ? { teamId: page.teamId } : { userId: page.userId, teamId: null }),
      },
      select: { id: true },
    });
    if (!authorized) return null;
  }

  return assemblePublicTemplatePage(ctx.prisma, page);
}

export async function getPublicTemplatePageByDomain(
  ctx: PublicTRPCContext,
  domain: string,
): Promise<PublicTemplatePage | null> {
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

/**
 * Everything the analytics tab needs about one page.
 *
 * A template page is a link with a page attached, so this deliberately mirrors
 * `link.linkVisits`: the same range handling, the same period-over-period deltas,
 * and the same per-dimension breakdowns — every dimension below is already
 * recorded on `TemplatePageView` by `recordTemplatePageView`.
 */
export async function getTemplatePageAnalytics(
  ctx: WorkspaceTRPCContext,
  input: { id: number; range: AnalyticsRange },
) {
  const page = await fetchTemplatePageForWorkspace(ctx, input.id);
  const isPaid = ctx.workspace.plan !== "free";
  const { range, start, end, previous } = resolveAnalyticsRange(input.range, { isPaid });

  const window = { gte: start, lte: end };

  const [views, uniqueViews, lifetime, previousCounts, blocks] = await Promise.all([
    ctx.prisma.templatePageView.findMany({
      where: { templatePageId: page.id, createdAt: window },
      select: {
        createdAt: true,
        country: true,
        city: true,
        continent: true,
        device: true,
        os: true,
        browser: true,
        model: true,
        referer: true,
      },
    }),
    ctx.prisma.uniqueTemplatePageView.findMany({
      where: { templatePageId: page.id, createdAt: window },
      select: { createdAt: true },
    }),
    getTemplatePageLifetimeViews(ctx, page.id),
    previous
      ? Promise.all([
          ctx.prisma.templatePageView.count({
            where: {
              templatePageId: page.id,
              createdAt: { gte: previous.start, lt: previous.end },
            },
          }),
          ctx.prisma.uniqueTemplatePageView.count({
            where: {
              templatePageId: page.id,
              createdAt: { gte: previous.start, lt: previous.end },
            },
          }),
        ])
      : Promise.resolve(null),
    ctx.prisma.bioBlock.findMany({
      where: { templatePageId: page.id },
      orderBy: { position: "asc" },
    }),
  ]);

  const aggregated = aggregateVisits(views, uniqueViews);

  // Referrers are counted here rather than in `aggregateVisits` because the link
  // side does the same, and "Direct" needs naming rather than dropping.
  const referers: Record<string, number> = {};
  for (const view of views) {
    const key = view.referer && view.referer !== "null" ? view.referer : "Direct";
    referers[key] = (referers[key] ?? 0) + 1;
  }

  const linkBlocks = blocks.filter((b) => b.type === "link" && b.linkId);
  const linkIds = linkBlocks.map((b) => b.linkId!);
  const clickRows = linkIds.length
    ? await ctx.prisma.linkVisit.groupBy({
        by: ["linkId"],
        where: { linkId: { in: linkIds }, createdAt: window },
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
  const totalViews = views.length;

  const topEntry = (counts: Record<string, number>): string =>
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A";

  return {
    range,
    views: totalViews,
    uniqueViews: uniqueViews.length,
    /** Survives retention pruning — see `getTemplatePageLifetimeViews`. */
    lifetimeViews: lifetime,
    totalClicks,
    ctr: totalViews > 0 ? totalClicks / totalViews : 0,
    perBlock,
    /** Whether per-block clicks mean anything for this template at all. */
    tracksBlockClicks: getTemplateDefinition(page.templateType).contentModel === "blocks",
    referers,
    topReferrer: topEntry(referers),
    topCountry: topEntry(aggregated.clicksPerCountry),
    previous: previousCounts ? { views: previousCounts[0], uniqueViews: previousCounts[1] } : null,
    // `aggregateVisits` names every series "clicks" because it was written for
    // links; for a page those same numbers are views. Mapped explicitly rather
    // than spread so its `totalClicks` can't shadow the block-click total above.
    viewsPerDay: aggregated.clicksPerDate,
    uniqueViewsPerDay: aggregated.uniqueClicksPerDate ?? {},
    viewsPerCountry: aggregated.clicksPerCountry,
    viewsPerCity: aggregated.clicksPerCity,
    viewsPerContinent: aggregated.clicksPerContinent,
    viewsPerDevice: aggregated.clicksPerDevice,
    viewsPerOS: aggregated.clicksPerOS,
    viewsPerBrowser: aggregated.clicksPerBrowser,
    viewsPerModel: aggregated.clicksPerModel,
    isProPlan: isPaid,
  };
}

/**
 * Lifetime view count, including days the cleanup cron has already pruned.
 *
 * The cron rolls raw `TemplatePageView` rows into `TemplatePageViewDailySummary`
 * and then deletes them, so counting only raw rows silently loses history past
 * the retention window. This mirrors `getTotalClicks` on the link side.
 */
async function getTemplatePageLifetimeViews(
  ctx: WorkspaceTRPCContext,
  templatePageId: number,
): Promise<number> {
  const [summarized, live] = await Promise.all([
    ctx.prisma.templatePageViewDailySummary.aggregate({
      where: { templatePageId },
      _sum: { views: true },
    }),
    ctx.prisma.templatePageView.count({ where: { templatePageId } }),
  ]);
  return Number(summarized._sum.views ?? 0) + live;
}
