"use client";

import { IconPhoto } from "@tabler/icons-react";

import { templatePageDisplayUrl, templatePageHost } from "@/lib/templates/page-url";
import { getTemplateDefinition } from "@/lib/templates/registry";
import { resolveShareMetadata } from "@/lib/templates/share-metadata";

import type { TemplateThemeValue } from "@/lib/templates/types";
import type { TemplatePageData } from "./editor-types";
import type { SettingsDraft } from "./page-settings-panel";

/**
 * What this page looks like when its link is pasted into a chat or a post.
 *
 * Deliberately built from the same `resolveShareMetadata` the public routes use,
 * and from the same palette the OG image generator uses, so the card can't drift
 * from what is actually served. It reads the unsaved draft, so the user sees the
 * effect of a change before saving it.
 */
export function SharePreviewCard({
  page,
  draft,
}: {
  page: TemplatePageData;
  draft: SettingsDraft;
}) {
  const definition = getTemplateDefinition(page.templateType);
  const colors = definition.resolveOgColors(page.theme as TemplateThemeValue);

  const address = {
    slug: draft.slug || page.slug,
    shareDomain: draft.shareDomain || null,
    customDomain: draft.serveAtRoot ? draft.shareDomain || null : null,
  };

  const { title, description } = resolveShareMetadata({
    slug: address.slug,
    title: draft.title.trim() || null,
    description: draft.description.trim() || null,
    seoTitle: draft.autoSeoTitle ? null : draft.seoTitle.trim() || null,
    seoDescription: draft.autoSeoDescription ? null : draft.seoDescription.trim() || null,
    templateType: page.templateType,
    templateData: page.templateData,
  });

  const isGradient = colors.background.startsWith("linear-gradient");

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-border dark:bg-card">
        {/* 1200×630 is the ratio every platform crops to. */}
        <div className="relative aspect-[1200/630] w-full">
          {draft.socialImageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={draft.socialImageUrl}
              alt="Social preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <GeneratedCardPreview
              avatarUrl={definition.usesAvatar ? draft.avatarUrl : null}
              title={title}
              subtitle={description ?? templatePageDisplayUrl(address)}
              colors={colors}
              isGradient={isGradient}
            />
          )}
        </div>

        <div className="space-y-1 border-t border-neutral-200 px-3 py-2.5 dark:border-border">
          <p className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            {templatePageHost(address)}
          </p>
          <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-neutral-900 dark:text-foreground">
            {title}
          </p>
          {description ? (
            <p className="line-clamp-2 text-[12px] leading-snug text-neutral-500 dark:text-neutral-400">
              {description}
            </p>
          ) : (
            <p className="flex items-center gap-1 text-[12px] italic text-neutral-400 dark:text-neutral-500">
              <IconPhoto size={12} stroke={1.5} /> No description yet
            </p>
          )}
        </div>
      </div>

      <p className="text-center text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500">
        How this page appears when its link is shared on WhatsApp, X, LinkedIn or Slack.
      </p>
    </div>
  );
}

/** A miniature of the auto-generated share card, matching the OG route's layout. */
function GeneratedCardPreview({
  avatarUrl,
  title,
  subtitle,
  colors,
  isGradient,
}: {
  avatarUrl: string | null;
  title: string;
  subtitle: string;
  colors: { background: string; text: string; muted: string; accent: string };
  isGradient: boolean;
}) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center"
      style={
        isGradient
          ? { backgroundImage: colors.background, color: colors.text }
          : { backgroundColor: colors.background, color: colors.text }
      }
    >
      {avatarUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
      ) : (
        <div
          className="h-10 w-10 rounded-full opacity-25"
          style={{ backgroundColor: colors.accent }}
        />
      )}
      <p className="line-clamp-2 text-[13px] font-bold leading-tight">{title}</p>
      <p className="line-clamp-2 text-[10px] leading-tight" style={{ color: colors.muted }}>
        {subtitle}
      </p>
    </div>
  );
}
