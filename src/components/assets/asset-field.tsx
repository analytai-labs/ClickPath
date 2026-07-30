"use client";

import { IconFolders, IconLoader2, IconPhoto, IconUpload, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";

import { AssetBrowserDialog } from "./asset-browser-dialog";
import { ACCEPTED_IMAGE_TYPES, readImageFile, useAssetUpload } from "./use-asset-upload";

import type { PendingUpload } from "./use-asset-upload";

type Props = {
  /** Current image URL, or null when nothing is chosen. */
  value: string | null | undefined;
  /** Always called with an R2 URL (never base64), or null when cleared. */
  onChange: (url: string | null) => void;
  label?: string;
  /** Shown under the controls. */
  hint?: string;
  /** Square for logos and avatars, wide for OG/social images. */
  aspect?: "square" | "wide";
  className?: string;
};

/**
 * An image input backed by the workspace's asset library.
 *
 * Every path through this control ends in a stored URL: picking a saved image,
 * or uploading a new one — which asks whether to keep it, so the library fills
 * up with logos the user meant to reuse rather than with every one-off crop.
 */
export function AssetField({
  value,
  onChange,
  label = "Image",
  hint,
  aspect = "square",
  className,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [browsing, setBrowsing] = useState(false);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [pendingName, setPendingName] = useState("");

  const capabilities = api.asset.capabilities.useQuery();
  const recents = api.asset.recent.useQuery({ limit: 6 });
  const { upload, uploading } = useAssetUpload();

  const canSave = capabilities.data?.canSave ?? false;
  const recentAssets = recents.data ?? [];

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const read = await readImageFile(file);
    if (!read) return;

    // On a plan without the library there is nothing to ask about — upload it
    // and move on rather than showing a prompt with only one answer.
    if (!canSave) {
      const asset = await upload({ image: read.dataUrl, name: read.name, save: false });
      if (asset) onChange(asset.url);
      return;
    }

    setPending(read);
    setPendingName(read.name);
  }

  async function resolvePending(save: boolean) {
    if (!pending) return;
    const asset = await upload({
      image: pending.dataUrl,
      name: save ? pendingName.trim() || pending.name : pending.name,
      save,
    });
    setPending(null);
    if (asset) onChange(asset.url);
  }

  return (
    <div className={cn("space-y-3", className)}>
      {value ? (
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "relative shrink-0 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-border dark:bg-muted",
              aspect === "square" ? "h-20 w-20" : "aspect-video w-40",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt={label}
              className={cn(
                "h-full w-full",
                aspect === "square" ? "object-contain p-1.5" : "object-cover",
              )}
            />
            <button
              type="button"
              aria-label={`Remove ${label.toLowerCase()}`}
              onClick={() => onChange(null)}
              className="absolute right-1 top-1 rounded-full bg-neutral-900/80 p-0.5 text-white shadow transition-colors hover:bg-neutral-900"
            >
              <IconX size={12} />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 gap-1.5 text-[12px]"
              onClick={() => setBrowsing(true)}
            >
              <IconFolders size={14} stroke={1.5} /> Choose from assets
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 gap-1.5 text-[12px]"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                <IconUpload size={14} stroke={1.5} />
              )}
              Replace
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {recentAssets.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                Recent
              </p>
              <div className="flex flex-wrap gap-2">
                {recentAssets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    title={asset.name}
                    onClick={() => onChange(asset.url)}
                    className="h-12 w-12 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 p-1 transition-colors hover:border-blue-400 dark:border-border dark:bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.url}
                      alt={asset.name}
                      className="h-full w-full object-contain"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-1.5 text-[13px]"
              onClick={() => setBrowsing(true)}
            >
              <IconFolders size={15} stroke={1.5} /> Choose from assets
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
          </div>

          {recentAssets.length === 0 && !recents.isLoading && (
            <p className="flex items-center gap-1.5 text-[12px] text-neutral-400 dark:text-neutral-500">
              <IconPhoto size={14} stroke={1.5} />
              Nothing saved yet — upload once and reuse it everywhere.
            </p>
          )}
        </div>
      )}

      {/* "Keep this for next time?" — shown right after a file is picked. */}
      {pending && (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pending.dataUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded-lg border border-neutral-200 bg-white object-contain p-1 dark:border-border"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-neutral-900 dark:text-foreground">
                Save this to your assets?
              </p>
              <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                Saved images can be reused on any link, QR code or page.
              </p>
            </div>
          </div>
          <Input
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            placeholder="Name — e.g. Acme logo"
            className="h-8 bg-white text-[13px] dark:bg-card"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="h-8 text-[12px]"
              disabled={uploading}
              onClick={() => void resolvePending(true)}
            >
              {uploading ? <IconLoader2 size={14} className="animate-spin" /> : "Save & use"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 text-[12px]"
              disabled={uploading}
              onClick={() => void resolvePending(false)}
            >
              Just use once
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 text-[12px]"
              disabled={uploading}
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {hint && !pending && (
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{hint}</p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        className="sr-only"
        aria-label={`Upload ${label.toLowerCase()}`}
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <AssetBrowserDialog
        open={browsing}
        onOpenChange={setBrowsing}
        onSelect={onChange}
        selectedUrl={value}
        canSave={canSave}
      />
    </div>
  );
}
