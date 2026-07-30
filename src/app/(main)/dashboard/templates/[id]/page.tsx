import { notFound } from "next/navigation";

import { api } from "@/trpc/server";

import { TemplateEditor } from "./_components/editor-registry";

import type { RouterOutputs } from "@/trpc/shared";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * One editor route for every template. The registry picks the editor from the
 * page's own `templateType`, so a page can never be opened in the wrong editor.
 */
export default async function TemplateEditorPage(props: Props) {
  const { id: idParam } = await props.params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let page: RouterOutputs["templatePage"]["get"];
  try {
    page = await api.templatePage.get.query({ id });
  } catch {
    notFound();
  }

  const sub = await api.subscriptions.get.query();

  return <TemplateEditor pageId={id} initialData={page} plan={sub.plan} />;
}
