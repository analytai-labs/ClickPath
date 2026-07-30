import { api } from "@/trpc/server";

import { TemplatesList } from "./_components/templates-list";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const [pages, sub] = await Promise.all([
    api.templatePage.list.query(),
    api.subscriptions.get.query(),
  ]);

  return <TemplatesList pages={pages} templatePageLimit={sub.caps.templatePageLimit ?? null} />;
}
