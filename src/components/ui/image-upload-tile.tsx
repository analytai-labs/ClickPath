"use client";

import { IconPhoto, IconUpload, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB — matches server limit

type Props = {
  /** Current value: an R2 https:// URL, a base64 data URL, or null (empty). */
  value: string | null | undefined;
  /** Called with a base64 data URL when the user picks a file, or null when they clear it. */
  onChange: (dataUrlOrNull: string | null) => void;
  /** Label shown inside the empty tile. Default: "Upload image" */
  label?: string;
  /** Accessible label for the tile button. */
  ariaLabel?: string;
  className?: string;
};

/**
 * A single image-upload tile. Click or drag a file onto it to pick an image.
 * Converts the file to a base64 data URL (the server will then upload it to R2).
 * Shows a preview and a remove button once an image is set.
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
        <div className="group relative w-full aspect-square overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 dark:border-border dark:bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value!}
            alt=""
            className="h-full w-full object-cover"
          />
          {/* Hover overlay */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-1.5 bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100"
          >
            <span className="rounded-lg bg-white/90 px-2.5 py-1 text-[11px] font-medium text-neutral-900 shadow">
              Replace
            </span>
          </button>
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
        /* Empty tile — click or drag */
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={[
            "flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-neutral-400 transition-colors",
            "aspect-square",
            dragging
              ? "border-blue-400 bg-blue-50 text-blue-500 dark:bg-blue-950/30"
              : "border-neutral-200 bg-neutral-50 hover:border-neutral-300 hover:bg-neutral-100 dark:border-border dark:bg-muted dark:hover:border-neutral-600",
          ].join(" ")}
        >
          {dragging ? (
            <IconUpload size={20} stroke={1.5} />
          ) : (
            <IconPhoto size={20} stroke={1.5} />
          )}
          <span className="text-center text-[11px] leading-tight">{label}</span>
        </button>
      )}
    </div>
  );
}
