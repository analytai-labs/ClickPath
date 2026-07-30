"use client";

import { IconDownload, IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateQRCode } from "@/lib/qr-generator";
import { templatePageUrl } from "@/lib/templates/page-url";
import {
  DEFAULT_TEMPLATE_QR_DESIGN,
  type TemplateQrDesign,
  normalizeQrDesign,
  qrDesignToGeneratorState,
} from "@/lib/templates/qr-design";
import { api } from "@/trpc/react";

import { QRAdvancedCustomization } from "../../../qrcodes/create/_components/qr-advanced-customization";
import { EditorCard } from "./editor-ui";

import type { TemplatePageData } from "./editor-types";

/** Scale used for the downloadable PNG — the on-screen preview stays smaller. */
const EXPORT_SCALE = 20;

const NO_PRESET = "__none__";

/**
 * The page's QR code. It always encodes the page's canonical URL, so once the
 * page is published on the customer's own domain the printed code no longer
 * depends on the platform domain existing.
 */
export function QrPanel({ page, onSaved }: { page: TemplatePageData; onSaved: () => void }) {
  const url = templatePageUrl(page);

  const [design, setDesign] = useState<TemplateQrDesign>(() => normalizeQrDesign(page.qrDesign));
  const [dirty, setDirty] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [debouncedDesign] = useDebounce(design, 120);

  const { data: presets } = api.qrCode.listPresets.useQuery();

  const save = api.templatePage.updateQrDesign.useMutation({
    onSuccess: () => {
      toast.success("QR code saved.");
      setDirty(false);
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  const update = useCallback((patch: Partial<TemplateQrDesign>) => {
    setDesign((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }, []);

  // Re-render the preview whenever the design or the encoded URL changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void generateQRCode(canvas, qrDesignToGeneratorState(debouncedDesign, url)).catch((err) => {
      console.error("Failed to render QR preview:", err);
    });
  }, [debouncedDesign, url]);

  async function download() {
    try {
      const canvas = document.createElement("canvas");
      await generateQRCode(canvas, {
        ...qrDesignToGeneratorState(design, url),
        scale: EXPORT_SCALE,
      });
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png", 1.0);
      link.download = `${page.slug}-qr.png`;
      link.click();
    } catch (err) {
      console.error("Failed to export QR code:", err);
      toast.error("Could not generate the QR image. Please try again.");
    }
  }

  function applyPreset(presetId: string) {
    if (presetId === NO_PRESET) return;
    const preset = presets?.find((p) => String(p.id) === presetId);
    if (!preset) return;
    update({
      pixelStyle: preset.pixelStyle as TemplateQrDesign["pixelStyle"],
      markerShape: preset.markerShape as TemplateQrDesign["markerShape"],
      markerInnerShape: preset.markerInnerShape as TemplateQrDesign["markerInnerShape"],
      darkColor: preset.darkColor,
      lightColor: preset.lightColor,
      effect: preset.effect as TemplateQrDesign["effect"],
      effectRadius: preset.effectRadius,
      marginNoise: preset.marginNoise,
      marginNoiseRate: Number.parseFloat(preset.marginNoiseRate),
      logoImage: preset.logoImage ?? null,
      logoSize: Math.min(preset.logoSize ?? 25, 30),
      logoMargin: preset.logoMargin ?? 4,
      logoBorderRadius: preset.logoBorderRadius ?? 8,
    });
  }

  return (
    <>
      <EditorCard
        title="QR code"
        description="Encodes this page's public URL. Re-print only if that URL changes."
        action={
          <Button variant="outline" size="sm" onClick={download} className="gap-1.5">
            <IconDownload size={15} stroke={1.5} /> PNG
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="shrink-0 rounded-xl border border-neutral-200 bg-white p-3 dark:border-border">
            <canvas ref={canvasRef} className="h-[168px] w-[168px] rounded-md" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                Encoded URL
              </p>
              <p className="mt-1 break-all font-mono text-[12px] text-neutral-700 dark:text-neutral-300">
                {url}
              </p>
            </div>
            {!page.shareDomain && (
              <p className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-500">
                This code points at the platform domain. Set a public domain you own in Settings
                first, so printed codes keep working if that domain ever changes.
              </p>
            )}
          </div>
        </div>
      </EditorCard>

      {presets && presets.length > 0 && (
        <EditorCard title="Preset" description="Reuse a QR style you saved while designing a link.">
          <Select onValueChange={applyPreset}>
            <SelectTrigger>
              <SelectValue placeholder="Apply a saved preset" />
            </SelectTrigger>
            <SelectContent>
              {presets.map((preset) => (
                <SelectItem key={preset.id} value={String(preset.id)}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </EditorCard>
      )}

      <EditorCard title="Style">
        <QRAdvancedCustomization
          pixelStyle={design.pixelStyle}
          setPixelStyle={(pixelStyle) => update({ pixelStyle })}
          markerShape={design.markerShape}
          setMarkerShape={(markerShape) => update({ markerShape })}
          markerInnerShape={design.markerInnerShape}
          setMarkerInnerShape={(markerInnerShape) => update({ markerInnerShape })}
          darkColor={design.darkColor}
          setDarkColor={(darkColor) => update({ darkColor })}
          lightColor={design.lightColor}
          setLightColor={(lightColor) => update({ lightColor })}
          effect={design.effect}
          setEffect={(effect) => update({ effect })}
          effectRadius={design.effectRadius}
          setEffectRadius={(effectRadius) => update({ effectRadius })}
          marginNoise={design.marginNoise}
          setMarginNoise={(marginNoise) => update({ marginNoise })}
          marginNoiseRate={design.marginNoiseRate}
          setMarginNoiseRate={(marginNoiseRate) => update({ marginNoiseRate })}
          logoImage={design.logoImage ?? undefined}
          setLogoImage={(logoImage) => update({ logoImage: logoImage ?? null })}
          logoSize={design.logoSize}
          setLogoSize={(logoSize) => update({ logoSize })}
          logoMargin={design.logoMargin}
          setLogoMargin={(logoMargin) => update({ logoMargin })}
          logoBorderRadius={design.logoBorderRadius}
          setLogoBorderRadius={(logoBorderRadius) => update({ logoBorderRadius })}
        />
      </EditorCard>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-neutral-500"
          onClick={() => {
            setDesign(DEFAULT_TEMPLATE_QR_DESIGN);
            setDirty(true);
          }}
        >
          <IconRefresh size={15} stroke={1.5} /> Reset to default
        </Button>
        <Button
          onClick={() => save.mutate({ id: page.id, qrDesign: design })}
          disabled={!dirty || save.isLoading}
        >
          {save.isLoading ? "Saving…" : "Save QR code"}
        </Button>
      </div>
    </>
  );
}
