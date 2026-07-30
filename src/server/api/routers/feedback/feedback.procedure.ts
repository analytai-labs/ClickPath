import { z } from "zod";

import { runBackgroundTask } from "@/lib/utils/background";
import { sendFeedbackNotification } from "@/server/lib/notifications/discord";
import { isR2Configured, r2UploadImage } from "@/server/lib/storage/r2";
import { adminProcedure, createTRPCRouter, protectedProcedure } from "../../trpc";

const EXTENSION_MAP: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
};

const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_IMAGES = 3;

async function uploadFeedbackImage(
  base64Image: string,
  userId: string,
  feedbackId: number,
  index: number,
): Promise<string | null> {
  const match = base64Image.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/);
  if (!match) return null;

  if (!isR2Configured()) return null;

  const [, format, base64Data] = match;
  const buffer = Buffer.from(base64Data!, "base64");

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) return null;

  const { url } = await r2UploadImage({
    buffer,
    contentType: `image/${format}`,
    imageType: "feedback",
    workspaceId: userId,
    resourceId: `${feedbackId}-${index}`,
    workspaceType: "personal",
    extension: EXTENSION_MAP[format!] || "png",
  });

  return url;
}

export const feedbackRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        type: z.enum(["bug", "feature", "question"]),
        message: z.string().min(1).max(2000),
        images: z.array(z.string()).max(MAX_IMAGES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.auth.userId;

      // Insert feedback record
      const inserted = await ctx.prisma.feedback.create({
        data: {
          userId,
          type: input.type,
          message: input.message,
          imageUrls: [],
        },
      });

      const feedbackId = inserted.id;

      // Upload images to R2 if provided
      let images: string[] = [];
      if (input.images && input.images.length > 0) {
        const uploadResults = await Promise.allSettled(
          input.images.map((img, i) => uploadFeedbackImage(img, userId, Number(feedbackId), i)),
        );

        images = uploadResults
          .filter(
            (r): r is PromiseFulfilledResult<string | null> =>
              r.status === "fulfilled" && r.value !== null,
          )
          .map((r) => r.value!);

        // Update feedback with image URLs
        if (images.length > 0) {
          await ctx.prisma.feedback.update({
            where: { id: Number(feedbackId) },
            data: { imageUrls: images },
          });
        }
      }

      // Get user info for Discord notification
      const userRecord = await ctx.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });

      // Send Discord notification — waitUntil so the serverless function
      // stays alive until the webhook request completes.
      void runBackgroundTask(
        sendFeedbackNotification({
          userEmail: userRecord?.email ?? "unknown",
          userName: userRecord?.name,
          feedbackType: input.type,
          message: input.message,
          imageUrls: images,
        }),
      );

      return { success: true };
    }),

  // Admin: list all feedback
  list: adminProcedure
    .input(
      z.object({
        status: z.enum(["open", "resolved", "dismissed"]).optional(),
        cursor: z.number().optional(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { status, cursor, limit } = input;

      const items = await ctx.prisma.feedback.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(cursor ? { id: { lt: cursor } } : {}),
        },
        include: {
          user: {
            select: { name: true, email: true, image: true },
          },
        },
        orderBy: { id: "desc" },
        take: limit + 1,
      });

      let nextCursor: number | undefined;
      if (items.length > limit) {
        const nextItem = items.pop()!;
        nextCursor = nextItem.id;
      }

      return { items, nextCursor };
    }),

  // Admin: update feedback status
  updateStatus: adminProcedure
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["open", "resolved", "dismissed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.feedback.update({
        where: { id: input.id },
        data: { status: input.status },
      });

      return { success: true };
    }),
});
