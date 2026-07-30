"use client";

import { BioEditor } from "./bio/bio-editor";
import { PharmaProductEditor } from "./pharma-product/pharma-product-editor";

import type { TemplateTypeId } from "@/lib/templates/registry";
import type { ComponentType } from "react";
import type { TemplateEditorProps } from "./editor-types";

/**
 * Template type → editor component. Register a new template's editor here and
 * /dashboard/templates/[id] serves it; everything else (header, publish,
 * settings, analytics, preview frame) comes from the shared shell.
 */
const EDITORS: Record<TemplateTypeId, ComponentType<TemplateEditorProps>> = {
  bio: BioEditor,
  pharma_product: PharmaProductEditor,
};

export function TemplateEditor(props: TemplateEditorProps) {
  const Editor = EDITORS[props.initialData.templateType] ?? EDITORS.bio;
  return <Editor {...props} />;
}
