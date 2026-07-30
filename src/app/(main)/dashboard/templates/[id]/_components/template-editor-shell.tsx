"use client";

import {
  IconArrowLeft,
  IconChartBar,
  IconExternalLink,
  IconPalette,
  IconPencil,
  IconQrcode,
  IconSettings,
} from "@tabler/icons-react";
import { Link } from "next-view-transitions";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  templatePageDisplayUrl,
  templatePagePreviewPath,
  templatePageUrl,
} from "@/lib/templates/page-url";
import { getTemplateDefinition } from "@/lib/templates/registry";
import { api } from "@/trpc/react";

import { AnalyticsPanel } from "./analytics-panel";
import { CopyUrlButton } from "./copy-url-button";
import { PageSettingsPanel, usePageSettings } from "./page-settings-panel";
import { QrPanel, QrPreviewRail, useQrDesign } from "./qr-panel";
import { SharePreviewCard } from "./share-preview-card";

import type { Plan } from "@/lib/billing/plans";
import type { TemplatePageData } from "./editor-types";

/** Shared entrance animation + width for every editor tab body. */
const TAB_BODY =
  "mt-4 space-y-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-both motion-safe:duration-300";
const NARROW_TAB_BODY = `${TAB_BODY} max-w-2xl`;

type TabId = "content" | "design" | "qr" | "settings" | "analytics";

type Props = {
  page: TemplatePageData;
  plan: Plan;
  /** Content tab body — the template's own editor. */
  content: React.ReactNode;
  /** Design tab body — usually a `<VariantPicker>` plus template-specific controls. */
  design: React.ReactNode;
  /** Live preview, rendered inside the phone frame. */
  preview: React.ReactNode;
  /** Header Save. Omit for templates that persist every change immediately. */
  save?: { onSave: () => void; dirty: boolean; saving: boolean };
  onChanged: () => void;
};

/**
 * Chrome shared by every template editor: header, publish toggle, the Settings
 * and Analytics tabs, and the phone preview. Templates supply only the Content
 * and Design bodies, so a new template inherits all of this for free.
 */
export function TemplateEditorShell({
  page,
  plan,
  content,
  design,
  preview,
  save,
  onChanged,
}: Props) {
  const definition = getTemplateDefinition(page.templateType);
  // Preview links stay same-origin (a customer domain may not point here yet),
  // but everything the user copies or prints uses the canonical URL.
  const previewPath = templatePagePreviewPath(page);

  const [tab, setTab] = useState<TabId>("content");

  // The shell owns the state for the tabs it renders itself, so an unsaved QR
  // design or half-filled settings form survives switching tabs — and so the
  // right rail can preview the same unsaved values the form is editing.
  const qr = useQrDesign(page, onChanged);
  const settings = usePageSettings(page, onChanged);

  const togglePublished = api.templatePage.togglePublished.useMutation({
    onSuccess: (res) => {
      toast.success(res.isPublished ? "Your page is live." : "Your page is now a draft.");
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/dashboard/templates"
            aria-label="Back to templates"
            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-muted"
          >
            <IconArrowLeft size={18} />
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold tracking-tight text-neutral-900 dark:text-foreground">
                {page.displayTitle || `/${page.slug}`}
              </h2>
              <Badge variant="outline" className="text-[10px]">
                {definition.label}
              </Badge>
              {page.isPublished ? (
                <Badge
                  variant="secondary"
                  className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                >
                  Live
                </Badge>
              ) : (
                <Badge variant="secondary">Draft</Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <p className="truncate text-[12px] text-neutral-400 dark:text-neutral-500">
                {templatePageDisplayUrl(page)}
              </p>
              <CopyUrlButton url={templatePageUrl(page)} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {page.isPublished && (
            <a
              href={previewPath}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[13px] text-neutral-500 hover:text-neutral-800 dark:hover:text-foreground"
            >
              View <IconExternalLink size={14} />
            </a>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-neutral-500">Published</span>
            <Switch
              checked={page.isPublished ?? false}
              disabled={togglePublished.isLoading}
              onCheckedChange={(checked) =>
                togglePublished.mutate({ id: page.id, isPublished: checked })
              }
            />
          </div>
          {save && (
            <Button onClick={save.onSave} disabled={!save.dirty || save.saving} className="h-9">
              {save.saving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* Editor — takes the remaining width; the preview is a sticky right rail. */}
        <div className="min-w-0 flex-1">
          <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
            <TabsList>
              <TabsTrigger value="content" className="gap-1.5">
                <IconPencil size={15} stroke={1.5} /> Content
              </TabsTrigger>
              <TabsTrigger value="design" className="gap-1.5">
                <IconPalette size={15} stroke={1.5} /> Design
              </TabsTrigger>
              <TabsTrigger value="qr" className="gap-1.5">
                <IconQrcode size={15} stroke={1.5} /> QR code
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-1.5">
                <IconSettings size={15} stroke={1.5} /> Settings
              </TabsTrigger>
              <TabsTrigger value="analytics" className="gap-1.5">
                <IconChartBar size={15} stroke={1.5} /> Analytics
              </TabsTrigger>
            </TabsList>

            <TabsContent value="content" className={NARROW_TAB_BODY}>
              {content}
            </TabsContent>

            <TabsContent value="design" className={NARROW_TAB_BODY}>
              {design}
            </TabsContent>

            <TabsContent value="qr" className={NARROW_TAB_BODY}>
              <QrPanel page={page} state={qr} />
            </TabsContent>

            <TabsContent value="settings" className={NARROW_TAB_BODY}>
              <PageSettingsPanel page={page} plan={plan} state={settings} />
            </TabsContent>

            {/* Analytics gets the whole width — there is nothing to preview. */}
            <TabsContent value="analytics" className={TAB_BODY}>
              <AnalyticsPanel page={page} plan={plan} />
            </TabsContent>
          </Tabs>
        </div>

        {tab !== "analytics" && (
          <div className="shrink-0 lg:sticky lg:top-6 lg:w-[360px]">
            {tab === "qr" ? (
              <QrPreviewRail state={qr} />
            ) : tab === "settings" ? (
              <SharePreviewCard page={page} draft={settings.draft} />
            ) : (
              <PreviewFrame>{preview}</PreviewFrame>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Phone frame around the live preview. Scrolls internally, never the page. */
function PreviewFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[360px]">
      <div className="overflow-hidden rounded-[2rem] border-[6px] border-neutral-800 bg-white shadow-xl dark:border-neutral-700">
        <div className="h-[640px] overflow-y-auto overscroll-contain">{children}</div>
      </div>
      <p className="mt-2 text-center text-[11px] text-neutral-400 dark:text-neutral-500">
        Live preview
      </p>
    </div>
  );
}
