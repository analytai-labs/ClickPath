import { TemplatePageViewBeacon } from "@/components/templates/view-beacon";

import { type BioRenderBlock, type BioRenderModel, BioRenderer } from "./bio-renderer";

import type { PublicTemplatePage, PublicTemplatePageProps } from "@/components/templates/types";

function toRenderModel(page: PublicTemplatePage): BioRenderModel {
  return {
    title: page.title,
    description: page.description,
    avatarUrl: page.avatarUrl,
    theme: page.theme,
    removeBranding: page.removeBranding,
    blocks: page.blocks.map((b): BioRenderBlock => {
      switch (b.type) {
        case "link":
          return { id: b.id, type: "link", title: b.title, href: b.href };
        case "email":
          return { id: b.id, type: "email", title: b.title, href: b.href };
        case "social":
          return { id: b.id, type: "social", socials: b.socials };
        case "heading":
          return { id: b.id, type: "heading", title: b.title };
        case "text":
          return { id: b.id, type: "text", content: b.content };
        default:
          return { id: b.id, type: "divider" };
      }
    }),
  };
}

/** Shared public bio page render, used by /p/[slug] and the custom-domain root. */
export function PublicBioView({ page }: PublicTemplatePageProps) {
  return (
    <main className="min-h-[100dvh]">
      <BioRenderer model={toRenderModel(page)} heightClass="min-h-[100dvh]" />
      <TemplatePageViewBeacon templatePageId={page.id} />
    </main>
  );
}
