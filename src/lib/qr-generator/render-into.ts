import { generateQRCode } from "./generate";

import type { QRCodeGeneratorState } from "./types";

/**
 * Per-canvas render counter. A WeakMap so nothing is retained once the canvas
 * element is gone.
 */
const generations = new WeakMap<HTMLCanvasElement, number>();

/**
 * Render a QR design into a visible canvas, discarding superseded renders.
 *
 * `generateQRCode` paints incrementally and awaits an image load when the design
 * has a logo, which makes it unsafe to point at a canvas the user is watching:
 * two overlapping calls interleave, and because the logo render is the slower one
 * it tends to land last. That is what kept a removed logo on screen, and what
 * made a rapid style change briefly show the previous design.
 *
 * Rendering offscreen and copying across only if this is still the newest render
 * makes the visible canvas always show the latest design, and never a half-drawn
 * one.
 */
export async function renderQrInto(
  canvas: HTMLCanvasElement,
  state: QRCodeGeneratorState,
): Promise<void> {
  const generation = (generations.get(canvas) ?? 0) + 1;
  generations.set(canvas, generation);

  const offscreen = document.createElement("canvas");
  await generateQRCode(offscreen, state);

  // A newer render started while this one was awaiting its logo — drop this one.
  if (generations.get(canvas) !== generation) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = offscreen.width;
  canvas.height = offscreen.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(offscreen, 0, 0);
}
