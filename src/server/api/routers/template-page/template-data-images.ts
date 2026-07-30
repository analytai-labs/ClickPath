import { customAlphabet } from "nanoid";

import { env } from "@/env.mjs";
import { uploadImage } from "@/server/lib/storage";

import type { WorkspaceTRPCContext } from "../../trpc";

/**
 * Generic image handling for `TemplatePage.templateData`.
 *
 * Templates declare their data shape and nothing about storage: any base64
 * image anywhere in the document is uploaded to R2 on save, and any R2 object
 * that falls out of the document is deleted. That keeps `imageUrl`-style fields
 * a plain part of a template's zod schema instead of bespoke upload code.
 */

const DATA_IMAGE_PREFIX = /^data:image\/(?:png|jpe?g|gif|webp);base64,/;

// Guards against a pathological/adversarial payload sending the walk deep.
const MAX_DEPTH = 12;

const randomSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

function isDataImage(value: string): boolean {
  return DATA_IMAGE_PREFIX.test(value);
}

/** True for a URL this app uploaded to its own R2 bucket (and may therefore delete). */
export function isManagedImageUrl(value: unknown): value is string {
  const base = env.R2_PUBLIC_URL;
  return typeof value === "string" && !!base && value.startsWith(`${base}/`);
}

/** Every R2-hosted image URL referenced anywhere inside a template data document. */
export function collectManagedImageUrls(value: unknown, depth = 0): string[] {
  if (depth > MAX_DEPTH) return [];
  if (typeof value === "string") return isManagedImageUrl(value) ? [value] : [];
  if (Array.isArray(value))
    return value.flatMap((item) => collectManagedImageUrls(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectManagedImageUrls(item, depth + 1));
  }
  return [];
}

/**
 * Replace every base64 image in a template data document with its uploaded R2
 * URL, leaving existing URLs untouched. Uploads run concurrently.
 *
 * R2 keys are `…/template-media/<pageId>-<random>.<ext>`, so images of the same
 * page never overwrite each other and stay traceable to their page.
 */
export async function materializeDataImages<T>(
  ctx: WorkspaceTRPCContext,
  pageId: number,
  value: T,
  depth = 0,
): Promise<T> {
  if (depth > MAX_DEPTH) return value;

  if (typeof value === "string") {
    if (!isDataImage(value)) return value;
    const uploaded = await uploadImage(ctx, {
      image: value,
      resourceId: `${pageId}-${randomSuffix()}`,
      imageType: "template-media",
    });
    return (uploaded ?? value) as T;
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
