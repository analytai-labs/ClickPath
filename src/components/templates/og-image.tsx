import { ImageResponse } from "next/og";

import { getTemplateDefinition } from "@/lib/templates/registry";

import type { TemplateThemeValue } from "@/lib/templates/types";
import type { Prisma } from "@prisma/client";

export const TEMPLATE_OG_SIZE = { width: 1200, height: 630 };

/** The columns the OG routes select. Kept narrow so the query stays cheap. */
export type TemplateOgPage = {
  title: string | null;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  theme: Prisma.JsonValue;
  socialImageUrl: string | null;
  templateType: string;
  templateData: Prisma.JsonValue;
} | null;

/**
 * Renders the social-share (OG) image for a template page. If the owner set a
 * Pro custom social image, that's used full-bleed; otherwise an image is
 * generated from the page's avatar, title and the palette of its own template.
 * Shared by the /p/[slug] and custom-domain opengraph-image routes so they
 * can't drift.
 */
export function templateOgImageResponse(page: TemplateOgPage, slug: string): ImageResponse {
  if (page?.socialImageUrl) {
    return new ImageResponse(
      <div style={{ display: "flex", width: "100%", height: "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={page.socialImageUrl}
          alt=""
          width={TEMPLATE_OG_SIZE.width}
          height={TEMPLATE_OG_SIZE.height}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>,
      TEMPLATE_OG_SIZE,
    );
  }

  const definition = getTemplateDefinition(page?.templateType);
  const colors = definition.resolveOgColors((page?.theme ?? null) as TemplateThemeValue);

  const handle = page?.slug ?? slug;
  const derived = page ? definition.deriveTitle(page.templateData ?? definition.defaultData) : null;
  const title = page?.title || derived || `@${handle}`;
  const subtitle = page?.description || `clickpath.analytai.in/p/${handle}`;
  const isGradient = colors.background.startsWith("linear-gradient");

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        padding: 96,
        textAlign: "center",
        color: colors.text,
        ...(isGradient
          ? { backgroundImage: colors.background }
          : { backgroundColor: colors.background }),
      }}
    >
      {page?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={page.avatarUrl}
          alt=""
          width={180}
          height={180}
          style={{ borderRadius: 9999, objectFit: "cover" }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            width: 180,
            height: 180,
            borderRadius: 9999,
            backgroundColor: colors.accent,
            opacity: 0.25,
          }}
        />
      )}
      <div
        style={{ display: "flex", marginTop: 48, fontSize: 72, fontWeight: 700, maxWidth: 1000 }}
      >
        {title}
      </div>
      <div
        style={{ display: "flex", marginTop: 20, fontSize: 32, color: colors.muted, maxWidth: 900 }}
      >
        {subtitle}
      </div>
      <div style={{ display: "flex", marginTop: 56, fontSize: 24, color: colors.muted }}>
        Made with ClickPath
      </div>
    </div>,
    TEMPLATE_OG_SIZE,
  );
}
