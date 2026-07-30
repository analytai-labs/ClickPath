"use client";

import { useEffect, useRef } from "react";

import { clientLogger } from "@/lib/logger/client";
import { renderQrInto } from "@/lib/qr-generator";

import type { QRCodeGeneratorState } from "@/lib/qr-generator/types";

const log = clientLogger.child({ component: "qr-preview-canvas" });

type Props = {
  /**
   * The design to render. Must be referentially stable between actual changes —
   * build it with `useMemo` (or from a debounced value), or every parent render
   * kicks off a fresh render pass.
   */
  state: QRCodeGeneratorState;
  className?: string;
};

/** A live QR preview that always shows the current design. */
export function QrPreviewCanvas({ state, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // `renderQrInto` discards its own result if a newer render has started, so
    // overlapping passes can't paint a stale design over a newer one.
    void renderQrInto(canvas, state).catch((error) => {
      log.error({ err: error }, "failed to render QR preview");
    });
  }, [state]);

  return <canvas ref={canvasRef} className={className} />;
}
