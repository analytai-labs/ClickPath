"use client";

import {
  IconChevronRight,
  IconFolder,
  IconFolderPlus,
  IconLoader2,
  IconPhoto,
  IconSearch,
  IconUpload,
} from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

import { ACCEPTED_IMAGE_TYPES, readImageFile, useAssetUpload } from "./use-asset-upload";

import type { RouterOutputs } from "@/trpc/shared";

type Folder = RouterOutputs["asset"]["listFolders"][number];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen image's URL. */
  onSelect: (url: string) => void;
  /** Highlighted as already chosen. */
  selectedUrl?: string | null;
  title?: string;
  description?: string;
  /** Whether this workspace may save and organize assets. */
  canSave?: boolean;
};

/**
 * Browse the workspace's saved images.
 *
 * Folders are fetched once as a flat list and the tree is derived here, so
 * walking into a folder is instant and never round-trips for the sidebar.
 */
export function AssetBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  selectedUrl,
  title = "Choose an image",
  description = "Pick one of your saved images, or upload a new one.",
  canSave = true,
}: Props) {
  const [folderId, setFolderId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), 250);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = api.useUtils();

  const foldersQuery = api.asset.listFolders.useQuery(undefined, { enabled: open });
  const assetsQuery = api.asset.list.useQuery(
    { folderId, search: debouncedSearch || undefined, deleted: false, limit: 120 },
    { enabled: open },
  );

  const { upload, uploading } = useAssetUpload();

  const folders = foldersQuery.data ?? [];
  const childFolders = useMemo(
    () => folders.filter((f) => (f.parentId ?? null) === folderId),
    [folders, folderId],
  );
  const trail = useMemo(() => folderTrail(folders, folderId), [folders, folderId]);

  const createFolder = api.asset.createFolder.useMutation({
    onSuccess: () => {
      void utils.asset.listFolders.invalidate();
      setCreatingFolder(false);
      setNewFolderName("");
    },
  });

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const pending = await readImageFile(file);
    if (!pending) return;

    const asset = await upload({
      image: pending.dataUrl,
      name: pending.name,
      folderId,
      save: canSave,
    });
    if (asset) choose(asset.url);
  }

  /**
   * Close first, then hand the choice up.
   *
   * The consumer's state update re-renders this dialog's owner, so closing
   * afterwards can be lost in that render; closing first makes dismissal
   * independent of whatever the consumer does with the URL.
   */
  function choose(url: string) {
    onOpenChange(false);
    onSelect(url);
  }

  const isSearching = debouncedSearch.length > 0;
  const assets = assetsQuery.data ?? [];
  const loading = assetsQuery.isLoading || foldersQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* Search + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <IconSearch
                size={15}
                stroke={1.5}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your images"
                className="h-9 pl-8 text-[13px]"
              />
            </div>
            {canSave && !isSearching && (
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-1.5 text-[13px]"
                onClick={() => setCreatingFolder((v) => !v)}
              >
                <IconFolderPlus size={15} stroke={1.5} /> Folder
              </Button>
            )}
            <Button
              type="button"
              className="h-9 gap-1.5 text-[13px]"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <IconLoader2 size={15} className="animate-spin" />
              ) : (
                <IconUpload size={15} stroke={1.5} />
              )}
              Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              className="sr-only"
              aria-label="Upload an image"
              onChange={(e) => {
                void handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          {creatingFolder && (
            <div className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-border">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name — e.g. Clients"
                className="h-8 text-[13px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFolderName.trim()) {
                    createFolder.mutate({ name: newFolderName.trim(), parentId: folderId });
                  }
                  if (e.key === "Escape") setCreatingFolder(false);
                }}
              />
              <Button
                type="button"
                className="h-8 text-[12px]"
                disabled={!newFolderName.trim() || createFolder.isLoading}
                onClick={() =>
                  createFolder.mutate({ name: newFolderName.trim(), parentId: folderId })
                }
              >
                Create
              </Button>
            </div>
          )}

          {/* Breadcrumb */}
          {!isSearching && (
            <div className="flex flex-wrap items-center gap-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
              <button
                type="button"
                onClick={() => setFolderId(null)}
                className={cn(
                  "rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-muted",
                  folderId === null && "font-medium text-neutral-900 dark:text-foreground",
                )}
              >
                All images
              </button>
              {trail.map((folder, i) => (
                <span key={folder.id} className="flex items-center gap-0.5">
                  <IconChevronRight size={13} stroke={1.5} className="text-neutral-300" />
                  <button
                    type="button"
                    onClick={() => setFolderId(folder.id)}
                    className={cn(
                      "rounded px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-muted",
                      i === trail.length - 1 && "font-medium text-neutral-900 dark:text-foreground",
                    )}
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Contents */}
          <div className="max-h-[340px] min-h-[180px] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 p-3 dark:border-border">
            {loading ? (
              <div className="flex h-[150px] items-center justify-center">
                <IconLoader2 className="h-5 w-5 animate-spin text-neutral-400" />
              </div>
            ) : (
              <div className="space-y-3">
                {!isSearching && childFolders.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {childFolders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => setFolderId(folder.id)}
                        className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-left text-[13px] transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-border dark:hover:bg-muted"
                      >
                        <IconFolder size={16} stroke={1.5} className="shrink-0 text-neutral-400" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {assets.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {assets.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        title={asset.name}
                        onClick={() => choose(asset.url)}
                        className={cn(
                          "group relative aspect-square overflow-hidden rounded-lg border-2 bg-neutral-50 transition-all hover:border-blue-400 dark:bg-muted",
                          selectedUrl === asset.url
                            ? "border-blue-600 ring-2 ring-blue-600/20"
                            : "border-transparent",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.url}
                          alt={asset.name}
                          className="h-full w-full object-contain p-1.5"
                        />
                        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-left text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                          {asset.name}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  childFolders.length === 0 && (
                    <EmptyState
                      isSearching={isSearching}
                      canSave={canSave}
                      onUpload={() => fileRef.current?.click()}
                    />
                  )
                )}
              </div>
            )}
          </div>

          {!canSave && (
            <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
              Uploads work on every plan. Saving images for reuse is available on Pro and Ultra.
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  isSearching,
  canSave,
  onUpload,
}: {
  isSearching: boolean;
  canSave: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-muted">
        <IconPhoto size={20} stroke={1.5} />
      </span>
      <p className="mt-3 text-[13px] text-neutral-500 dark:text-neutral-400">
        {isSearching ? "No images match that search." : "Nothing here yet."}
      </p>
      {!isSearching && (
        <button
          type="button"
          onClick={onUpload}
          className="mt-1 text-[12px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          {canSave ? "Upload your first image" : "Upload an image"}
        </button>
      )}
    </div>
  );
}

/** The chain of folders from the root down to `folderId`. */
function folderTrail(folders: Folder[], folderId: number | null): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const trail: Folder[] = [];
  let current = folderId === null ? undefined : byId.get(folderId);

  // Bounded by the server's nesting cap; the guard is against a cyclic payload.
  while (current && trail.length < 10) {
    trail.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return trail;
}
