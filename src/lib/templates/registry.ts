import { bioTemplate } from "./definitions/bio";
import { pharmaProductTemplate } from "./definitions/pharma-product";

import type { AnyTemplateDefinition, TemplateTypeId, TemplateVariant } from "./types";

/**
 * The template registry — the single place that knows which templates exist.
 *
 * Keyed by the Prisma `TemplateType` enum, so adding an enum member without a
 * definition here is a compile error. See ./README.md for the full checklist.
 */
export const TEMPLATE_DEFINITIONS: Record<TemplateTypeId, AnyTemplateDefinition> = {
  bio: bioTemplate,
  pharma_product: pharmaProductTemplate,
};

export const TEMPLATE_TYPE_IDS = Object.keys(TEMPLATE_DEFINITIONS) as [
  TemplateTypeId,
  ...TemplateTypeId[],
];

export function isTemplateTypeId(value: unknown): value is TemplateTypeId {
  return typeof value === "string" && value in TEMPLATE_DEFINITIONS;
}

/** Look up a definition, falling back to the bio template for unknown ids. */
export function getTemplateDefinition(id: string | null | undefined): AnyTemplateDefinition {
  return isTemplateTypeId(id) ? TEMPLATE_DEFINITIONS[id] : TEMPLATE_DEFINITIONS.bio;
}

/** Every template, in registry order — used by the "New template" menu and filters. */
export function listTemplateDefinitions(): AnyTemplateDefinition[] {
  return TEMPLATE_TYPE_IDS.map((id) => TEMPLATE_DEFINITIONS[id]);
}

export function findVariant(
  definition: AnyTemplateDefinition,
  variantId: string | null | undefined,
): TemplateVariant | undefined {
  return definition.variants.find((v) => v.id === variantId);
}

/** Normalize a stored/incoming variant id to one the template actually offers. */
export function resolveVariantId(
  definition: AnyTemplateDefinition,
  variantId: string | null | undefined,
): string {
  return findVariant(definition, variantId) ? variantId! : definition.defaultVariantId;
}

/** Path of the editor for a page. One generic route serves every template. */
export function templateEditorPath(pageId: number): string {
  return `/dashboard/templates/${pageId}`;
}

export type { AnyTemplateDefinition, TemplateTypeId, TemplateVariant };
