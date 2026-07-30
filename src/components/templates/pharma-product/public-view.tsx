import { TemplatePageViewBeacon } from "@/components/templates/view-beacon";
import { normalizePharmaProductData } from "@/lib/templates/definitions/pharma-product";

import { PharmaProductRenderer } from "./renderer";

import type { PublicTemplatePageProps } from "@/components/templates/types";

/** Public-facing Pharma Product page — used by /p/[slug] and the custom-domain root. */
export function PharmaProductPublicView({ page }: PublicTemplatePageProps) {
  return (
    <main className="min-h-[100dvh]">
      <PharmaProductRenderer
        data={normalizePharmaProductData(page.templateData)}
        removeBranding={page.removeBranding}
        variantId={page.theme?.preset}
        heightClass="min-h-[100dvh]"
      />
      <TemplatePageViewBeacon templatePageId={page.id} />
    </main>
  );
}
