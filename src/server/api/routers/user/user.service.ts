import { TRPCError } from "@trpc/server";

import type { ProtectedTRPCContext } from "../../trpc";
import type { UpdateUserProfileInput } from "./user.input";

export async function getUserProfile(ctx: ProtectedTRPCContext) {
  const userProfile = await ctx.prisma.user.findUnique({
    where: { id: ctx.auth.userId },
    select: {
      id: true,
      name: true,
      email: true,
      imageUrl: true,
      isAdmin: true,
    },
  });

  if (!userProfile) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "User profile not found",
    });
  }

  return userProfile;
}

export async function updateUserProfile(
  ctx: ProtectedTRPCContext,
  input: UpdateUserProfileInput,
) {
  await ctx.prisma.user.update({
    where: { id: ctx.auth.userId },
    data: { name: input.name },
  });

  return getUserProfile(ctx);
}
