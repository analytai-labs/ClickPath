import type { RouterOutputs } from "@/trpc/shared";
import type { PharmaProductData } from "@/components/templates/types";
import { PharmaProductRenderer } from "./pharma-product-renderer";
import { BioPageViewBeacon } from "@/components/bio/view-beacon";

type PublicTemplatePage = NonNullable<RouterOutputs["templatePage"]["getBySlug"]>;

function getPharmaData(page: PublicTemplatePage): PharmaProductData {
  const raw = page.templateData as Partial<PharmaProductData> | null;
  return {
    productName: raw?.productName ?? "",
    composition: raw?.composition ?? "",
    productOverview: raw?.productOverview ?? "",
    marketed: raw?.marketed ?? { name: "", address: "" },
    manufactured: raw?.manufactured ?? { name: "", address: "" },
    productImages: raw?.productImages ?? [],
    documents: raw?.documents ?? [],
    contact: raw?.contact ?? { name: "", whatsapp: "", email: "" },
  };
}

/** Public-facing Pharma Product template page — used by /p/[slug] and custom-domain root. */
export function PharmaProductPublicView({ page }: { page: PublicTemplatePage }) {
  const data = getPharmaData(page);
  const themePreset = (page.theme as { preset?: string } | null)?.preset ?? "clean";

  return (
    <main className="min-h-[100dvh]">
      <PharmaProductRenderer
        data={data}
        removeBranding={page.removeBranding}
        themePreset={themePreset}
        heightClass="min-h-[100dvh]"
      />
      {/* Reuse the same analytics beacon — it just records a view for the page ID */}
      <BioPageViewBeacon bioPageId={page.id} />
    </main>
  );
}
