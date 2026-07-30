import { getTemplateDefinition } from "./registry";

import type { TemplateTypeId } from "./types";

/**
 * The fields needed to work out how a page presents itself when shared. Kept as
 * a structural type so both the server row and the editor's unsaved draft fit.
 */
export type ShareMetadataSource = {
  slug: string;
  title: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  templateType: TemplateTypeId;
  templateData: unknown;
};

export type ShareMetadata = {
  /** What actually goes in `<title>` / `og:title`. */
  title: string;
  /** What actually goes in `<meta description>` / `og:description`. */
  description: string | null;
  /** The value used when no SEO override is set — what the "auto" switch shows. */
  autoTitle: string;
  autoDescription: string | null;
  /** Whether each field is currently following the content rather than an override. */
  usingAutoTitle: boolean;
  usingAutoDescription: boolean;
};

/**
 * Resolves the title and description a template page is shared with.
 *
 * A null `seoTitle`/`seoDescription` means "follow the content" rather than
 * "empty" — so the editor can show what a share will actually look like without
 * forcing the user to retype what the page already says. This is the single
 * source of truth for the public routes and for the editor's share preview; if
 * they computed it separately the preview would eventually start lying.
 */
export function resolveShareMetadata(page: ShareMetadataSource): ShareMetadata {
  const definition = getTemplateDefinition(page.templateType);
  const data = page.templateData ?? definition.defaultData;

  const autoTitle = page.title?.trim() || definition.deriveTitle(data)?.trim() || `@${page.slug}`;
  const autoDescription =
    page.description?.trim() || definition.deriveDescription(data)?.trim() || null;

  const overrideTitle = page.seoTitle?.trim() || null;
  const overrideDescription = page.seoDescription?.trim() || null;

  return {
    title: overrideTitle ?? autoTitle,
    description: overrideDescription ?? autoDescription,
    autoTitle,
    autoDescription,
    usingAutoTitle: overrideTitle === null,
    usingAutoDescription: overrideDescription === null,
  };
}
