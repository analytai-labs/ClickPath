import { TRPCError } from "@trpc/server";

import { prisma } from "@/server/db";
import { workspaceOwnership } from "@/server/lib/workspace";
import type { WorkspaceContext } from "@/server/lib/workspace";

import type { WorkspaceTRPCContext } from "../../trpc";
import type {
  CreateUtmTemplateInput,
  UpdateUtmTemplateInput,
} from "./utm-template.input";

const ensureUltraPlan = (ctx: WorkspaceTRPCContext) => {
  // Use workspace plan - team workspaces inherit Ultra features
  if (ctx.workspace.plan !== "ultra") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "UTM templates are only available on the Ultra plan. Please upgrade to use this feature.",
    });
  }
};

const getWorkspaceWhere = (workspace: WorkspaceContext) => {
  return workspace.type === "team"
    ? { teamId: workspace.teamId }
    : { userId: workspace.userId, teamId: null };
};

export const getUserUtmTemplates = async (ctx: WorkspaceTRPCContext) => {
  return prisma.utmTemplate.findMany({
    where: getWorkspaceWhere(ctx.workspace),
    orderBy: { name: "asc" },
  });
};

export const getUtmTemplateById = async (
  ctx: WorkspaceTRPCContext,
  id: number
) => {
  return prisma.utmTemplate.findFirst({
    where: {
      id,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });
};

export const createUtmTemplate = async (
  ctx: WorkspaceTRPCContext,
  input: CreateUtmTemplateInput
) => {
  ensureUltraPlan(ctx);

  const ownership = workspaceOwnership(ctx.workspace);

  const result = await prisma.utmTemplate.create({
    data: {
      name: input.name,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmTerm: input.utmTerm,
      utmContent: input.utmContent,
      userId: ownership.userId,
      teamId: ownership.teamId,
    },
  });

  return result;
};

export const updateUtmTemplate = async (
  ctx: WorkspaceTRPCContext,
  input: UpdateUtmTemplateInput
) => {
  ensureUltraPlan(ctx);

  const { id, ...data } = input;

  const existing = await prisma.utmTemplate.findFirst({
    where: {
      id,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });

  if (!existing) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Template not found or access denied",
    });
  }

  const updated = await prisma.utmTemplate.update({
    where: { id },
    data,
  });

  return updated;
};

export const deleteUtmTemplate = async (
  ctx: WorkspaceTRPCContext,
  id: number
) => {
  ensureUltraPlan(ctx);

  const existing = await prisma.utmTemplate.findFirst({
    where: {
      id,
      ...getWorkspaceWhere(ctx.workspace),
    },
  });

  if (!existing) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Template not found or access denied",
    });
  }

  await prisma.utmTemplate.delete({
    where: { id },
  });

  return { success: true };
};
