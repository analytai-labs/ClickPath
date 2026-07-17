import { IconUpload, IconTrash, IconLoader2, IconCheck } from "@tabler/icons-react";
import type React from "react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api } from "@/trpc/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import Image from "next/image";

interface LogoUploaderProps {
  setLogoImage: (image: string | null) => void;
  currentLogoImage?: string | null;
}

export function LogoUploader({ setLogoImage, currentLogoImage }: LogoUploaderProps) {
  const [error, setError] = useState<string | null>(null);

  // tRPC Hooks for the Logo Asset Library
  const trpcUtils = api.useUtils();
  const { data: assets, isLoading } = api.qrCode.listLogoAssets.useQuery();
  const createAsset = api.qrCode.createLogoAsset.useMutation({
    onSuccess: (data) => {
      trpcUtils.qrCode.listLogoAssets.invalidate();
      setLogoImage(data.url);
      toast.success("Logo uploaded successfully");
      setError(null);
    },
    onError: (err) => {
      setError(err.message || "Failed to upload logo");
      toast.error(err.message || "Failed to upload logo");
    },
  });
  
  const deleteAsset = api.qrCode.deleteLogoAsset.useMutation({
    onSuccess: () => {
      trpcUtils.qrCode.listLogoAssets.invalidate();
      toast.success("Logo deleted");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete logo");
    },
  });

  const uploadFile = (file: File) => {
    setError(null); // Clear any existing errors

    if (!file.type.startsWith('image/')) {
      setError("Invalid file type. Please upload an image.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError("File size exceeds 2MB limit");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      createAsset.mutate({
        name: file.name,
        image: reader.result as string,
      });
    };
    reader.onerror = () => {
      setError("Error reading file");
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) uploadFile(file);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Asset Gallery Grid */}
      {isLoading ? (
        <div className="flex h-20 items-center justify-center">
          <IconLoader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      ) : assets && assets.length > 0 ? (
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
          {assets.map((asset) => {
            const isSelected = currentLogoImage === asset.url;
            const isDeletingThis = deleteAsset.isLoading && deleteAsset.variables?.id === asset.id;
            return (
              <div
                key={asset.id}
                className={cn(
                  "group relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 transition-all hover:border-blue-400",
                  isSelected ? "border-blue-600 ring-2 ring-blue-600/20" : "border-transparent bg-neutral-100 dark:bg-neutral-800"
                )}
                onClick={() => setLogoImage(isSelected ? null : asset.url)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.url}
                  alt={asset.name || "Logo asset"}
                  className="h-full w-full object-contain p-2"
                />
                
                {isSelected && (
                  <div className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 shadow-sm">
                    <IconCheck size={10} className="text-white" stroke={3} />
                  </div>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (currentLogoImage === asset.url) setLogoImage(null);
                    deleteAsset.mutate({ id: asset.id });
                  }}
                  disabled={deleteAsset.isLoading}
                  className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100 disabled:bg-black/60"
                >
                  {isDeletingThis ? (
                    <IconLoader2 size={18} className="animate-spin text-white" />
                  ) : (
                    <IconTrash size={18} className="text-white" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Upload Dropzone */}
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-200 px-4 py-5 transition-colors hover:border-neutral-300 hover:bg-neutral-50/50 dark:border-neutral-700 dark:hover:bg-neutral-800",
          createAsset.isLoading && "pointer-events-none opacity-60"
        )}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {createAsset.isLoading ? (
          <IconLoader2 size={24} className="animate-spin text-neutral-400" />
        ) : (
          <IconUpload size={20} stroke={1.5} className="text-neutral-400" />
        )}
        
        <div className="flex items-center gap-1 text-[13px]">
          <label
            htmlFor="logo-image"
            className="cursor-pointer font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            {createAsset.isLoading ? "Uploading..." : "Upload a file"}
            <Input
              id="logo-image"
              type="file"
              className="sr-only"
              onChange={handleFileUpload}
              accept="image/png, image/jpeg, image/gif, image/webp"
              disabled={createAsset.isLoading}
            />
          </label>
          {!createAsset.isLoading && <span className="text-neutral-400">or drag and drop</span>}
        </div>
        {!createAsset.isLoading && <p className="text-[11px] text-neutral-400">PNG, JPG, GIF up to 2MB</p>}
        {error && <p className="text-[11px] text-red-500">{error}</p>}
      </div>
    </div>
  );
}

export default LogoUploader;
