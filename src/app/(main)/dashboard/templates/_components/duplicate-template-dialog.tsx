"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAppBaseDomain } from "@/lib/constants/domains";
import {
  DEFAULT_TEMPLATE_PATH_PREFIX,
  type TemplatePathPrefix,
  templatePageDisplayUrl,
} from "@/lib/templates/page-url";
import { templateEditorPath } from "@/lib/templates/registry";
import { api } from "@/trpc/react";

import { PathPrefixSelect, toPathPrefix } from "./path-prefix-select";

const MIN_SLUG_LENGTH = 3;
const MAX_SLUG_LENGTH = 100;
// Radix Select forbids empty-string item values, so use a sentinel for "no domain".
const PLATFORM = "__platform__";

export type DuplicateSource = {
  id: number;
  slug: string;
  displayTitle?: string | null;
  shareDomain: string | null;
  pathPrefix: string;
};

/**
 * Copy a page under a new handle — the quick way to make the next product page
 * from an existing one. The copy keeps content, design, SEO and QR design,
 * starts as a draft, and opens in the editor.
 */
export function DuplicateTemplateDialog({
  source,
  open,
  onOpenChange,
  hasUnsavedChanges = false,
}: {
  source: DuplicateSource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasUnsavedChanges?: boolean;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [shareDomain, setShareDomain] = useState(source.shareDomain ?? "");
  const [pathPrefix, setPathPrefix] = useState<TemplatePathPrefix>(toPathPrefix(source.pathPrefix));

  const { data: domains } = api.customDomain.list.useQuery(undefined, { enabled: open });
  const domainOptions = (domains ?? [])
    .filter((d) => d.status === "active" && d.domain)
    .map((d) => d.domain!);
  // The source's domain stays selectable while the list loads (or if it lapsed;
  // the server re-checks it either way).
  if (shareDomain && !domainOptions.includes(shareDomain)) {
    domainOptions.unshift(shareDomain);
  }

  const duplicate = api.templatePage.duplicate.useMutation({
    onSuccess: (res) => {
      toast.success("Page duplicated. It starts as a draft.");
      onOpenChange(false);
      router.push(templateEditorPath(res.id));
    },
    onError: (error) => toast.error(error.message),
  });

  // Mirror the server's slug constraint so a bad handle never round-trips.
  const normalizedSlug = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  const effectivePrefix = shareDomain ? pathPrefix : DEFAULT_TEMPLATE_PATH_PREFIX;
  const canSubmit =
    normalizedSlug.length >= MIN_SLUG_LENGTH &&
    normalizedSlug.length <= MAX_SLUG_LENGTH &&
    !duplicate.isLoading;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSlug("");
      setShareDomain(source.shareDomain ?? "");
      setPathPrefix(toPathPrefix(source.pathPrefix));
    }
    onOpenChange(next);
  }

  function submit() {
    if (!canSubmit) return;
    duplicate.mutate({
      id: source.id,
      slug: normalizedSlug,
      shareDomain: shareDomain || null,
      pathPrefix: effectivePrefix,
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate page</DialogTitle>
          <DialogDescription>
            Copies the content, design, SEO and QR design of{" "}
            <span className="font-medium">{source.displayTitle || `/${source.slug}`}</span> into a
            new draft page. The handle is fixed once the page exists.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="duplicate-slug">New handle</Label>
            <input
              id="duplicate-slug"
              value={normalizedSlug}
              onChange={(e) => setSlug(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="e.g. 5f8d0d55b54764421b7156c9"
              maxLength={MAX_SLUG_LENGTH}
              className="flex h-9 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-900 shadow-sm outline-none transition-colors placeholder:font-normal placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-border dark:bg-card dark:text-foreground dark:shadow-none"
              // biome-ignore lint/a11y/noAutofocus: the handle is the only required field.
              autoFocus
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="duplicate-domain">Domain</Label>
              <Select
                value={shareDomain || PLATFORM}
                onValueChange={(v) => {
                  const next = v === PLATFORM ? "" : v;
                  setShareDomain(next);
                  // The platform domain only serves /p/<handle>.
                  if (!next) setPathPrefix(DEFAULT_TEMPLATE_PATH_PREFIX);
                }}
              >
                <SelectTrigger id="duplicate-domain">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PLATFORM}>{getAppBaseDomain()} (default)</SelectItem>
                  {domainOptions.map((domain) => (
                    <SelectItem key={domain} value={domain}>
                      {domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:w-44">
              <Label htmlFor="duplicate-path">Path</Label>
              <PathPrefixSelect
                id="duplicate-path"
                value={pathPrefix}
                onChange={setPathPrefix}
                hasCustomDomain={Boolean(shareDomain)}
              />
            </div>
          </div>

          <div className="rounded-lg bg-neutral-50 px-3 py-2.5 dark:bg-muted/50">
            <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              New page URL
            </p>
            <p className="mt-0.5 break-all font-mono text-[12px] text-neutral-700 dark:text-neutral-300">
              {templatePageDisplayUrl({
                slug: normalizedSlug || "your-handle",
                shareDomain: shareDomain || null,
                pathPrefix: effectivePrefix,
              })}
            </p>
          </div>

          {hasUnsavedChanges && (
            <p className="text-[12px] text-amber-600 dark:text-amber-400">
              This page has unsaved changes. The copy is made from the last saved version.
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {duplicate.isLoading ? "Duplicating…" : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
