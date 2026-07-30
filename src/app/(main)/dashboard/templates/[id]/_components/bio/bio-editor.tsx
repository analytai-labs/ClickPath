"use client";

import {
  IconAlignLeft,
  IconChevronDown,
  IconHeading,
  IconLine,
  IconLink,
  IconMail,
  IconPlus,
  IconWorld,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  type BioRenderBlock,
  type BioRenderModel,
  BioRenderer,
} from "@/components/bio/bio-renderer";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getTemplateDefinition, resolveVariantId } from "@/lib/templates/registry";
import type { BioPageTheme } from "@/server/db/types";
import { api } from "@/trpc/react";
import type { BioBlockType } from "@prisma/client";

import { EditorCard } from "../editor-ui";
import { TemplateEditorShell } from "../template-editor-shell";
import { BioDesignPanel } from "./bio-design-panel";
import { BlockFormDialog } from "./block-form-dialog";
import { BlockList } from "./block-list";

import type { TemplateEditorProps, TemplatePageData } from "../editor-types";

type EditorBlock = TemplatePageData["blocks"][number];

const ADD_OPTIONS: { type: BioBlockType; label: string; icon: typeof IconLink }[] = [
  { type: "link", label: "Link", icon: IconLink },
  { type: "heading", label: "Heading", icon: IconHeading },
  { type: "text", label: "Text", icon: IconAlignLeft },
  { type: "social", label: "Social icons", icon: IconWorld },
  { type: "email", label: "Email button", icon: IconMail },
  { type: "divider", label: "Divider", icon: IconLine },
];

function toRenderBlock(b: EditorBlock): BioRenderBlock {
  switch (b.type) {
    case "link":
      return { id: b.id, type: "link", title: b.title, href: b.shortUrl };
    case "email":
      return { id: b.id, type: "email", title: b.title, href: b.url ? `mailto:${b.url}` : null };
    case "heading":
      return { id: b.id, type: "heading", title: b.title };
    case "text":
      return { id: b.id, type: "text", content: b.content };
    case "social":
      return { id: b.id, type: "social", socials: b.socials ?? [] };
    default:
      return { id: b.id, type: "divider" };
  }
}

export function BioEditor({ pageId, initialData, plan }: TemplateEditorProps) {
  const utils = api.useUtils();
  const { data } = api.templatePage.get.useQuery(
    { id: pageId },
    { initialData, refetchOnWindowFocus: false },
  );
  const page = data ?? initialData;
  const definition = getTemplateDefinition(page.templateType);

  const [theme, setTheme] = useState<BioPageTheme>(() => {
    const stored = (page.theme as BioPageTheme | null) ?? {};
    return { ...stored, preset: resolveVariantId(definition, stored.preset) };
  });
  const [themeDirty, setThemeDirty] = useState(false);
  const [adding, setAdding] = useState<BioBlockType | null>(null);

  const refresh = () => utils.templatePage.get.invalidate({ id: pageId });

  const saveTheme = api.templatePage.update.useMutation({
    onSuccess: () => {
      toast.success("Design saved.");
      setThemeDirty(false);
      void refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const addBlock = api.templatePage.addBlock.useMutation({
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });

  function patchTheme(patch: Partial<BioPageTheme>) {
    setTheme((t) => ({ ...t, ...patch }));
    setThemeDirty(true);
  }

  function handleAdd(type: BioBlockType) {
    if (type === "divider") {
      addBlock.mutate({ templatePageId: pageId, type: "divider" });
    } else {
      setAdding(type);
    }
  }

  const previewModel: BioRenderModel = {
    title: page.title,
    description: page.description,
    avatarUrl: page.avatarUrl,
    theme,
    removeBranding: page.removeBranding ?? false,
    blocks: page.blocks.filter((b) => b.isVisible).map(toRenderBlock),
  };

  return (
    <>
      <TemplateEditorShell
        page={page}
        plan={plan}
        onChanged={refresh}
        save={{
          onSave: () => saveTheme.mutate({ id: pageId, theme }),
          dirty: themeDirty,
          saving: saveTheme.isLoading,
        }}
        preview={<BioRenderer model={previewModel} />}
        content={
          <EditorCard
            title="Blocks"
            description="Links, text and socials, in the order they appear on your page."
          >
            <div className="space-y-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="w-full">
                    <IconPlus size={16} className="mr-1.5" /> Add block
                    <IconChevronDown size={14} className="ml-1.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-[var(--radix-dropdown-menu-trigger-width)]"
                >
                  {ADD_OPTIONS.map((opt) => (
                    <DropdownMenuItem key={opt.type} onSelect={() => handleAdd(opt.type)}>
                      <opt.icon size={16} className="mr-2 text-neutral-500" />
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <BlockList
                pageId={pageId}
                blocks={page.blocks}
                onChanged={refresh}
                canSchedule={plan === "ultra"}
              />
            </div>
          </EditorCard>
        }
        design={
          <BioDesignPanel definition={definition} theme={theme} plan={plan} onChange={patchTheme} />
        }
      />

      {adding && (
        <BlockFormDialog
          pageId={pageId}
          mode="add"
          type={adding}
          open={adding !== null}
          onOpenChange={(o) => !o && setAdding(null)}
          onSaved={refresh}
          canSchedule={plan === "ultra"}
        />
      )}
    </>
  );
}
