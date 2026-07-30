import { customAlphabet } from "nanoid";

import { uploadAndRecordAsset } from "@/server/lib/assets";
import { isUploadableDataUrl } from "@/server/lib/storage";

import type { WorkspaceTRPCContext } from "../../trpc";

/**
 * Generic image handling for `TemplatePage.templateData`.
 *
 * Templates declare their data shape and nothing about storage: any base64
 * image anywhere in the document is uploaded to R2 on save, and any R2 object
 * that falls out of the document is released. That keeps `imageUrl`-style
 * fields a plain part of a template's zod schema instead of bespoke upload
 * code.
 */

const randomSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

// Guards against a pathological/adversarial payload sending the walk deep.
const MAX_DEPTH = 12;

export { collectManagedImageUrls } from "@/server/lib/assets";
export { isManagedImageUrl } from "@/server/lib/storage";

/**
 * Replace every base64 image in a template data document with its uploaded R2
 * URL, leaving existing URLs untouched. Uploads run concurrently.
 *
 * Inline uploads are recorded as non-library assets: they stay out of the
 * picker, but the registry knows their storage key, so cleanup can remove them
 * without ever touching an image the user deliberately saved.
 */
export async function materializeDataImages<T>(
  ctx: WorkspaceTRPCContext,
  pageId: number,
  value: T,
  depth = 0,
): Promise<T> {
  if (depth > MAX_DEPTH) return value;

  if (typeof value === "string") {
    if (!isUploadableDataUrl(value)) return value;
    try {
      const asset = await uploadAndRecordAsset(ctx, value, {
        name: `Page ${pageId} image ${randomSuffix()}`,
        library: false,
      });
      return asset.url as T;
    } catch {
      // Keep the base64 so the user's edit is not silently lost; the next save
      // retries the upload.
      return value;
    }
  }

  if (Array.isArray(value)) {
    return (await Promise.all(
      value.map((item) => materializeDataImages(ctx, pageId, item, depth + 1)),
    )) as T;
  }

  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(
        async ([key, item]) =>
          [key, await materializeDataImages(ctx, pageId, item, depth + 1)] as const,
      ),
    );
    return Object.fromEntries(entries) as T;
  }

  return value;
}
