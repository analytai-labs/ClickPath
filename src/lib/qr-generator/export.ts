/**
 * Raster formats a QR code can be downloaded in. There is deliberately no SVG:
 * the generator draws onto a canvas (with effects), so an "SVG" would only be a
 * bitmap wrapped in an <image> tag — not the vector file a print shop asks for.
 */
export type DownloadFormat = "png" | "jpeg";

export const DOWNLOAD_FORMATS: { format: DownloadFormat; label: string }[] = [
  { format: "png", label: "Download PNG" },
  { format: "jpeg", label: "Download JPEG" },
];

/**
 * Triggers a download of a given URL in the browser.
 */
function triggerDownload(url: string, filename: string, newTab = false) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  if (newTab) {
    link.target = "_blank";
    link.rel = "noopener";
  }
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  // Delay revocation to allow asynchronous browser download manager to fetch the blob
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Downloads a canvas element in the specified format.
 */
export async function downloadCanvas(
  sourceCanvas: HTMLCanvasElement,
  filename: string,
  format: DownloadFormat,
) {
  if (format === "jpeg") {
    const jpegCanvas = document.createElement("canvas");
    jpegCanvas.width = sourceCanvas.width;
    jpegCanvas.height = sourceCanvas.height;
    const ctx = jpegCanvas.getContext("2d");
    if (ctx) {
      // JPEG doesn't support transparency, fill with white background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, jpegCanvas.width, jpegCanvas.height);
      ctx.drawImage(sourceCanvas, 0, 0);
    }
    triggerDownload(jpegCanvas.toDataURL("image/jpeg", 1.0), `${filename}.jpeg`);
    return;
  }

  triggerDownload(sourceCanvas.toDataURL("image/png", 1.0), `${filename}.png`);
}

/**
 * Downloads a stored QR image (a data URL or a remote storage URL).
 *
 * PNG never touches a canvas: the stored image already is a PNG, and drawing a
 * remote image whose host sends no CORS header taints the canvas, so the export
 * would fail. It is fetched as a blob (keeps the filename), falling back to a
 * plain link to the file. JPEG has to be re-encoded and therefore needs CORS;
 * when the host refuses it this throws and the caller should offer PNG instead.
 */
export async function downloadImageSrc(src: string, filename: string, format: DownloadFormat) {
  if (format === "png") {
    if (src.startsWith("data:")) {
      triggerDownload(src, `${filename}.png`);
      return;
    }
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      downloadBlob(await response.blob(), `${filename}.png`);
    } catch {
      // No CORS on the storage host: the browser ignores `download` across
      // origins, so this opens the image for the user to save.
      triggerDownload(src, `${filename}.png`, true);
    }
    return;
  }

  const img = new Image();
  if (!src.startsWith("data:")) {
    img.crossOrigin = "anonymous";
  }
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not load the QR image"));
    img.src = src;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d")?.drawImage(img, 0, 0);

  await downloadCanvas(canvas, filename, format);
}
