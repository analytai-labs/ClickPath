"use client";

import { IconLock, IconWand } from "@tabler/icons-react";
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
import { resolveShareMetadata } from "@/lib/templates/share-metadata";
import { api } from "@/trpc/react";

import { EditorCard, Field, SettingRow } from "./editor-ui";

import type { Plan } from "@/lib/billing/plans";
import type { TemplatePageData } from "./editor-types";

// Radix Select forbids empty-string item values, so use a sentinel for "no domain".
const NO_DOMAIN = "__none__";

export type SettingsDraft = {
  slug: string;
  title: string;
  description: string;
  avatarUrl: string | null;
  socialImageUrl: string | null;
  seoTitle: string;
  seoDescription: string;
  /** When true the SEO title follows the page content instead of an override. */
  autoSeoTitle: boolean;
  autoSeoDescription: boolean;
  /** Domain the public URL is built from. "" = platform domain. */
  shareDomain: string;
  /** Whether that domain's root should also serve this page. */
  serveAtRoot: boolean;
  removeBranding: boolean;
};

function toDraft(page: TemplatePageData): SettingsDraft {
  return {
    slug: page.slug,
    title: page.title ?? "",
    description: page.description ?? "",
    avatarUrl: page.avatarUrl ?? null,
    socialImageUrl: page.socialImageUrl ?? null,
    seoTitle: page.seoTitle ?? "",
    seoDescription: page.seoDescription ?? "",
    // A stored null means "follow the content" — see `resolveShareMetadata`.
    autoSeoTitle: !page.seoTitle,
    autoSeoDescription: !page.seoDescription,
    shareDomain: page.shareDomain ?? "",
    serveAtRoot: Boolean(page.customDomain),
    removeBranding: page.removeBranding ?? false,
  };
}

export type PageSettingsState = ReturnType<typeof usePageSettings>;

/**
 * The Settings tab's form state, owned by the editor shell rather than by the
 * panel. Lifting it means a trip to another tab can't discard half-filled
 * settings, and the share preview in the right rail can read the same unsaved
 * draft the form is editing.
 */
export function usePageSettings(page: TemplatePageData, onSaved: () => void) {
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(page));

  const save = api.templatePage.update.useMutation({
    onSuccess: () => {
      toast.success("Settings saved.");
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const definition = getTemplateDefinition(page.templateType);

  function patch(next: Partial<SettingsDraft>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  function submit() {
    save.mutate({
      id: page.id,
      title: draft.title.trim() || null,
      description: draft.description.trim() || null,
      avatarUrl: definition.usesAvatar ? draft.avatarUrl : undefined,
      socialImageUrl: draft.socialImageUrl,
      // Null hands the field back to the content, which is exactly what the
      // "follow the page content" switch promises.
      seoTitle: draft.autoSeoTitle ? null : draft.seoTitle.trim() || null,
      seoDescription: draft.autoSeoDescription ? null : draft.seoDescription.trim() || null,
      shareDomain: draft.shareDomain.trim() || null,
      // The root binding only exists on the page's own public domain.
      customDomain: draft.serveAtRoot ? draft.shareDomain.trim() || null : null,
      removeBranding: draft.removeBranding,
    });
  }

  return { draft, patch, submit, saving: save.isLoading };
}

/**
 * Page-level settings — metadata, domain, SEO and branding. These are
 * template-agnostic, so every template gets the same Settings tab; only the
 * avatar field is conditional on the template actually rendering one.
 */
export function PageSettingsPanel({
  page,
  plan,
  state,
}: {
  page: TemplatePageData;
  plan: Plan;
  state: PageSettingsState;
}) {
  const { draft, patch, submit, saving } = state;
  const definition = getTemplateDefinition(page.templateType);
  const isPaid = plan !== "free";

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

  // The values a share would use right now, so the "auto" fields can show the
  // real thing instead of a placeholder.
  const share = resolveShareMetadata({
    slug: draft.slug || page.slug,
    title: draft.title.trim() || null,
    description: draft.description.trim() || null,
    seoTitle: null,
    seoDescription: null,
    templateType: page.templateType,
    templateData: page.templateData,
  });

  return (
    <>
      <EditorCard title="Page" description="How this page is addressed and described.">
        <div className="space-y-4">
          <Field
            label="Handle"
            hint="Fixed once the page is created — printed QR codes and shared links depend on it."
          >
            <div className="flex h-9 items-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 shadow-sm dark:border-border dark:bg-muted/50 dark:shadow-none">
              <span className="flex h-full select-none items-center border-r border-gray-200 bg-gray-100 px-3 text-[13px] text-gray-500 dark:border-border dark:bg-muted dark:text-gray-400">
                /p/
              </span>
              <span className="flex h-full flex-1 items-center px-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                {page.slug}
              </span>
              <IconLock size={13} className="mr-3 shrink-0 text-gray-400" />
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

      <EditorCard
        title="Sharing"
        description="This is what people see when your link is shared — in chats, posts and search results. The preview on the right updates as you type."
      >
        <div className="space-y-5">
          <AutoField
            label="SEO title"
            htmlFor="settings-seo-title"
            auto={draft.autoSeoTitle}
            onAutoChange={(auto) => patch({ autoSeoTitle: auto })}
            autoValue={share.autoTitle}
            autoHint={`Follows this page's content — currently "${share.autoTitle}".`}
          >
            <Input
              id="settings-seo-title"
              value={draft.seoTitle}
              onChange={(e) => patch({ seoTitle: e.target.value })}
              placeholder={share.autoTitle}
            />
          </AutoField>

          <AutoField
            label="SEO description"
            htmlFor="settings-seo-description"
            auto={draft.autoSeoDescription}
            onAutoChange={(auto) => patch({ autoSeoDescription: auto })}
            autoValue={share.autoDescription ?? ""}
            autoHint={
              share.autoDescription
                ? "Follows this page's content."
                : "Nothing to follow yet — add a description above, or fill in the page content."
            }
          >
            <Textarea
              id="settings-seo-description"
              value={draft.seoDescription}
              onChange={(e) => patch({ seoDescription: e.target.value })}
              placeholder={share.autoDescription ?? "Shown under the title in previews."}
              rows={2}
            />
          </AutoField>

          <Field
            label="Social preview image"
            hint={
              isPaid
                ? "Replaces the generated share card above. 1200×630 works best."
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
        <Button onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </>
  );
}

/**
 * A field that either follows the page content or is overridden by hand.
 *
 * The auto value is shown in a disabled input rather than as placeholder text,
 * because a placeholder reads as "empty" and users retype what the page already
 * says — the whole point is that they don't have to.
 */
function AutoField({
  label,
  htmlFor,
  auto,
  onAutoChange,
  autoValue,
  autoHint,
  children,
}: {
  label: string;
  htmlFor: string;
  auto: boolean;
  onAutoChange: (auto: boolean) => void;
  autoValue: string;
  autoHint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={htmlFor}
          className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300"
        >
          {label}
        </label>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-500">
            <IconWand size={12} stroke={1.5} /> Auto
          </span>
          <Switch checked={auto} onCheckedChange={onAutoChange} />
        </div>
      </div>

      {auto ? (
        <Input
          id={htmlFor}
          value={autoValue}
          readOnly
          disabled
          placeholder="—"
          className="cursor-not-allowed"
        />
      ) : (
        children
      )}

      <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
        {auto ? autoHint : "Turn Auto back on to follow the page content again."}
      </p>
    </div>
  );
}
