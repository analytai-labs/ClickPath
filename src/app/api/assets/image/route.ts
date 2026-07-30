import { NextResponse } from "next/server";

import { env } from "@/env.mjs";
import { logger } from "@/lib/logger";

const log = logger.child({ component: "asset-image-proxy" });

/** Long, immutable: object keys are unique per upload, so content never changes. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/**
 * Same-origin proxy for images stored in this app's own bucket.
 *
 * The QR generator draws the logo onto a canvas and then reads the pixels back
 * (for effects) and exports a PNG, both of which require an untainted canvas —
 * which needs either CORS headers on the bucket or a same-origin URL. Public R2
 * buckets serve no `Access-Control-Allow-Origin`, so without this the logo
 * silently fails to load and the code renders with an empty centre.
 *
 * Only URLs under `R2_PUBLIC_URL` are fetched, so this can't be pointed at
 * arbitrary hosts.
 */
export async function GET(request: Request) {
  const src = new URL(request.url).searchParams.get("src");
  const base = env.R2_PUBLIC_URL;

  if (!src || !base || !src.startsWith(`${base}/`)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const upstream = await fetch(src, { cache: "force-cache" });
    if (!upstream.ok || !upstream.body) {
      return new NextResponse("Not found", { status: 404 });
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!ALLOWED_CONTENT_TYPES.has(contentType.split(";")[0]!.trim())) {
      return new NextResponse("Unsupported media type", { status: 415 });
    }

    return new NextResponse(upstream.body, {
      headers: {
        "content-type": contentType,
        "cache-control": CACHE_CONTROL,
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    log.error({ err: error, src }, "failed to proxy asset image");
    return new NextResponse("Bad gateway", { status: 502 });
  }
}
