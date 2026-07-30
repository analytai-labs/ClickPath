import { createHash } from "node:crypto";

import { env } from "@/env.mjs";
import { logger } from "@/lib/logger";
import type { WorkspaceTRPCContext } from "@/server/api/trpc";
import { workspaceOwnership } from "@/server/lib/workspace";

import { normalizeImageOrientation } from "./image-orientation";
import { isR2Configured, r2DeleteImage, r2UploadImage } from "./r2";
import type { ImageType, UploadedImage } from "./types";

const log = logger.child({ component: "image-upload" });

const MAX_SIZE_BYTES = 2 * 1024 * 1024;

const DATA_URL_PATTERN = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/;

const EXTENSION_MAP: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
};

interface UploadImageOptions {
  image: string;
  /** Becomes the R2 object name. Use a string when one resource owns many images. */
  resourceId: number | string;
  imageType: ImageType;
}

/** True for a base64 data URL in a format this app accepts. */
export function isUploadableDataUrl(value: string): boolean {
  return DATA_URL_PATTERN.test(value);
}

/**
 * Upload a base64 data URL to R2 and report everything about where it landed.
 *
 * Throws on a bad payload or a failed upload — callers that only want a URL and
 * can tolerate falling back to the input should use `uploadImage` instead.
 */
export async function uploadImageDetailed(
  ctx: WorkspaceTRPCContext,
  { image, resourceId, imageType }: UploadImageOptions,
): Promise<UploadedImage> {
  const match = image.match(DATA_URL_PATTERN);
  if (!match) throw new Error("Not a supported base64 image");
  if (!isR2Configured()) throw new Error("R2 storage not configured");

  const [, format, base64Data] = match;
  const rawBuffer = Buffer.from(base64Data!, "base64");

  if (rawBuffer.length > MAX_SIZE_BYTES) {
    throw new Error("Image exceeds maximum size of 2MB");
  }

  // Bake in EXIF orientation so the OG image (rendered by next/og, which
  // ignores the tag) matches the upright way browsers show the avatar.
  const buffer = await normalizeImageOrientation(rawBuffer, format!);
  const contentType = `image/${format}`;
  const ownership = workspaceOwnership(ctx.workspace);

  const { url, key } = await r2UploadImage({
    buffer,
    contentType,
    imageType,
    workspaceId: ownership.teamId?.toString() ?? ownership.userId,
    resourceId: resourceId.toString(),
    workspaceType: ownership.teamId ? "team" : "personal",
    extension: EXTENSION_MAP[format!] || "png",
  });

  return {
    url,
    key,
    contentType,
    byteSize: buffer.length,
    checksum: createHash("sha256").update(buffer).digest("hex"),
  };
}

/**
 * Upload an image if it needs uploading, and return a URL either way.
 *
 * Passes the input straight through when it is empty, already a URL, not a
 * supported data URL, or when R2 isn't configured — so callers can hand it any
 * image value without checking first.
 */
export async function uploadImage(
  ctx: WorkspaceTRPCContext,
  options: UploadImageOptions,
): Promise<string | undefined> {
  const { image, imageType, resourceId } = options;
  if (!image) return undefined;
  if (image.startsWith("http")) return image;
  if (!isUploadableDataUrl(image)) return image;
  if (!isR2Configured()) return image;

  try {
    const uploaded = await uploadImageDetailed(ctx, options);
    return uploaded.url;
  } catch (error) {
    log.error({ err: error, imageType, resourceId }, "failed to upload image to R2");
    return image;
  }
}

/** True for a URL this app uploaded to its own R2 bucket (and may therefore delete). */
export function isManagedImageUrl(value: unknown): value is string {
  const base = env.R2_PUBLIC_URL;
  return typeof value === "string" && !!base && value.startsWith(`${base}/`);
}

export async function deleteImage(imageUrl: string): Promise<void> {
  const publicUrl = env.R2_PUBLIC_URL;
  if (!publicUrl || !imageUrl.startsWith(publicUrl)) return;

  const key = imageUrl.slice(publicUrl.length + 1);
  if (key) await r2DeleteImage(key);
}

/** Delete by object key — the reliable path once an asset recorded its key. */
export async function deleteImageByKey(key: string): Promise<void> {
  if (key) await r2DeleteImage(key);
}
