import { isManagedImageUrl } from "@/server/lib/storage";

/** Guards against a pathological/adversarial payload sending the walk deep. */
const MAX_DEPTH = 12;

/**
 * Every R2-hosted image URL referenced anywhere inside a JSON document.
 *
 * Used both to garbage-collect images that fell out of a template page and to
 * find which resources still stand behind an asset, so neither has to know the
 * shape of the document it is looking at.
 */
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
