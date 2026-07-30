import { redirect } from "next/navigation";

import { templateEditorPath } from "@/lib/templates/registry";

type Props = { params: Promise<{ id: string }> };

// Per-template editor routes were replaced by the shared /dashboard/templates/[id].
export default async function PharmaProductEditorRedirect({ params }: Props) {
  const { id } = await params;
  const pageId = Number(id);
  redirect(
    Number.isInteger(pageId) && pageId > 0 ? templateEditorPath(pageId) : "/dashboard/templates",
  );
}
