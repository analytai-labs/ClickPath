"use client";

import { IconLock } from "@tabler/icons-react";
import { Link } from "next-view-transitions";
import { useState } from "react";
import { toast } from "sonner";

import { AssetField } from "@/components/assets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getAppBaseDomain } from "@/lib/constants/domains";
import { templatePageDisplayUrl } from "@/lib/templates/page-url";
import { getTemplateDefinition } from "@/lib/templates/registry";
import { api } from "@/trpc/react";

import { EditorCard, Field, SettingRow } from "./editor-ui";

import type { Plan } from "@/lib/billing/plans";
import type { TemplatePageData } from "./editor-types";

// Radix Select forbids empty-string item values, so use a sentinel for "no domain".
const NO_DOMAIN = "__none__";

type Draft = {
  slug: string;
  title: string;
  description: string;
  avatarUrl: string | null;
  socialImageUrl: string | null;
  seoTitle: string;
  seoDescription: string;
  /** Domain the public URL is built from. "" = platform domain. */
  shareDomain: string;
  /** Whether that domain's root should also serve this page. */
  serveAtRoot: boolean;
  removeBranding: boolean;
};

function toDraft(page: TemplatePageData): Draft {
  return {
    slug: page.slug,
    title: page.title ?? "",
    description: page.description ?? "",
    avatarUrl: page.avatarUrl ?? null,
    socialImageUrl: page.socialImageUrl ?? null,
    seoTitle: page.seoTitle ?? "",
    seoDescription: page.seoDescription ?? "",
    shareDomain: page.shareDomain ?? "",
    serveAtRoot: Boolean(page.customDomain),
    removeBranding: page.removeBranding ?? false,
  };
}

/**
 * Page-level settings — handle, metadata, domain, SEO and branding. These are
 * template-agnostic, so every template gets the same Settings tab; only the
 * avatar field is conditional on the template actually rendering one.
 */
export function PageSettingsPanel({
  page,
  plan,
  onSaved,
}: {
  page: TemplatePageData;
  plan: Plan;
  onSaved: () => void;
}) {
  const definition = getTemplateDefinition(page.templateType);
  const isPaid = plan !== "free";

  const [draft, setDraft] = useState<Draft>(() => toDraft(page));

  // Only verified domains in this workspace can serve a page (the server
  // enforces this on save), so offer exactly those instead of a free-text field.
  const { data: domains } = api.customDomain.list.useQuery(undefined, { enabled: isPaid });
  const domainOptions = (domains ?? [])
    .filter((d) => d.status === "active" && d.domain)
    .map((d) => d.domain!);
  // Keep an already-saved domain selectable even if it's no longer listed/active.
  if (draft.shareDomain && !domainOptions.includes(draft.shareDomain)) {
    domainOptions.unshift(draft.shareDomain);
  }

  const save = api.templatePage.update.useMutation({
    onSuccess: () => {
      toast.success("Settings saved.");
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  function patch(next: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  function handleSave() {
    save.mutate({
      id: page.id,
      slug: draft.slug,
      title: draft.title.trim() || null,
      description: draft.description.trim() || null,
      avatarUrl: definition.usesAvatar ? draft.avatarUrl : undefined,
      socialImageUrl: draft.socialImageUrl,
      seoTitle: draft.seoTitle.trim() || null,
      seoDescription: draft.seoDescription.trim() || null,
      shareDomain: draft.shareDomain.trim() || null,
      // The root binding only exists on the page's own public domain.
      customDomain: draft.serveAtRoot ? draft.shareDomain.trim() || null : null,
      removeBranding: draft.removeBranding,
    });
  }

  return (
    <>
      <EditorCard title="Page" description="How this page is addressed and described.">
        <div className="space-y-4">
          <Field label="Handle" htmlFor="settings-slug">
            <div className="flex h-9 items-center overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-colors focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-border dark:bg-card dark:shadow-none">
              <span className="flex h-full select-none items-center border-r border-gray-200 bg-gray-50 px-3 text-[13px] text-gray-500 dark:border-border dark:bg-muted dark:text-gray-400">
                /p/
              </span>
              <input
                id="settings-slug"
                value={draft.slug}
                onChange={(e) =>
                  patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-") })
                }
                className="h-full flex-1 bg-transparent px-3 text-sm font-medium text-gray-900 outline-none placeholder:text-gray-500 dark:text-foreground dark:placeholder:text-gray-400"
              />
            </div>
          </Field>

          <Field label="Title" htmlFor="settings-title">
            <Input
              id="settings-title"
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder={definition.usesAvatar ? "Jane Doe" : "Shown in listings and search"}
            />
          </Field>

          <Field label="Description" htmlFor="settings-description">
            <Textarea
              id="settings-description"
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="A short summary of this page."
              rows={3}
            />
          </Field>

          {definition.usesAvatar && (
            <Field label="Avatar">
              <AssetField
                value={draft.avatarUrl}
                onChange={(url) => patch({ avatarUrl: url })}
                label="Avatar"
              />
            </Field>
          )}
        </div>
      </EditorCard>

      <EditorCard title="Sharing" description="How this page looks in search results and previews.">
        <div className="space-y-4">
          <Field
            label="SEO title"
            htmlFor="settings-seo-title"
            hint="Overrides the page title in the browser tab and search results."
          >
            <Input
              id="settings-seo-title"
              value={draft.seoTitle}
              onChange={(e) => patch({ seoTitle: e.target.value })}
              placeholder={page.displayTitle ?? `@${draft.slug}`}
            />
          </Field>

          <Field label="SEO description" htmlFor="settings-seo-description">
            <Textarea
              id="settings-seo-description"
              value={draft.seoDescription}
              onChange={(e) => patch({ seoDescription: e.target.value })}
              placeholder="Shown under the title in search results and link previews."
              rows={2}
            />
          </Field>

          <Field
            label="Social preview image"
            hint={
              isPaid
                ? "Replaces the generated share card. 1200×630 works best."
                : "Available on Pro and Ultra plans."
            }
          >
            {isPaid ? (
              <AssetField
                value={draft.socialImageUrl}
                onChange={(url) => patch({ socialImageUrl: url })}
                label="Social preview image"
                aspect="wide"
              />
            ) : (
              <p className="text-[13px] text-neutral-400 dark:text-neutral-500">
                Upgrade to set your own share card.
              </p>
            )}
          </Field>
        </div>
      </EditorCard>

      <EditorCard
        title="Public domain"
        description="Where this page is served, and what its QR code encodes."
      >
        <div className="space-y-5">
          <Field
            label="Domain"
            hint={
              isPaid && domainOptions.length > 0
                ? "Every verified domain in this workspace serves all of its pages at /p/<handle>, so your pages and printed QR codes don't depend on the ClickPath domain."
                : undefined
            }
          >
            {!isPaid ? (
              <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <IconLock size={13} className="text-amber-500" />
                Custom domains are available on Pro and Ultra plans.
              </p>
            ) : domainOptions.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                No verified domains yet.{" "}
                <Link
                  href="/dashboard/domains"
                  className="font-medium text-blue-600 hover:underline"
                >
                  Add and verify a domain
                </Link>{" "}
                to serve this page from it.
              </p>
            ) : (
              <Select
                value={draft.shareDomain || NO_DOMAIN}
                onValueChange={(v) =>
                  patch({
                    shareDomain: v === NO_DOMAIN ? "" : v,
                    // A root binding cannot outlive the domain it belongs to.
                    serveAtRoot: v === NO_DOMAIN ? false : draft.serveAtRoot,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a domain" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DOMAIN}>{getAppBaseDomain()} (default)</SelectItem>
                  {domainOptions.map((domain) => (
                    <SelectItem key={domain} value={domain}>
                      {domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <div className="rounded-lg bg-neutral-50 px-3 py-2.5 dark:bg-muted/50">
            <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Public URL
            </p>
            <p className="mt-0.5 break-all font-mono text-[12px] text-neutral-700 dark:text-neutral-300">
              {templatePageDisplayUrl({
                slug: draft.slug || "your-handle",
                shareDomain: draft.shareDomain || null,
                customDomain: draft.serveAtRoot ? draft.shareDomain || null : null,
              })}
            </p>
          </div>

          <SettingRow
            label="Also serve at the domain root"
            hint={
              draft.shareDomain
                ? `${draft.shareDomain}/ will show this page. Only one page per domain can do this.`
                : "Pick a domain above to enable this."
            }
          >
            <Switch
              checked={draft.serveAtRoot}
              disabled={!isPaid || !draft.shareDomain}
              onCheckedChange={(checked) => patch({ serveAtRoot: checked })}
            />
          </SettingRow>
        </div>
      </EditorCard>

      <EditorCard title="Advanced">
        <div className="space-y-5">
          <SettingRow
            label={
              <>
                Remove &quot;Made with ClickPath&quot;
                {!isPaid && <IconLock size={13} className="text-amber-500" />}
              </>
            }
            hint="Hides the footer badge on the published page."
          >
            <Switch
              checked={draft.removeBranding}
              disabled={!isPaid}
              onCheckedChange={(checked) => patch({ removeBranding: checked })}
            />
          </SettingRow>
        </div>
      </EditorCard>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={save.isLoading}>
          {save.isLoading ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </>
  );
}
