"use client";

import { IconDownload, IconRefresh } from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

import { QrPreviewCanvas } from "@/components/qr/qr-preview-canvas";
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

export type QrPanelState = ReturnType<typeof useQrDesign>;

/**
 * The QR tab's design state, owned by the editor shell.
 *
 * Lifted for the same reason as the settings draft: the live preview lives in the
 * shell's right rail, and an unsaved design must survive switching tabs.
 */
export function useQrDesign(page: TemplatePageData, onSaved: () => void) {
  const url = templatePageUrl(page);

  const [design, setDesign] = useState<TemplateQrDesign>(() => normalizeQrDesign(page.qrDesign));
  const [dirty, setDirty] = useState(false);
  const [debouncedDesign] = useDebounce(design, 120);

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

  const reset = useCallback(() => {
    setDesign(DEFAULT_TEMPLATE_QR_DESIGN);
    setDirty(true);
  }, []);

  const submit = useCallback(() => {
    save.mutate({ id: page.id, qrDesign: design });
  }, [design, page.id, save]);

  // Memoized so the preview only re-renders when the debounced design actually
  // changes, not on every keystroke elsewhere in the editor.
  const previewState = useMemo(
    () => qrDesignToGeneratorState(debouncedDesign, url),
    [debouncedDesign, url],
  );

  const download = useCallback(async () => {
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
  }, [design, page.slug, url]);

  return {
    design,
    previewState,
    url,
    dirty,
    update,
    reset,
    submit,
    download,
    saving: save.isLoading,
  };
}

/** The QR code as it will be printed, shown in the editor's right rail. */
export function QrPreviewRail({ state }: { state: QrPanelState }) {
  return (
    <div className="space-y-3">
      <div className="mx-auto w-full max-w-[320px] rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-border dark:bg-card">
        <QrPreviewCanvas state={state.previewState} className="h-auto w-full rounded-lg" />
      </div>
      <div className="space-y-1 text-center">
        <p className="text-[11px] text-neutral-400 dark:text-neutral-500">Scans to</p>
        <p className="break-all px-2 font-mono text-[11px] text-neutral-600 dark:text-neutral-300">
          {state.url}
        </p>
      </div>
      <div className="flex justify-center">
        <Button variant="outline" size="sm" onClick={state.download} className="gap-1.5">
          <IconDownload size={15} stroke={1.5} /> Download PNG
        </Button>
      </div>
    </div>
  );
}

/**
 * Controls for the page's QR code. It always encodes the page's canonical URL,
 * so once the page is published on the customer's own domain the printed code no
 * longer depends on the platform domain.
 */
export function QrPanel({ page, state }: { page: TemplatePageData; state: QrPanelState }) {
  const { design, update } = state;
  const { data: presets } = api.qrCode.listPresets.useQuery();

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
      logoClearSpace: preset.logoClearSpace ?? true,
    });
  }

  return (
    <>
      <EditorCard
        title="Encoded URL"
        description="Re-print only if this URL changes. The preview on the right is what gets printed."
      >
        <p className="break-all font-mono text-[12px] text-neutral-700 dark:text-neutral-300">
          {state.url}
        </p>
        {!page.shareDomain && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-500">
            This code points at the platform domain. Set a public domain you own in Settings first,
            so printed codes keep working if that domain ever changes.
          </p>
        )}
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
          logoClearSpace={design.logoClearSpace}
          setLogoClearSpace={(logoClearSpace) => update({ logoClearSpace })}
        />
      </EditorCard>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-neutral-500"
          onClick={state.reset}
        >
          <IconRefresh size={15} stroke={1.5} /> Reset to default
        </Button>
        <Button onClick={state.submit} disabled={!state.dirty || state.saving}>
          {state.saving ? "Saving…" : "Save QR code"}
        </Button>
      </div>
    </>
  );
}
