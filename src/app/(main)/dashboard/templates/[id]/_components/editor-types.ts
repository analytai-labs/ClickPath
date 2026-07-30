import type { Plan } from "@/lib/billing/plans";
import type { RouterOutputs } from "@/trpc/shared";

/** A template page as loaded by the editor route. */
export type TemplatePageData = RouterOutputs["templatePage"]["get"];

/**
 * Props every template editor receives. An editor owns its own content/theme
 * state and renders `<TemplateEditorShell>` with the Content and Design bodies;
 * the shell supplies the header, the Settings and Analytics tabs, and the preview.
 */
export type TemplateEditorProps = {
  pageId: number;
  initialData: TemplatePageData;
  plan: Plan;
};
