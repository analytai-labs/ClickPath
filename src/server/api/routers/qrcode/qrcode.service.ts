import { TRPCError } from "@trpc/server";

import { buildCacheKey, deleteFromCache } from "@/lib/core/cache";
import { logger } from "@/lib/logger";
import { runBackgroundTask } from "@/lib/utils/background";
import { releaseImage } from "@/server/lib/assets";
import { assertUrlSafe } from "@/server/lib/phishing";
import { deleteImage, uploadImage } from "@/server/lib/storage";
import { insertHiddenTrackingLink, prepareHiddenTrackingLink } from "@/server/lib/tracking-link";
import { workspaceOwnership, workspaceFilter } from "@/server/lib/workspace";

import { updateLink } from "../link/link.service";

import type { z } from "zod";
import type { WorkspaceTRPCContext } from "../../trpc";
import type {
  QRCodeInput,
  QRCodeUpdateInput,
  QRPresetCreateInput,
  QRPresetUpdateInput,
} from "./qrcode.input";
import type { qrcodeSaveImageInput } from "./qrcode.input";

const log = logger.child({ component: "qrcode.service" });

function userFacing<A extends unknown[], R>(
  operation: string,
  fallbackMessage: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      log.error({ err: error, operation }, "unexpected error in qrcode service");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: fallbackMessage,
      });
    }
  };
}

export const createQrCode = userFacing(
  "createQrCode",
  "Something went wrong while creating your QR code. Please try again.",
  async (ctx: WorkspaceTRPCContext, input: QRCodeInput) => {
    const ownership = workspaceOwnership(ctx.workspace);

    // Prepare the hidden tracking link (quota check + URL safety + domain +
    // alias). Re-message the link-limit error for the QR context.
    let prepared: Awaited<ReturnType<typeof prepareHiddenTrackingLink>>;
    try {
      prepared = await prepareHiddenTrackingLink(ctx, {
        url: input.content,
        name: input.title || "QR Code",
        domain: input.domain?.trim() || undefined,
        kind: "qr",
      });
    } catch (error) {
      if (error instanceof TRPCError && error.code === "FORBIDDEN" && /link/i.test(error.message)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "You've reached your monthly link limit. Each QR code requires a tracking link, which counts toward your plan's link quota. Please upgrade your plan to create more QR codes.",
        });
      }
      throw error;
    }

    const { insertedQrCodeId } = await ctx.prisma.$transaction(async (tx) => {
      const hiddenLinkId = await insertHiddenTrackingLink(tx, ctx, prepared);

      const insertionResult = await tx.qrCode.create({
        data: {
          userId: ownership.userId,
          teamId: ownership.teamId,
          title: input.title,
          color: input.selectedColor,
          content: input.content,
          cornerStyle: input.cornerStyle as any,
          patternStyle: input.patternStyle as any,
          linkId: hiddenLinkId,
          contentType: "link",
        },
      });

      return { insertedQrCodeId: insertionResult.id };
    });

    return { trackingUrl: prepared.trackingUrl, id: insertedQrCodeId };
  },
);

export const saveQrCodeImage = userFacing(
  "saveQrCodeImage",
  "Something went wrong while saving your QR code image. Please try again.",
  async (ctx: WorkspaceTRPCContext, input: z.infer<typeof qrcodeSaveImageInput>) => {
    const record = await ctx.prisma.qrCode.findFirst({
      where: {
        id: input.id,
        ...(ctx.workspace.type === "team"
          ? { teamId: ctx.workspace.teamId }
          : { userId: ctx.workspace.userId, teamId: null }),
      },
    });

    if (!record) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "QR code not found.",
      });
    }

    // Persist base64 immediately so we have a fallback
    await ctx.prisma.qrCode.update({
      where: { id: input.id },
      data: { qrCode: input.qrCodeBase64 },
    });

    // Upload to R2
    try {
      const image = await uploadImage(ctx, {
        image: input.qrCodeBase64,
        resourceId: input.id,
        imageType: "qr-code",
      });

      if (image && image !== input.qrCodeBase64) {
        await ctx.prisma.qrCode.update({
          where: { id: input.id },
          data: { qrCode: image },
        });

        return image;
      }
    } catch (error) {
      log.error({ err: error, qrCodeId: input.id }, "failed to upload QR code image to R2");
    }

    return input.qrCodeBase64;
  },
);

export const getQrCode = userFacing(
  "getQrCode",
  "Something went wrong while loading this QR code. Please try again.",
  async (ctx: WorkspaceTRPCContext, id: number) => {
    const qrCode = await ctx.prisma.qrCode.findFirst({
      where: {
        id: id,
        ...(ctx.workspace.type === "team"
          ? { teamId: ctx.workspace.teamId }
          : { userId: ctx.workspace.userId, teamId: null }),
      },
      include: {
        link: true,
      },
    });

    if (!qrCode) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "QR code not found.",
      });
    }

    return qrCode;
  },
);

export const retrieveUserQrCodes = userFacing(
  "retrieveUserQrCodes",
  "Something went wrong while loading your QR codes. Please try again.",
  async (ctx: WorkspaceTRPCContext) => {
    const qrCodes = await ctx.prisma.qrCode.findMany({
      where:
        ctx.workspace.type === "team"
          ? { teamId: ctx.workspace.teamId }
          : { userId: ctx.workspace.userId, teamId: null },
      include: {
        link: true,
      },
    });

    // Get visit counts in a single aggregation query instead of loading all visit rows.
    // Combine raw visits with archived clicks rolled up by the analytics cleanup job.
    const linkIds = qrCodes
      .map((qr) => qr.linkId)
      .filter((id): id is number => id != null && id > 0);
    const [visitCounts, archivedCounts] =
      linkIds.length > 0
        ? await Promise.all([
            ctx.prisma.linkVisit.groupBy({
              by: ["linkId"],
              _count: true,
              where: { linkId: { in: linkIds } },
            }),
            ctx.prisma.linkVisitDailySummary.groupBy({
              by: ["linkId"],
              _sum: { clicks: true },
              where: { linkId: { in: linkIds } },
            }),
          ])
        : [[], []];

    const countMap = new Map(visitCounts.map((v) => [v.linkId, v._count]));
    for (const row of archivedCounts) {
      countMap.set(row.linkId, (countMap.get(row.linkId) ?? 0) + (Number(row._sum.clicks) || 0));
    }

    return qrCodes.map((qr) => ({
      ...qr,
      visitCount: countMap.get(qr.linkId!) ?? 0,
    }));
  },
);

export const deleteQrCode = userFacing(
  "deleteQrCode",
  "Something went wrong while deleting your QR code. Please try again.",
  async (ctx: WorkspaceTRPCContext, id: number) => {
    const qrCode = await ctx.prisma.qrCode.findFirst({
      where: {
        id: id,
        ...(ctx.workspace.type === "team"
          ? { teamId: ctx.workspace.teamId }
          : { userId: ctx.workspace.userId, teamId: null }),
      },
      include: { link: true },
    });

    if (!qrCode) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "QR code not found.",
      });
    }

    // Delete QR code image from R2 if present
    if (qrCode.qrCode) {
      try {
        await deleteImage(qrCode.qrCode);
      } catch (error) {
        log.error({ err: error, qrCodeId: id }, "failed to delete QR code image from R2");
      }
    }

    // Collect cache key before the transaction so we can invalidate after it commits
    let cacheKey: string | undefined;
    if (qrCode.link?.alias) {
      cacheKey = buildCacheKey(qrCode.link.domain, qrCode.link.alias);
    }

    // Delete QR code and its associated hidden link atomically
    await ctx.prisma.$transaction(async (tx) => {
      await tx.qrCode.delete({ where: { id } });

      if (qrCode.linkId && qrCode.linkId > 0) {
        await Promise.all([
          tx.uniqueLinkVisit.deleteMany({ where: { linkId: qrCode.linkId } }),
          tx.linkVisit.deleteMany({ where: { linkId: qrCode.linkId } }),
        ]);
        await tx.link.delete({ where: { id: qrCode.linkId } });
      }
    });

    // Invalidate cache after the transaction commits successfully
    if (cacheKey) {
      void runBackgroundTask(deleteFromCache(cacheKey));
    }

    return true;
  },
);

// ---------------------------------------------------------------------------
// QR Code Update / Actions
// ---------------------------------------------------------------------------

/** Fetch a QR code by ID with workspace ownership check, joining the associated link. */
async function fetchQrCodeWithLink(ctx: WorkspaceTRPCContext, id: number) {
  const qrCode = await ctx.prisma.qrCode.findFirst({
    where: {
      id: id,
      ...(ctx.workspace.type === "team"
        ? { teamId: ctx.workspace.teamId }
        : { userId: ctx.workspace.userId, teamId: null }),
    },
    include: { link: true },
  });

  if (!qrCode) {
    throw new TRPCError({ code: "NOT_FOUND", message: "QR code not found." });
  }
  if (!qrCode.linkId || !qrCode.link) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This QR code has no associated link.",
    });
  }

  return qrCode as typeof qrCode & { linkId: number; link: NonNullable<typeof qrCode.link> };
}

export const updateQrCode = userFacing(
  "updateQrCode",
  "Something went wrong while updating your QR code. Please try again.",
  async (ctx: WorkspaceTRPCContext, input: QRCodeUpdateInput) => {
    const qrCode = await fetchQrCodeWithLink(ctx, input.id);

    // Phishing check on new destination URL
    if (input.url) {
      await assertUrlSafe(input.url);
    }

    const qrUpdates: { title?: string; content?: string } = {};
    if (input.title !== undefined) qrUpdates.title = input.title;
    if (input.url !== undefined) qrUpdates.content = input.url;

    // Apply the link update first so a failure there leaves both the live
    // redirect target and the QR metadata at their prior values. assertUrlSafe
    // has already validated the new URL, so there's no safety window to close.
    const { id: _qrId, title, url, ...linkFields } = input;
    await updateLink(ctx, {
      id: qrCode.linkId,
      url,
      name: title,
      ...linkFields,
    });

    if (Object.keys(qrUpdates).length > 0) {
      await ctx.prisma.qrCode.update({
        where: { id: input.id },
        data: qrUpdates,
      });
    }

    return true;
  },
);

export const resetQrCodeStatistics = userFacing(
  "resetQrCodeStatistics",
  "Something went wrong while resetting statistics. Please try again.",
  async (ctx: WorkspaceTRPCContext, id: number) => {
    const qrCode = await fetchQrCodeWithLink(ctx, id);

    // Delete both visit tables to fully reset stats (matches deleteQrCode cleanup)
    await Promise.all([
      ctx.prisma.linkVisit.deleteMany({ where: { linkId: qrCode.linkId } }),
      ctx.prisma.uniqueLinkVisit.deleteMany({ where: { linkId: qrCode.linkId } }),
    ]);

    return true;
  },
);

export const toggleQrCodeStatus = userFacing(
  "toggleQrCodeStatus",
  "Something went wrong while toggling QR code status. Please try again.",
  async (ctx: WorkspaceTRPCContext, id: number) => {
    const qrCode = await fetchQrCodeWithLink(ctx, id);

    // Inline instead of delegating to toggleLinkStatusService to avoid a redundant link re-fetch
    await ctx.prisma.link.update({
      where: { id: qrCode.linkId },
      data: { disabled: !qrCode.link.disabled },
    });

    // Invalidate cache so the status change takes effect immediately
    if (qrCode.link.alias) {
      await deleteFromCache(buildCacheKey(qrCode.link.domain, qrCode.link.alias));
    }

    return true;
  },
);

// QR Preset Service Functions
export const createQrPreset = userFacing(
  "createQrPreset",
  "Something went wrong while creating your preset. Please try again.",
  async (ctx: WorkspaceTRPCContext, input: QRPresetCreateInput) => {
    const ownership = workspaceOwnership(ctx.workspace);

    const insertResult = await ctx.prisma.qrPreset.create({
      data: {
        name: input.name,
        userId: ownership.userId ?? "",
        teamId: ownership.teamId,
        pixelStyle: input.pixelStyle,
        markerShape: input.markerShape,
        markerInnerShape: input.markerInnerShape,
        darkColor: input.darkColor,
        lightColor: input.lightColor,
        effect: input.effect,
        effectRadius: input.effectRadius,
        marginNoise: input.marginNoise,
        marginNoiseRate: input.marginNoiseRate,
        // Logo settings
        logoImage: input.logoImage,
        logoSize: input.logoSize,
        logoMargin: input.logoMargin,
        logoBorderRadius: input.logoBorderRadius,
        logoClearSpace: input.logoClearSpace,
      },
    });

    const insertedId = insertResult.id;

    // Upload logo image to R2 if it's base64
    if (input.logoImage) {
      try {
        const image = await uploadImage(ctx, {
          image: input.logoImage,
          resourceId: insertedId,
          imageType: "qr-logo",
        });

        // Update preset with the R2 URL if upload was successful and URL changed
        if (image && image !== input.logoImage) {
          await ctx.prisma.qrPreset.update({
            where: { id: insertedId },
            data: { logoImage: image },
          });
        }
      } catch (error) {
        log.error(
          { err: error, presetId: insertedId, action: "create" },
          "failed to upload logo image to R2",
        );
        // Don't fail preset creation if image upload fails - base64 is already saved
      }
    }

    return ctx.prisma.qrPreset.findUnique({
      where: { id: insertedId },
    });
  },
);

export const listQrPresets = userFacing(
  "listQrPresets",
  "Something went wrong while loading your presets. Please try again.",
  async (ctx: WorkspaceTRPCContext) => {
    return ctx.prisma.qrPreset.findMany({
      where:
        ctx.workspace.type === "team"
          ? { teamId: ctx.workspace.teamId }
          : { userId: ctx.workspace.userId, teamId: null },
      orderBy: { createdAt: "desc" },
    });
  },
);

export const deleteQrPreset = userFacing(
  "deleteQrPreset",
  "Something went wrong while deleting your preset. Please try again.",
  async (ctx: WorkspaceTRPCContext, id: number) => {
    const preset = await ctx.prisma.qrPreset.findFirst({
      where: {
        id: id,
        ...(ctx.workspace.type === "team"
          ? { teamId: ctx.workspace.teamId }
          : { userId: ctx.workspace.userId, teamId: null }),
      },
    });

    if (!preset) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "QR preset not found.",
      });
    }

    // Release the logo. A logo saved in the asset library survives this — the
    // preset is only one of the places that may point at it.
    if (preset.logoImage) {
      try {
        await releaseImage(ctx, preset.logoImage);
      } catch (error) {
        log.error(
          { err: error, presetId: id, action: "delete-preset" },
          "failed to release logo image",
        );
      }
    }

    await ctx.prisma.qrPreset.delete({ where: { id: id } });

    return true;
  },
);

export const updateQrPreset = userFacing(
  "updateQrPreset",
  "Something went wrong while updating your preset. Please try again.",
  async (ctx: WorkspaceTRPCContext, input: QRPresetUpdateInput) => {
    const preset = await ctx.prisma.qrPreset.findFirst({
      where: {
        id: input.id,
        ...(ctx.workspace.type === "team"
          ? { teamId: ctx.workspace.teamId }
          : { userId: ctx.workspace.userId, teamId: null }),
      },
    });

    if (!preset) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "QR preset not found.",
      });
    }

    // Handle logo image changes:
    // - undefined: not provided, preserve existing preset.logoImage
    // - null: explicit removal, delete from R2 and set to null
    // - string: replacement, upload new and delete old
    let logoImageUrl: string | null | undefined;

    if (input.logoImage === undefined) {
      // Not provided - preserve existing
      logoImageUrl = preset.logoImage;
    } else if (input.logoImage === null) {
      // Explicit removal - delete old image if exists
      logoImageUrl = null;
      if (preset.logoImage) {
        try {
          await releaseImage(ctx, preset.logoImage);
        } catch (error) {
          log.error(
            { err: error, presetId: input.id, action: "remove-logo" },
            "failed to release logo image",
          );
        }
      }
    } else {
      // New image provided - upload to R2
      try {
        const image = await uploadImage(ctx, {
          image: input.logoImage,
          resourceId: input.id,
          imageType: "qr-logo",
        });

        logoImageUrl = image ?? input.logoImage;

        // Delete old logo from R2 if it's being replaced
        if (preset.logoImage && preset.logoImage !== logoImageUrl) {
          try {
            await releaseImage(ctx, preset.logoImage);
          } catch (error) {
            log.error(
              { err: error, presetId: input.id, action: "replace-logo" },
              "failed to release old logo image",
            );
          }
        }
      } catch (error) {
        log.error(
          { err: error, presetId: input.id, action: "update-preset" },
          "failed to upload logo image to R2",
        );
        // Continue with the input image if upload fails
        logoImageUrl = input.logoImage;
      }
    }

    await ctx.prisma.qrPreset.update({
      where: { id: input.id },
      data: {
        pixelStyle: input.pixelStyle,
        markerShape: input.markerShape,
        markerInnerShape: input.markerInnerShape,
        darkColor: input.darkColor,
        lightColor: input.lightColor,
        effect: input.effect,
        effectRadius: input.effectRadius,
        marginNoise: input.marginNoise,
        marginNoiseRate: input.marginNoiseRate,
        // Logo settings
        logoImage: logoImageUrl,
        logoSize: input.logoSize,
        logoMargin: input.logoMargin,
        logoBorderRadius: input.logoBorderRadius,
        logoClearSpace: input.logoClearSpace,
      },
    });

    return ctx.prisma.qrPreset.findUnique({
      where: { id: input.id },
    });
  },
);
