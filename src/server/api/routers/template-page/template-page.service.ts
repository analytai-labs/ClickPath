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

import {
  DEFAULT_TEMPLATE_PATH_PREFIX,
  isPathPrefixAllowed,
  isUsableShareDomain,
  templatePagePathPrefix,
} from "@/lib/templates/page-url";

import { assertDomainAllowed, checkWorkspaceLinkLimit, resolveDefaultDomain } from "../link/utils";
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
  DuplicateTemplatePageInput,
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

/**
 * Revalidate the platform route, which serves every page at /p/<slug> whatever
 * its own prefix. The custom-domain routes (/p-host/<host>/<prefix>/<slug>) are
 * force-dynamic, so there is nothing cached there to revalidate.
 */
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

/**
 * A path prefix other than the default needs a custom share domain: the
 * platform domain only ever serves /p/<slug>.
 */
function assertPathPrefixAllowed(prefix: string, shareDomain: string | null): void {
  if (!isPathPrefixAllowed(prefix, shareDomain)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `The /${prefix} path is only available on a custom domain. Choose a custom domain first.`,
    });
  }
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
  // A fresh key per upload, not one per page: a duplicated page shares its
  // source's image URLs, so overwriting `<page>.png` in place would silently
  // change the copy too. The old object is released (and kept while anything
  // still uses it) by the caller.
  const uploadId = `${resourceId}-${Date.now().toString(36)}`;
  const value = next
    ? ((await uploadImage(ctx, { image: next, resourceId: uploadId, imageType })) ?? next)
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
      pathPrefix: true,
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

/**
 * Copy a page into the same workspace under a new slug.
 *
 * Copies content, theme, SEO, branding and QR design, and every block in order.
 * Link blocks get their own hidden tracking link — sharing the source's would
 * merge the two pages' click counts, and deleting either page deletes its
 * blocks' links. Not copied: the root-domain binding (`customDomain` is unique)
 * and analytics. The copy starts unpublished. Images are shared by URL; the
 * asset registry keeps an image while any page still references it.
 */
export async function duplicateTemplatePage(
  ctx: WorkspaceTRPCContext,
  input: DuplicateTemplatePageInput,
) {
  const source = await fetchTemplatePageForWorkspace(ctx, input.id);
  requirePermission(ctx.workspace, "bio.create", "create template pages");
  assertSlugAllowed(input.slug);
  await checkTemplatePageLimit(ctx);

  const shareDomain = await resolveCustomerDomain(ctx, input.shareDomain ?? null);
  const pathPrefix = input.pathPrefix ?? DEFAULT_TEMPLATE_PATH_PREFIX;
  assertPathPrefixAllowed(pathPrefix, shareDomain);

  const definition = getTemplateDefinition(source.templateType);
  const blocks =
    definition.contentModel === "blocks"
      ? await ctx.prisma.bioBlock.findMany({
          where: { templatePageId: source.id },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        })
      : [];

  // The copy is held to the plan as it is now, like `update` and `addBlock`:
  // a workspace that downgraded cannot mint new pages with paid-only settings.
  if (source.removeBranding && !canRemoveBioBranding(ctx.workspace.plan)) {
    throw forbidden("Removing ClickPath branding is available on Pro and Ultra plans.");
  }
  const theme = normalizeTheme(ctx, definition, source.theme as TemplatePageTheme | null);
  for (const block of blocks) {
    assertSchedulingAllowed(ctx, block.scheduledAt, block.scheduledUntil);
  }

  // Prepare every tracking link before the transaction (it validates URLs and
  // domains), and check the link quota once for all of them — only when the
  // copy creates links at all, since create itself has no link quota.
  const linkBlocks = blocks.filter((b) => b.type === "link" && b.url);
  if (linkBlocks.length > 0) {
    const { currentCount, limit } = await checkWorkspaceLinkLimit(ctx);
    if (limit !== undefined && currentCount + linkBlocks.length > limit) {
      throw forbidden(
        `This page has ${linkBlocks.length} link blocks, which would exceed your monthly link limit.`,
      );
    }
  }
  const preparedLinks = new Map<number, Awaited<ReturnType<typeof prepareHiddenTrackingLink>>>();
  for (const [i, block] of linkBlocks.entries()) {
    const prepared = await prepareHiddenTrackingLink(ctx, {
      url: block.url!,
      name: block.title || source.title || "Bio link",
      kind: "bio",
    });
    // Each insert writes `currentCount + 1`; offset them so N links count as N.
    preparedLinks.set(block.id, { ...prepared, currentCount: prepared.currentCount + i });
  }

  const ownership = workspaceOwnership(ctx.workspace);
  try {
    const page = await ctx.prisma.$transaction(async (tx) => {
      const created = await tx.templatePage.create({
        data: {
          slug: input.slug,
          userId: ownership.userId,
          teamId: ownership.teamId,
          createdByUserId: ctx.auth.userId,
          title: source.title,
          description: source.description,
          avatarUrl: source.avatarUrl,
          theme,
          socialImageUrl: source.socialImageUrl,
          seoTitle: source.seoTitle,
          seoDescription: source.seoDescription,
          removeBranding: source.removeBranding,
          templateType: source.templateType,
          templateData: source.templateData ?? undefined,
          qrDesign: source.qrDesign ?? undefined,
          shareDomain,
          pathPrefix,
          customDomain: null,
          isPublished: false,
        },
      });

      for (const [position, block] of blocks.entries()) {
        const prepared = preparedLinks.get(block.id);
        const linkId = prepared ? await insertHiddenTrackingLink(tx, ctx, prepared) : null;
        await tx.bioBlock.create({
          data: {
            templatePageId: created.id,
            type: block.type,
            title: block.title,
            content: block.content,
            url: block.url,
            linkId,
            isVisible: block.isVisible,
            position,
            scheduledAt: block.scheduledAt,
            scheduledUntil: block.scheduledUntil,
          },
        });
      }

      return created;
    });
    return { id: page.id, slug: page.slug, templateType: definition.id };
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

  if (input.pathPrefix !== undefined || updates.shareDomain !== undefined) {
    const shareDomain = (
      updates.shareDomain !== undefined ? updates.shareDomain : page.shareDomain
    ) as string | null;
    if (input.pathPrefix !== undefined) {
      assertPathPrefixAllowed(input.pathPrefix, shareDomain);
      updates.pathPrefix = input.pathPrefix;
    } else if (!isPathPrefixAllowed(page.pathPrefix, shareDomain)) {
      // Moved back to the platform domain without naming a prefix: fall back to
      // /p rather than keep a prefix the platform does not serve.
      updates.pathPrefix = DEFAULT_TEMPLATE_PATH_PREFIX;
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
  /** The prefix the page is served at on a custom domain (always `p` without one). */
  pathPrefix: string;
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
    pathPrefix: templatePagePathPrefix(page),
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
 * A page requested from a customer domain at /<prefix>/<slug>.
 *
 * The host must be a verified domain of the workspace that owns the page — not
 * merely the page's own `shareDomain`. That deliberate looseness is what makes
 * the platform domain disposable: point any verified domain at this app and
 * every page in that workspace keeps resolving, printed QR codes included.
 *
 * The prefix, on the other hand, must be the page's own, so a page has one URL
 * per domain: a `productdetails` page is not found at /p/<slug> and vice versa.
 */
export async function getPublicTemplatePageBySlugForHost(
  ctx: PublicTRPCContext,
  slug: string,
  host: string,
  prefix: string = DEFAULT_TEMPLATE_PATH_PREFIX,
): Promise<PublicTemplatePage | null> {
  const normalized = normalizeHost(host);
  if (!normalized) return null;

  const page = await ctx.prisma.templatePage.findFirst({
    where: { slug: slug.trim().toLowerCase(), isPublished: true },
  });
  if (!page || templatePagePathPrefix(page) !== prefix) return null;

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
