"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { clientLogger } from "@/lib/logger/client";

const log = clientLogger.child({ component: "qr-modal" });
import { IconPencil } from "@tabler/icons-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { defaultGeneratorState, generateQRCode } from "@/lib/qr-generator";

type QRCodeModalProps = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  destinationUrl: string;
  onCustomize?: () => void;
  qrCode?: {
    patternStyle?: string | null;
    cornerStyle?: string | null;
    selectedColor?: string | null;
    lightColor?: string | null;
    logoImage?: string | null;
    effect?: string | null;
    marginNoise?: boolean | null;
    markerInnerShape?: string | null;
  } | null;
};

export function QRCodeModal({
  open,
  setOpen,
  destinationUrl,
  onCustomize,
  qrCode,
}: QRCodeModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const renderQRCode = useCallback(async () => {
    if (!canvasRef.current || !destinationUrl) return;

    try {
      await generateQRCode(canvasRef.current, {
        ...defaultGeneratorState(),
        text: destinationUrl,
        scale: 10,
        margin: 2,
        pixelStyle: (qrCode?.patternStyle as any) || "rounded",
        markerShape: (qrCode?.cornerStyle as any) || "rounded",
        darkColor: qrCode?.selectedColor || "#000000",
        lightColor: qrCode?.lightColor || "#ffffff",
        logoImage: qrCode?.logoImage || "",
        effect: (qrCode?.effect as any) || "none",
        marginNoise: qrCode?.marginNoise ?? false,
        markerInnerShape: (qrCode?.markerInnerShape as "auto" | "circle" | "square" | "plus" | "diamond") || "auto",
      });
    } catch (error) {
      log.error({ err: error, action: "render" }, "failed to generate QR code");
    }
  }, [destinationUrl, qrCode]);

  useEffect(() => {
    if (open) {
      // Small delay to ensure canvas is mounted in the dialog
      const timer = setTimeout(renderQRCode, 50);
      return () => clearTimeout(timer);
    }
  }, [open, renderQRCode]);

  const handleQRCodeDownload = async () => {
    if (!canvasRef.current || !destinationUrl) return;

    try {
      // Generate a high-quality version for download
      const downloadCanvas = document.createElement("canvas");
      await generateQRCode(downloadCanvas, {
        ...defaultGeneratorState(),
        text: destinationUrl,
        scale: 20,
        margin: 2,
        pixelStyle: (qrCode?.patternStyle as any) || "rounded",
        markerShape: (qrCode?.cornerStyle as any) || "rounded",
        darkColor: qrCode?.selectedColor || "#000000",
        lightColor: qrCode?.lightColor || "#ffffff",
        logoImage: qrCode?.logoImage || "",
        effect: (qrCode?.effect as any) || "none",
        marginNoise: qrCode?.marginNoise ?? false,
        markerInnerShape: (qrCode?.markerInnerShape as "auto" | "circle" | "square" | "plus" | "diamond") || "auto",
      });

      const pngUrl = downloadCanvas
        .toDataURL("image/png")
        .replace("image/png", "image/octet-stream");
      const downloadLink = document.createElement("a");
      downloadLink.href = pngUrl;
      downloadLink.download = "qrcode.png";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } catch (error) {
      log.error({ err: error, action: "download" }, "failed to download QR code");
      toast.error("Failed to download QR code");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>QR Code</DialogTitle>
          <DialogDescription>Scan or download your link&apos;s QR code</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex justify-center">
          <div className="rounded-lg border border-border bg-white dark:bg-card p-2">
            {destinationUrl ? (
              <canvas
                ref={canvasRef}
                className="block"
                style={{ width: "240px", height: "240px" }}
              />
            ) : (
              <div className="flex h-[240px] w-[240px] items-center justify-center text-sm text-gray-400 dark:text-neutral-500">
                No URL provided
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter className="gap-2 sm:justify-between">
          {onCustomize ? (
            <Button
              type="button"
              variant="outline"
              onClick={onCustomize}
              className="h-9 gap-1.5 text-xs font-medium"
            >
              <IconPencil size={14} stroke={1.5} />
              Customize QR Style
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="h-9">
              Close
            </Button>
            <Button onClick={handleQRCodeDownload} className="h-9">
              Download
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
