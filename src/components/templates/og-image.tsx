import { ImageResponse } from "next/og";

import { templatePageDisplayUrl } from "@/lib/templates/page-url";
import { getTemplateDefinition } from "@/lib/templates/registry";

import type { TemplateThemeValue } from "@/lib/templates/types";
import type { Prisma } from "@prisma/client";

export const TEMPLATE_OG_SIZE = { width: 1200, height: 630 };

/** Truncate on a word boundary so a long product name can't overrun the card. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

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
  shareDomain: string | null;
  customDomain: string | null;
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
  const data = page?.templateData ?? definition.defaultData;
  const title = page?.title || definition.deriveTitle(data) || `@${handle}`;
  // Falls back to the page's own URL, built from the domain it is actually
  // served from — a customer-domain page must not advertise the platform host.
  const subtitle =
    page?.description ||
    definition.deriveDescription(data) ||
    templatePageDisplayUrl({
      slug: handle,
      shareDomain: page?.shareDomain ?? null,
      customDomain: page?.customDomain ?? null,
    });
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
        padding: 56,
        textAlign: "center",
        color: colors.text,
        ...(isGradient
          ? { backgroundImage: colors.background }
          : { backgroundColor: colors.background }),
      }}
    >
      {/*
        Every block is `flexShrink: 0` with an explicit `lineHeight`, and the
        sizes below are budgeted so a two-line title plus a three-line subtitle
        still fits in 630px. Without that, a long product name overflowed the
        card and Yoga compressed the boxes until the title was drawn on top of
        the subtitle.
      */}
      {page?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={page.avatarUrl}
          alt=""
          width={140}
          height={140}
          style={{ borderRadius: 9999, objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            width: 140,
            height: 140,
            borderRadius: 9999,
            backgroundColor: colors.accent,
            opacity: 0.25,
            flexShrink: 0,
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          marginTop: 32,
          fontSize: 56,
          fontWeight: 700,
          lineHeight: 1.15,
          maxWidth: 1000,
        }}
      >
        {clamp(title, 80)}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          marginTop: 20,
          fontSize: 28,
          lineHeight: 1.35,
          color: colors.muted,
          maxWidth: 880,
        }}
      >
        {clamp(subtitle, 150)}
      </div>
      <div
        style={{
          display: "flex",
          flexShrink: 0,
          marginTop: 32,
          fontSize: 22,
          lineHeight: 1.2,
          color: colors.muted,
        }}
      >
        Made with ClickPath
      </div>
    </div>,
    TEMPLATE_OG_SIZE,
  );
}
