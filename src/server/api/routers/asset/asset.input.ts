import { z } from "zod";

/** Matches the client-side and R2 caps; the payload is a base64 data URL. */
const MAX_IMAGE_CHARS = 5_000_000;

export const assetIdInput = z.object({ id: z.number().int().positive() });

export const folderIdInput = z.object({ id: z.number().int().positive() });

/** `null` means the library root; `undefined` means "don't change it". */
const folderRef = z.number().int().positive().nullish();

export const listAssetsInput = z.object({
  folderId: folderRef,
  search: z.string().trim().max(120).optional(),
  /** Show soft-deleted assets instead of live ones (the trash view). */
  deleted: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(60),
});

export const recentAssetsInput = z.object({
  limit: z.number().int().min(1).max(24).default(8),
});

export const uploadAssetInput = z.object({
  /** A base64 data URL — PNG, JPEG, GIF or WebP, under 2 MB decoded. */
  image: z.string().min(1).max(MAX_IMAGE_CHARS),
  name: z.string().trim().max(255).optional(),
  folderId: folderRef,
  /**
   * Whether to keep this image in the library for reuse. False records the
   * upload but hides it, so one-off images are still tracked and collectable.
   */
  save: z.boolean().default(true),
});

export const updateAssetInput = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(255).optional(),
  folderId: folderRef,
});

export const createFolderInput = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: folderRef,
});

export const updateFolderInput = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  parentId: folderRef,
});

export type ListAssetsInput = z.infer<typeof listAssetsInput>;
export type RecentAssetsInput = z.infer<typeof recentAssetsInput>;
export type UploadAssetInput = z.infer<typeof uploadAssetInput>;
export type UpdateAssetInput = z.infer<typeof updateAssetInput>;
export type CreateFolderInput = z.infer<typeof createFolderInput>;
export type UpdateFolderInput = z.infer<typeof updateFolderInput>;
