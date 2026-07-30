import { PublicBioView } from "@/components/bio/public-bio-view";
import { PharmaProductPublicView } from "@/components/templates/pharma-product/public-view";

import type { TemplateTypeId } from "@/lib/templates/registry";
import type { ComponentType } from "react";
import type { PublicTemplatePage, PublicTemplatePageProps } from "./types";

/**
 * Template type → public page component. Register a new template's view here
 * and both /p/[slug] and the custom-domain root pick it up.
 */
const PUBLIC_VIEWS: Record<TemplateTypeId, ComponentType<PublicTemplatePageProps>> = {
  bio: PublicBioView,
  pharma_product: PharmaProductPublicView,
};

/** Renders a published page with the view registered for its template. */
export function TemplatePublicView({ page }: { page: PublicTemplatePage }) {
  const View = PUBLIC_VIEWS[page.templateType] ?? PUBLIC_VIEWS.bio;
  return <View page={page} />;
}
