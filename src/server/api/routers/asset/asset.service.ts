import { TRPCError } from "@trpc/server";

import { canUseAssetLibrary } from "@/lib/billing/plans";
import { findAssetUsage, uploadAndRecordAsset } from "@/server/lib/assets";
import { deleteImage, deleteImageByKey, isR2Configured } from "@/server/lib/storage";
import { workspaceFilter, workspaceOwnership } from "@/server/lib/workspace";

import type { Asset, AssetFolder } from "@prisma/client";
import type { WorkspaceTRPCContext } from "../../trpc";
import type {
  CreateFolderInput,
  ListAssetsInput,
  RecentAssetsInput,
  UpdateAssetInput,
  UpdateFolderInput,
  UploadAssetInput,
} from "./asset.input";

/** Deep enough to group by client and campaign; shallow enough to stay readable. */
const MAX_FOLDER_DEPTH = 5;

/** Fields the picker and the library page need — never the whole row. */
const ASSET_SELECT = {
  id: true,
  name: true,
  url: true,
  folderId: true,
  mimeType: true,
  byteSize: true,
  library: true,
  deletedAt: true,
  createdAt: true,
} as const;

export type AssetSummary = Pick<Asset, keyof typeof ASSET_SELECT & keyof Asset>;

/**
 * What this workspace may do with assets.
 *
 * Uploading works on every plan — the paid boundary is keeping images around
 * for reuse, not the ability to put a logo on a QR code.
 */
export function getAssetCapabilities(ctx: WorkspaceTRPCContext) {
  return {
    canSave: canUseAssetLibrary(ctx.workspace.plan),
    storageConfigured: isR2Configured(),
  };
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/**
 * Every folder in the workspace, ordered for display.
 *
 * Returned as a flat list: a workspace has a handful of folders, and the client
 * builds whatever tree or breadcrumb it needs without a round trip per level.
 */
export async function listFolders(ctx: WorkspaceTRPCContext): Promise<AssetFolder[]> {
  return ctx.prisma.assetFolder.findMany({
    where: workspaceFilter(ctx.workspace),
    orderBy: [{ name: "asc" }],
  });
}

export async function createFolder(
  ctx: WorkspaceTRPCContext,
  input: CreateFolderInput,
): Promise<AssetFolder> {
  requireAssetLibrary(ctx);

  const parentId = input.parentId ?? null;
  if (parentId !== null) {
    const parent = await requireFolder(ctx, parentId);
    if ((await folderDepth(ctx, parent.id)) + 1 >= MAX_FOLDER_DEPTH) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Folders can only be nested ${MAX_FOLDER_DEPTH} levels deep.`,
      });
    }
  }

  return ctx.prisma.assetFolder.create({
    data: { ...workspaceOwnership(ctx.workspace), name: input.name, parentId },
  });
}

export async function updateFolder(
  ctx: WorkspaceTRPCContext,
  input: UpdateFolderInput,
): Promise<AssetFolder> {
  requireAssetLibrary(ctx);
  const folder = await requireFolder(ctx, input.id);

  const data: { name?: string; parentId?: number | null } = {};
  if (input.name !== undefined) data.name = input.name;

  if (input.parentId !== undefined) {
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      if (parentId === folder.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A folder can't contain itself." });
      }
      await requireFolder(ctx, parentId);
      if (await isDescendant(ctx, parentId, folder.id)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A folder can't be moved inside one of its own subfolders.",
        });
      }
    }
    data.parentId = parentId;
  }

  return ctx.prisma.assetFolder.update({ where: { id: folder.id }, data });
}

/**
 * Delete a folder without losing anything inside it.
 *
 * Assets and subfolders move up to the parent rather than being removed —
 * deleting a folder is an organizational act, not a destructive one.
 */
export async function deleteFolder(
  ctx: WorkspaceTRPCContext,
  id: number,
): Promise<{ success: true; movedAssets: number; movedFolders: number }> {
  requireAssetLibrary(ctx);
  const folder = await requireFolder(ctx, id);

  const [movedAssets, movedFolders] = await ctx.prisma.$transaction([
    ctx.prisma.asset.updateMany({
      where: { folderId: folder.id },
      data: { folderId: folder.parentId },
    }),
    ctx.prisma.assetFolder.updateMany({
      where: { parentId: folder.id },
      data: { parentId: folder.parentId },
    }),
  ]);

  await ctx.prisma.assetFolder.delete({ where: { id: folder.id } });

  return { success: true, movedAssets: movedAssets.count, movedFolders: movedFolders.count };
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export async function listAssets(
  ctx: WorkspaceTRPCContext,
  input: ListAssetsInput,
): Promise<AssetSummary[]> {
  const search = input.search?.trim();

  // Trash and search are both flat views of the whole library — only plain
  // browsing is scoped to a folder, otherwise a deleted asset would stay
  // hidden inside a folder the trash view never navigates to.
  const flat = input.deleted || Boolean(search);

  return ctx.prisma.asset.findMany({
    where: {
      ...workspaceFilter(ctx.workspace),
      library: true,
      deletedAt: input.deleted ? { not: null } : null,
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      ...(flat ? {} : { folderId: input.folderId ?? null }),
    },
    select: ASSET_SELECT,
    orderBy: { createdAt: "desc" },
    take: input.limit,
  });
}

/** The most recently added assets, for the quick-pick strip above a picker. */
export async function recentAssets(
  ctx: WorkspaceTRPCContext,
  input: RecentAssetsInput,
): Promise<AssetSummary[]> {
  return ctx.prisma.asset.findMany({
    where: { ...workspaceFilter(ctx.workspace), library: true, deletedAt: null },
    select: ASSET_SELECT,
    orderBy: { createdAt: "desc" },
    take: input.limit,
  });
}

/**
 * Upload an image and return its URL.
 *
 * `save: false` still uploads and records the image — it just stays out of the
 * library. That keeps every consumer on one code path: they always receive a
 * URL, never base64, whether or not the user wanted to keep the file.
 */
export async function uploadAsset(
  ctx: WorkspaceTRPCContext,
  input: UploadAssetInput,
): Promise<AssetSummary> {
  if (!isR2Configured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Image storage isn't configured for this deployment.",
    });
  }

  const save = input.save && canUseAssetLibrary(ctx.workspace.plan);
  if (save && input.folderId != null) await requireFolder(ctx, input.folderId);

  let asset: Asset;
  try {
    asset = await uploadAndRecordAsset(ctx, input.image, {
      name: input.name?.trim() || defaultAssetName(),
      folderId: input.folderId ?? null,
      library: save,
    });
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error && error.message.includes("2MB")
          ? "Image must be under 2 MB."
          : "That image couldn't be uploaded. Please try a PNG, JPEG, WebP or GIF.",
    });
  }

  return pickSummary(asset);
}

export async function updateAsset(
  ctx: WorkspaceTRPCContext,
  input: UpdateAssetInput,
): Promise<AssetSummary> {
  requireAssetLibrary(ctx);
  const asset = await requireAsset(ctx, input.id);

  const data: { name?: string; folderId?: number | null } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.folderId !== undefined) {
    if (input.folderId != null) await requireFolder(ctx, input.folderId);
    data.folderId = input.folderId ?? null;
  }

  const updated = await ctx.prisma.asset.update({ where: { id: asset.id }, data });
  return pickSummary(updated);
}

/**
 * Remove an asset from the library without touching the stored image.
 *
 * Deliberately a soft delete: the URL may already be baked into a published
 * page or a QR code that is printed on packaging and still re-rendered from
 * this URL on every download. Removing the object would break those silently,
 * so the entry disappears from the library and the bytes stay put.
 */
export async function deleteAsset(
  ctx: WorkspaceTRPCContext,
  id: number,
): Promise<{ success: true }> {
  const asset = await requireAsset(ctx, id);
  if (asset.deletedAt) return { success: true };

  await ctx.prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } });
  return { success: true };
}

export async function restoreAsset(
  ctx: WorkspaceTRPCContext,
  id: number,
): Promise<{ success: true }> {
  const asset = await requireAsset(ctx, id);
  await ctx.prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: null } });
  return { success: true };
}

/**
 * Permanently delete the stored image. Refused while anything still uses it.
 */
export async function purgeAsset(
  ctx: WorkspaceTRPCContext,
  id: number,
): Promise<{ success: true }> {
  const asset = await requireAsset(ctx, id);

  const usage = await findAssetUsage(ctx, asset.url);
  if (usage.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This image is still used by ${usage.length} ${
        usage.length === 1 ? "item" : "items"
      }. Remove it there first, or leave it in the trash.`,
    });
  }

  await ctx.prisma.asset.delete({ where: { id: asset.id } });
  await (asset.storageKey ? deleteImageByKey(asset.storageKey) : deleteImage(asset.url));

  return { success: true };
}

/** Where an asset is currently in use — shown before a destructive action. */
export async function getAssetUsage(ctx: WorkspaceTRPCContext, id: number) {
  const asset = await requireAsset(ctx, id);
  return findAssetUsage(ctx, asset.url);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireAssetLibrary(ctx: WorkspaceTRPCContext): void {
  if (!canUseAssetLibrary(ctx.workspace.plan)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Saving and organizing assets is available on Pro and Ultra plans.",
    });
  }
}

async function requireAsset(ctx: WorkspaceTRPCContext, id: number): Promise<Asset> {
  const asset = await ctx.prisma.asset.findFirst({
    where: { id, ...workspaceFilter(ctx.workspace) },
  });
  if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found." });
  return asset;
}

async function requireFolder(ctx: WorkspaceTRPCContext, id: number): Promise<AssetFolder> {
  const folder = await ctx.prisma.assetFolder.findFirst({
    where: { id, ...workspaceFilter(ctx.workspace) },
  });
  if (!folder) throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found." });
  return folder;
}

/** How many ancestors a folder has. Bounded by MAX_FOLDER_DEPTH walks. */
async function folderDepth(ctx: WorkspaceTRPCContext, folderId: number): Promise<number> {
  let depth = 0;
  let current: number | null = folderId;

  while (current !== null && depth < MAX_FOLDER_DEPTH) {
    const parent: { parentId: number | null } | null = await ctx.prisma.assetFolder.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    if (!parent?.parentId) break;
    current = parent.parentId;
    depth += 1;
  }

  return depth;
}

/** True when `candidateId` sits somewhere under `ancestorId`. */
async function isDescendant(
  ctx: WorkspaceTRPCContext,
  candidateId: number,
  ancestorId: number,
): Promise<boolean> {
  let current: number | null = candidateId;

  for (let step = 0; current !== null && step <= MAX_FOLDER_DEPTH; step += 1) {
    if (current === ancestorId) return true;
    const parent: { parentId: number | null } | null = await ctx.prisma.assetFolder.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    current = parent?.parentId ?? null;
  }

  return false;
}

function defaultAssetName(): string {
  return `Image ${new Date().toISOString().slice(0, 10)}`;
}

function pickSummary(asset: Asset): AssetSummary {
  return {
    id: asset.id,
    name: asset.name,
    url: asset.url,
    folderId: asset.folderId,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    library: asset.library,
    deletedAt: asset.deletedAt,
    createdAt: asset.createdAt,
  };
}
