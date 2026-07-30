"use client";

import { IconFolders, IconPhoto, IconUpload, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { AssetBrowserDialog } from "@/components/assets";

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB — matches server limit

type Props = {
  /** Current value: an R2 https:// URL, a base64 data URL, or null (empty). */
  value: string | null | undefined;
  /**
   * Called with the new value, or null when cleared. A freshly picked file
   * arrives as a base64 data URL that the server uploads on save; an image
   * chosen from the asset library arrives as its stored URL.
   */
  onChange: (value: string | null) => void;
  /** Label shown inside the empty tile. Default: "Upload image" */
  label?: string;
  /** Accessible label for the tile button. */
  ariaLabel?: string;
  className?: string;
};

/**
 * A single image tile for grids of content images.
 *
 * Click or drag a file onto it to pick a new image, or reach for the library
 * button to reuse one that's already saved. Picked files stay local until the
 * surrounding form is saved, so abandoning an edit uploads nothing.
 */
export function ImageUploadTile({
  value,
  onChange,
  label = "Upload image",
  ariaLabel = "Upload image",
  className = "",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  function processFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (PNG, JPEG, WebP, GIF).");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      toast.error("Image must be under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => onChange(reader.result as string);
    reader.readAsDataURL(file);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset so the same file can be picked again
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  const hasImage = Boolean(value);

  return (
    <div className={`relative ${className}`}>
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={handleInputChange}
      />

      {hasImage ? (
        /* Preview tile */
        <div className="group relative aspect-square w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-border dark:bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value!} alt="" className="h-full w-full object-cover" />
          {/* Hover overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/0 opacity-0 transition-all group-hover:bg-black/45 group-hover:opacity-100">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-lg bg-white/90 px-2.5 py-1 text-[11px] font-medium text-neutral-900 shadow"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => setBrowsing(true)}
              className="rounded-lg bg-white/80 px-2.5 py-1 text-[11px] font-medium text-neutral-900 shadow"
            >
              Assets
            </button>
          </div>
          {/* Remove button */}
          <button
            type="button"
            aria-label="Remove image"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="absolute right-1 top-1 rounded-full bg-neutral-900/80 p-0.5 text-white shadow transition-opacity hover:bg-neutral-900"
          >
            <IconX size={12} />
          </button>
        </div>
      ) : (
        /* Empty tile — click, drag, or reach for the library */
        <div
          className={[
            "relative flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-neutral-400 transition-colors",
            dragging
              ? "border-blue-400 bg-blue-50 text-blue-500 dark:bg-blue-950/30"
              : "border-neutral-200 bg-neutral-50 hover:border-neutral-300 hover:bg-neutral-100 dark:border-border dark:bg-muted dark:hover:border-neutral-600",
          ].join(" ")}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <button
            type="button"
            aria-label={ariaLabel}
            onClick={() => inputRef.current?.click()}
            className="flex flex-1 w-full flex-col items-center justify-center gap-1.5"
          >
            {dragging ? (
              <IconUpload size={20} stroke={1.5} />
            ) : (
              <IconPhoto size={20} stroke={1.5} />
            )}
            <span className="px-1 text-center text-[11px] leading-tight">{label}</span>
          </button>
          <button
            type="button"
            aria-label="Choose from your assets"
            title="Choose from your assets"
            onClick={() => setBrowsing(true)}
            className="absolute bottom-1 right-1 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700"
          >
            <IconFolders size={14} stroke={1.5} />
          </button>
        </div>
      )}

      <AssetBrowserDialog
        open={browsing}
        onOpenChange={setBrowsing}
        onSelect={onChange}
        selectedUrl={value}
      />
    </div>
  );
}
