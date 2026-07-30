import { logger } from "@/lib/logger";
import {
  deleteImage,
  deleteImageByKey,
  isManagedImageUrl,
  uploadImageDetailed,
} from "@/server/lib/storage";
import { workspaceFilter, workspaceOwnership } from "@/server/lib/workspace";

import type { WorkspaceTRPCContext } from "@/server/api/trpc";
import type { UploadedImage } from "@/server/lib/storage";
import type { Asset } from "@prisma/client";

const log = logger.child({ component: "asset-registry" });

type RecordOptions = {
  name: string;
  folderId?: number | null;
  /** False for inline one-off uploads: tracked, but kept out of the library UI. */
  library: boolean;
};

/**
 * The bookkeeping half of the asset library.
 *
 * Every object this app writes to R2 gets exactly one `Asset` row, whether or
 * not the user chose to keep it. That single rule is what makes deletion safe:
 * anything that wants to remove an image asks the registry first, and the
 * registry refuses to destroy bytes that a saved asset still stands behind.
 */

/** Upload an image and record it, reusing an identical asset if one exists. */
export async function uploadAndRecordAsset(
  ctx: WorkspaceTRPCContext,
  image: string,
  options: RecordOptions,
): Promise<Asset> {
  const ownership = workspaceOwnership(ctx.workspace);
  // A placeholder id keeps the R2 key unique per upload; the row is created
  // afterwards, so there is no id to name the object after yet.
  const uploaded = await uploadImageDetailed(ctx, {
    image,
    resourceId: `${ownership.teamId ?? ownership.userId}-${Date.now().toString(36)}-${randomKeySuffix()}`,
    imageType: "asset",
  });

  const duplicate = await findDuplicate(ctx, uploaded, options.library);
  if (duplicate) {
    // The bytes are already in the library — drop the copy we just made rather
    // than leaving an orphan behind, and hand back what the user already has.
    await deleteImageByKey(uploaded.key).catch((err) =>
      log.error({ err, key: uploaded.key }, "failed to remove duplicate upload"),
    );
    return duplicate;
  }

  return ctx.prisma.asset.create({
    data: {
      ...ownership,
      folderId: options.library ? (options.folderId ?? null) : null,
      name: options.name.slice(0, 255) || "Untitled",
      url: uploaded.url,
      storageKey: uploaded.key,
      mimeType: uploaded.contentType,
      byteSize: uploaded.byteSize,
      checksum: uploaded.checksum,
      library: options.library,
    },
  });
}

/**
 * Release an image a resource no longer references.
 *
 * Removes the R2 object only when nothing in the library stands behind it — a
 * saved asset is deliberately kept, because other resources (and QR codes that
 * are already printed and still re-rendered on demand) may point at the same
 * URL. Untracked legacy URLs keep the old behaviour and are deleted.
 */
export async function releaseImage(ctx: WorkspaceTRPCContext, url: string): Promise<void> {
  if (!isManagedImageUrl(url)) return;

  const asset = await ctx.prisma.asset.findFirst({
    where: { url, ...workspaceFilter(ctx.workspace) },
    select: { id: true, library: true, storageKey: true },
  });

  if (asset?.library) return; // saved for reuse — never collected implicitly

  if (asset) {
    await ctx.prisma.asset.delete({ where: { id: asset.id } });
    await (asset.storageKey ? deleteImageByKey(asset.storageKey) : deleteImage(url));
    return;
  }

  await deleteImage(url);
}

/** Release many images, never letting one failure block the others. */
export async function releaseImages(
  ctx: WorkspaceTRPCContext,
  urls: readonly (string | null | undefined)[],
): Promise<void> {
  await Promise.all(
    urls
      .filter((url): url is string => Boolean(url))
      .map((url) =>
        releaseImage(ctx, url).catch((err) => log.error({ err, url }, "failed to release image")),
      ),
  );
}

async function findDuplicate(
  ctx: WorkspaceTRPCContext,
  uploaded: UploadedImage,
  library: boolean,
): Promise<Asset | null> {
  // Only library assets are deduplicated: a one-off upload belongs to the
  // resource that made it and must not be shared with anything else.
  if (!library) return null;

  return ctx.prisma.asset.findFirst({
    where: {
      ...workspaceFilter(ctx.workspace),
      checksum: uploaded.checksum,
      library: true,
      deletedAt: null,
    },
  });
}

function randomKeySuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
