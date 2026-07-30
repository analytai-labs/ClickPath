"use client";

import {
  IconArrowBackUp,
  IconChevronRight,
  IconDots,
  IconFolder,
  IconFolderPlus,
  IconLoader2,
  IconPencil,
  IconPhoto,
  IconSearch,
  IconTrash,
  IconTrashX,
  IconUpload,
} from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

import { ACCEPTED_IMAGE_TYPES, readImageFile, useAssetUpload } from "@/components/assets";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

import { AssetUsageDialog } from "./asset-usage-dialog";

import type { RouterOutputs } from "@/trpc/shared";

type Folder = RouterOutputs["asset"]["listFolders"][number];
type Asset = RouterOutputs["asset"]["list"][number];

export function AssetLibrary() {
  const [folderId, setFolderId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), 250);
  const [showTrash, setShowTrash] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = api.useUtils();
  const capabilities = api.asset.capabilities.useQuery();
  const foldersQuery = api.asset.listFolders.useQuery();
  const assetsQuery = api.asset.list.useQuery({
    folderId,
    search: debouncedSearch || undefined,
    deleted: showTrash,
    limit: 200,
  });

  const { upload, uploading } = useAssetUpload();

  const canSave = capabilities.data?.canSave ?? false;
  const folders = foldersQuery.data ?? [];
  const assets = assetsQuery.data ?? [];
  const isSearching = debouncedSearch.length > 0;

  const childFolders = useMemo(
    () => folders.filter((f) => (f.parentId ?? null) === folderId),
    [folders, folderId],
  );
  const trail = useMemo(() => folderTrail(folders, folderId), [folders, folderId]);

  function refresh() {
    void utils.asset.list.invalidate();
    void utils.asset.recent.invalidate();
    void utils.asset.listFolders.invalidate();
  }

  const createFolder = api.asset.createFolder.useMutation({
    onSuccess: () => {
      refresh();
      setCreatingFolder(false);
      setNewFolderName("");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateAsset = api.asset.update.useMutation({
    onSuccess: () => {
      refresh();
      setRenaming(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteAsset = api.asset.delete.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Removed from your assets. Anything using it keeps working.");
    },
    onError: (e) => toast.error(e.message),
  });

  const restoreAsset = api.asset.restore.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Restored.");
    },
    onError: (e) => toast.error(e.message),
  });

  const purgeAsset = api.asset.purge.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Deleted permanently.");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteFolder = api.asset.deleteFolder.useMutation({
    onSuccess: (res) => {
      refresh();
      toast.success(
        res.movedAssets + res.movedFolders > 0
          ? "Folder deleted — its contents moved up one level."
          : "Folder deleted.",
      );
    },
    onError: (e) => toast.error(e.message),
  });

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const read = await readImageFile(file);
      if (!read) continue;
      await upload({ image: read.dataUrl, name: read.name, folderId, save: true });
    }
    refresh();
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-foreground">
            Assets
          </h1>
          <p className="mt-1 text-[13px] text-neutral-400 dark:text-neutral-500">
            Logos and images you can reuse on any link, QR code or page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={showTrash ? "default" : "outline"}
            className="h-9 gap-1.5 text-[13px]"
            onClick={() => {
              setShowTrash((v) => !v);
              setFolderId(null);
            }}
          >
            <IconTrash size={15} stroke={1.5} /> {showTrash ? "Back to library" : "Trash"}
          </Button>
          {!showTrash && canSave && (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-1.5 text-[13px]"
                onClick={() => setCreatingFolder((v) => !v)}
              >
                <IconFolderPlus size={15} stroke={1.5} /> New folder
              </Button>
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
            </>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_TYPES}
        className="sr-only"
        aria-label="Upload images"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {!canSave && !capabilities.isLoading && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          Saving images for reuse is available on Pro and Ultra. You can still upload and use an
          image anywhere on your current plan — it just won't be kept here.
        </div>
      )}

      {creatingFolder && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-border">
          <Input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name — e.g. Clients"
            className="h-8 max-w-xs text-[13px]"
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
            onClick={() => createFolder.mutate({ name: newFolderName.trim(), parentId: folderId })}
          >
            Create
          </Button>
        </div>
      )}

      {/* Search + breadcrumb */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <IconSearch
            size={15}
            stroke={1.5}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets"
            className="h-9 pl-8 text-[13px]"
          />
        </div>

        {!isSearching && !showTrash && (
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
      </div>

      {/* Folders */}
      {!isSearching && !showTrash && childFolders.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {childFolders.map((folder) => (
            <div
              key={folder.id}
              className="group flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2.5 transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-border dark:hover:bg-muted"
            >
              <button
                type="button"
                onClick={() => setFolderId(folder.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]"
              >
                <IconFolder size={16} stroke={1.5} className="shrink-0 text-neutral-400" />
                <span className="truncate">{folder.name}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete folder ${folder.name}`}
                title="Delete folder — its contents move up one level"
                onClick={() => deleteFolder.mutate({ id: folder.id })}
                className="rounded p-1 text-neutral-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
              >
                <IconTrash size={14} stroke={1.5} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Assets */}
      {assetsQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {SKELETON_KEYS.map((key) => (
            <div
              key={key}
              className="aspect-square animate-pulse rounded-xl bg-neutral-100 dark:bg-muted"
            />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <EmptyState
          showTrash={showTrash}
          isSearching={isSearching}
          canSave={canSave}
          onUpload={() => fileRef.current?.click()}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {assets.map((asset) => (
            <div key={asset.id} className="group space-y-1.5">
              <div className="relative aspect-square overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-border dark:bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.url}
                  alt={asset.name}
                  className="h-full w-full object-contain p-2"
                />
                <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  {showTrash ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label="Restore"
                        title="Restore"
                        onClick={() => restoreAsset.mutate({ id: asset.id })}
                        className="rounded-md bg-neutral-900/80 p-1 text-white hover:bg-neutral-900"
                      >
                        <IconArrowBackUp size={14} stroke={1.5} />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete permanently"
                        title="Delete permanently"
                        onClick={() => purgeAsset.mutate({ id: asset.id })}
                        className="rounded-md bg-red-600/90 p-1 text-white hover:bg-red-600"
                      >
                        <IconTrashX size={14} stroke={1.5} />
                      </button>
                    </div>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Actions for ${asset.name}`}
                          className="rounded-md bg-neutral-900/80 p-1 text-white hover:bg-neutral-900"
                        >
                          <IconDots size={14} stroke={1.5} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onSelect={() => setRenaming({ id: asset.id, name: asset.name })}
                          className="gap-2 text-[13px]"
                        >
                          <IconPencil size={14} stroke={1.5} /> Rename
                        </DropdownMenuItem>
                        <MoveMenuItems
                          folders={folders}
                          currentFolderId={asset.folderId}
                          onMove={(target) =>
                            updateAsset.mutate({ id: asset.id, folderId: target })
                          }
                        />
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => setDeleting(asset)}
                          className="gap-2 text-[13px] text-red-600 focus:text-red-600"
                        >
                          <IconTrash size={14} stroke={1.5} /> Remove from assets
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>

              {renaming?.id === asset.id ? (
                <Input
                  autoFocus
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: asset.id, name: e.target.value })}
                  onBlur={() => {
                    const name = renaming.name.trim();
                    if (name && name !== asset.name) updateAsset.mutate({ id: asset.id, name });
                    else setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="h-7 text-[12px]"
                />
              ) : (
                <p
                  className="truncate text-[12px] text-neutral-600 dark:text-neutral-400"
                  title={asset.name}
                >
                  {asset.name}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <AssetUsageDialog
        assetId={deleting?.id ?? null}
        assetName={deleting?.name ?? ""}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteAsset.mutate({ id: deleting.id });
          setDeleting(null);
        }}
      />
    </div>
  );
}

function MoveMenuItems({
  folders,
  currentFolderId,
  onMove,
}: {
  folders: Folder[];
  currentFolderId: number | null;
  onMove: (folderId: number | null) => void;
}) {
  if (folders.length === 0) return null;

  return (
    <>
      <DropdownMenuSeparator />
      {currentFolderId !== null && (
        <DropdownMenuItem onSelect={() => onMove(null)} className="gap-2 text-[13px]">
          <IconFolder size={14} stroke={1.5} /> Move to All images
        </DropdownMenuItem>
      )}
      {folders
        .filter((folder) => folder.id !== currentFolderId)
        .map((folder) => (
          <DropdownMenuItem
            key={folder.id}
            onSelect={() => onMove(folder.id)}
            className="gap-2 text-[13px]"
          >
            <IconFolder size={14} stroke={1.5} />
            <span className="truncate">Move to {folder.name}</span>
          </DropdownMenuItem>
        ))}
    </>
  );
}

function EmptyState({
  showTrash,
  isSearching,
  canSave,
  onUpload,
}: {
  showTrash: boolean;
  isSearching: boolean;
  canSave: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 py-16 text-center dark:border-border">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-muted">
        {showTrash ? <IconTrash size={22} stroke={1.5} /> : <IconPhoto size={22} stroke={1.5} />}
      </span>
      <h3 className="mt-4 text-[15px] font-medium text-neutral-900 dark:text-foreground">
        {showTrash
          ? "Trash is empty"
          : isSearching
            ? "No assets match that search"
            : "No assets here yet"}
      </h3>
      {!showTrash && !isSearching && (
        <p className="mt-1 max-w-sm text-[13px] text-neutral-400 dark:text-neutral-500">
          Upload your company logos once, then pick them whenever you design a QR code or a page.
        </p>
      )}
      {!showTrash && !isSearching && canSave && (
        <Button type="button" className="mt-5 gap-1.5 text-[13px]" onClick={onUpload}>
          <IconUpload size={15} stroke={1.5} /> Upload images
        </Button>
      )}
    </div>
  );
}

const SKELETON_KEYS = ["a", "b", "c", "d", "e", "f"];

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
