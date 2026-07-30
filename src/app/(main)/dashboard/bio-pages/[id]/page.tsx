import { redirect } from "next/navigation";

import { templateEditorPath } from "@/lib/templates/registry";

type Props = { params: Promise<{ id: string }> };

// The bio builder moved to the shared /dashboard/templates/[id] editor.
export default async function BioPageEditorRedirect({ params }: Props) {
  const { id } = await params;
  const pageId = Number(id);
  redirect(
    Number.isInteger(pageId) && pageId > 0 ? templateEditorPath(pageId) : "/dashboard/templates",
  );
}
