import type { RouterOutputs } from "@/trpc/shared";

/** A published template page as served to the public routes. */
export type PublicTemplatePage = NonNullable<RouterOutputs["templatePage"]["getBySlug"]>;

/** Props every template's public view receives. */
export type PublicTemplatePageProps = { page: PublicTemplatePage };
