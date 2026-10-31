/**
 * Slug generation and sanitation utilities for link aliases.
 */

const RANDOM_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generate an unguessable lowercase alphanumeric slug from a CSPRNG
 * (`crypto.getRandomValues`, available in browsers, Node and Bun). Bytes at or
 * above the largest multiple of the alphabet size are rejected so every
 * character is equally likely.
 */
export function generateRandomSlug(length = 7): string {
  const limit = 256 - (256 % RANDOM_CHARS.length);
  let result = "";
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      result += RANDOM_CHARS.charAt(byte % RANDOM_CHARS.length);
      if (result.length === length) break;
    }
  }
  return result;
}

/**
 * Cleanly slugify a human-readable link name or title into a valid URL alias slug.
 *
 * Rules:
 * - Accents and diacritics are stripped (e.g. "Flücérae" -> "flucerae")
 * - Spaces and underscores become single hyphens
 * - Any non-alphanumeric character (except hyphens and underscores) is removed
 * - Length is capped at `maxLength = 20` to strictly respect the PostgreSQL Link.alias VARCHAR(20) constraint
 * - If the resulting slug is shorter than `minLength` (default 6, to comply with Free Plan rules),
 *   it is padded with a clean hyphenated random suffix (e.g. "app" -> "app-9k2")
 * - If the name consists only of non-Latin characters or is blank, falls back to a clean random slug.
 */
export function slugifyLinkName(name: string, minLength = 6, maxLength = 20): string {
  let slug = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip accents (combining marks left by NFD)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, "") // keep only alphanum, whitespace, hyphen, underscore
    .replace(/[\s_]+/g, "-") // convert spaces and underscores to hyphens
    .replace(/-+/g, "-") // collapse repeated hyphens
    .replace(/^-+|-+$/g, ""); // trim leading and trailing hyphens

  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength).replace(/-+$/, "");
  }

  // If input had no Latin alphanumeric characters
  if (!slug) {
    return generateRandomSlug(Math.min(maxLength, Math.max(7, minLength)));
  }

  // Ensure minimum length of 6 for Free Plan compliance
  if (slug.length < minLength) {
    const padNeeded = minLength - slug.length;
    const suffix = generateRandomSlug(Math.max(3, padNeeded + 1));
    slug = `${slug}-${suffix}`;
  }

  // Final safety clamp to never exceed PostgreSQL VARCHAR(20)
  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength).replace(/-+$/, "");
  }

  return slug;
}
