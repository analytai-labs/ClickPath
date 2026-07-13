import { customAlphabet } from "nanoid";
import crypto from "node:crypto";

import type { ProtectedTRPCContext } from "../../trpc";

import type { CreateTokenInput, DeleteTokenInput } from "./token.input";

function generateToken() {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const nanoid = customAlphabet(alphabet, 29);

  return nanoid();
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const getTokens = async (ctx: ProtectedTRPCContext) => {
  return await ctx.prisma.token.findMany({
    where: { userId: ctx.auth.userId }
  });
};

export const createToken = async (ctx: ProtectedTRPCContext, input: CreateTokenInput) => {
  const generatedToken = generateToken();

  const newToken = await ctx.prisma.token.create({
    data: {
      ...input,
      token: hashToken(generatedToken),
      userId: ctx.auth.userId,
    }
  });

  return [{ ...newToken, token: generatedToken }];
};

export const deleteToken = async (ctx: ProtectedTRPCContext, input: DeleteTokenInput) => {
  return await ctx.prisma.token.deleteMany({
    where: {
      id: input.id,
      userId: ctx.auth.userId,
    }
  });
};
