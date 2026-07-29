import { notFound } from "next/navigation";

import { api } from "@/trpc/server";
import type { RouterOutputs } from "@/trpc/shared";

import { PharmaProductBuilder } from "./_components/pharma-product-builder";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function PharmaProductBuilderPage(props: Props) {
  const { id: idParam } = await props.params;
  const id = Number(idParam);
  if (!Number.isFinite(id)) notFound();

  let page: RouterOutputs["templatePage"]["get"];
  try {
    page = await api.templatePage.get.query({ id });
  } catch {
    notFound();
  }

  // Guard: only pharma_product type is served on this route
  if (page.templateType !== "pharma_product") {
    notFound();
  }

  const sub = await api.subscriptions.get.query();

  return <PharmaProductBuilder pageId={id} initialData={page} plan={sub.plan} />;
}
