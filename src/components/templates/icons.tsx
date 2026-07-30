import { IconFlask, IconLayoutList } from "@tabler/icons-react";

import { getTemplateDefinition } from "@/lib/templates/registry";

import type { TemplateIconKey } from "@/lib/templates/types";
import type { Icon } from "@tabler/icons-react";

/**
 * Icon key → component. Kept apart from the public-view registry so client
 * components (the templates list, the create menu) can pull in an icon without
 * dragging the server-rendered public views into the browser bundle.
 */
const TEMPLATE_ICONS: Record<TemplateIconKey, Icon> = {
  "layout-list": IconLayoutList,
  flask: IconFlask,
};

export function templateIcon(iconKey: TemplateIconKey): Icon {
  return TEMPLATE_ICONS[iconKey] ?? IconLayoutList;
}

/** Icon for a template type id, tolerating unknown ids. */
export function templateIconFor(templateType: string | null | undefined): Icon {
  return templateIcon(getTemplateDefinition(templateType).iconKey);
}
