"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { api } from "@/trpc/react";

/** Matches the server cap. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";

export type PendingUpload = {
  /** Base64 data URL, held locally until the user decides whether to keep it. */
  dataUrl: string;
  /** Suggested name, taken from the file. */
  name: string;
};

/** Read a picked file into a data URL, rejecting anything the server would. */
export function readImageFile(file: File): Promise<PendingUpload | null> {
  if (!file.type.startsWith("image/")) {
    toast.error("Please select an image file (PNG, JPEG, WebP or GIF).");
    return Promise.resolve(null);
  }
  if (file.size > MAX_ASSET_BYTES) {
    toast.error("Image must be under 2 MB.");
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      resolve({ dataUrl: reader.result as string, name: stripExtension(file.name) });
    reader.onerror = () => {
      toast.error("That file couldn't be read.");
      resolve(null);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Upload an image and get back a URL.
 *
 * Both answers to "save this for later?" go through here — the difference is
 * only whether the upload joins the library, so a caller never has to deal with
 * base64 or with two different code paths.
 */
export function useAssetUpload(options?: { onUploaded?: (url: string) => void }) {
  const utils = api.useUtils();
  const [uploading, setUploading] = useState(false);

  const upload = api.asset.upload.useMutation({
    onSuccess: (asset) => {
      if (asset.library) {
        void utils.asset.list.invalidate();
        void utils.asset.recent.invalidate();
      }
      options?.onUploaded?.(asset.url);
    },
    onError: (error) => toast.error(error.message),
  });

  const run = useCallback(
    async (input: { image: string; name?: string; folderId?: number | null; save: boolean }) => {
      setUploading(true);
      try {
        return await upload.mutateAsync(input);
      } catch {
        return null; // already surfaced by onError
      } finally {
        setUploading(false);
      }
    },
    [upload],
  );

  return { upload: run, uploading: uploading || upload.isLoading };
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").slice(0, 255) || "Image";
}
