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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAppBaseDomain } from "@/lib/constants/domains";
import { templateEditorPath } from "@/lib/templates/registry";
import { api } from "@/trpc/react";

import type { AnyTemplateDefinition } from "@/lib/templates/registry";

const MIN_SLUG_LENGTH = 3;
const MAX_SLUG_LENGTH = 100;

/**
 * One create dialog for every template — the definition supplies the copy, so
 * a new template needs no dialog of its own.
 */
export function CreateTemplateDialog({
  definition,
  open,
  onOpenChange,
}: {
  definition: AnyTemplateDefinition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");

  // The page is created on the workspace's default domain, so preview that host
  // rather than the platform's — otherwise the dialog shows a URL that is wrong
  // the moment the page exists.
  const defaultDomainQuery = api.link.defaultDomain.useQuery(undefined, { enabled: open });
  const defaultDomain = defaultDomainQuery.data?.domain ?? getAppBaseDomain();

  const create = api.templatePage.create.useMutation({
    onSuccess: (res) => {
      toast.success("Page created.");
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
  const canCreate =
    !!definition &&
    normalizedSlug.length >= MIN_SLUG_LENGTH &&
    normalizedSlug.length <= MAX_SLUG_LENGTH &&
    !create.isLoading;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSlug("");
      setTitle("");
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open && !!definition} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {definition?.label.toLowerCase() ?? "template"} page</DialogTitle>
          <DialogDescription>
            {definition?.description} Choose the handle carefully — it is fixed once the page
            exists, because printed QR codes and shared links point at it.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="template-slug">Handle</Label>
            <div className="flex h-9 items-center overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-colors focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-border dark:bg-card dark:shadow-none">
              <span className="flex h-full select-none items-center border-r border-gray-200 bg-gray-50 px-3 text-[13px] text-gray-500 dark:border-border dark:bg-muted dark:text-gray-400">
                {defaultDomain}/p/
              </span>
              <input
                id="template-slug"
                value={normalizedSlug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="your-handle"
                maxLength={MAX_SLUG_LENGTH}
                className="h-full flex-1 bg-transparent px-3 text-sm font-medium text-gray-900 outline-none placeholder:text-gray-500 dark:text-foreground dark:placeholder:text-gray-400"
                // biome-ignore lint/a11y/noAutofocus: the handle is the only required field.
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="template-title">Title (optional)</Label>
            <Input
              id="template-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Shown in your dashboard and in link previews"
            />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            onClick={() =>
              definition &&
              create.mutate({
                slug: normalizedSlug,
                title: title.trim() || undefined,
                templateType: definition.id,
              })
            }
            disabled={!canCreate}
          >
            {create.isLoading ? "Creating…" : "Create page"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
