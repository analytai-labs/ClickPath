import { api } from "@/trpc/server";
import { TemplatesList } from "./_components/templates-list";

export const dynamic = "force-dynamic";

async function TemplatesPage() {
  const [pages, sub] = await Promise.all([
    api.templatePage.list.query(),
    api.subscriptions.get.query(),
  ]);

  return (
    <TemplatesList
      pages={pages}
      plan={sub.plan}
      templatePageLimit={sub.caps.templatePageLimit ?? null}
    />
  );
}

export default TemplatesPage;
