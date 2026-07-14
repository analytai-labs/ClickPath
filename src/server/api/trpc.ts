import { auth } from "@/auth";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { DEFAULT_PLATFORM_DOMAIN } from "@/lib/constants/domains";
import { prisma } from "@/server/db";
import {
  type WorkspaceContext,
  resolveWorkspaceContext,
  userHasUltraPlan,
} from "@/server/lib/workspace";

import type { inferAsyncReturnType } from "@trpc/server";
import type { Session } from "next-auth";

export const createTRPCContext = async (opts: {
  auth: Session | null;
  headers: Headers;
}) => {
  return {
    prisma,
    ...opts,
    headers: opts.headers,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

// Base context type
export const createTRPCContextInner = createTRPCContext;
export type TRPCContext = inferAsyncReturnType<typeof createTRPCContext>;

// Protected context type with enforced userId
export type ProtectedTRPCContext = Omit<TRPCContext, "auth"> & {
  auth: {
    userId: string;
    session: Session;
  };
  /** Whether the user has isAdmin=true, fetched once during auth */
  isAdmin: boolean;
};

// Per-request memo so batched procedures share one ban/admin lookup.
// Keyed on the ctx object — same request = same ctx = same cached promise.
const currentUserCache = new WeakMap<
  object,
  Promise<{ banned: boolean | null; isAdmin: boolean | null } | null>
>();

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const session = ctx.auth;
  const userId = session?.user?.id;
  if (!session || !userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  let cached = currentUserCache.get(ctx);
  if (!cached) {
    cached = ctx.prisma.user.findUnique({
      where: { id: userId },
      select: { banned: true, isAdmin: true },
    });
    currentUserCache.set(ctx, cached);
  }
  const currentUser = await cached;

  if (currentUser?.banned) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your account has been suspended. Please contact support for more information.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      auth: {
        userId,
        session,
      },
      isAdmin: currentUser?.isAdmin ?? false,
    } as ProtectedTRPCContext,
  });
});

// ============================================================================
// WORKSPACE-AWARE PROCEDURES
// ============================================================================

/**
 * Context type with workspace information
 */
export type WorkspaceTRPCContext = ProtectedTRPCContext & {
  workspace: WorkspaceContext;
};

/**
 * Workspace-aware procedure that resolves the current workspace from the hostname.
 * This should be used for all operations that need workspace context.
 */
export const workspaceProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const hostname = ctx.headers.get("host") ?? DEFAULT_PLATFORM_DOMAIN;

  const workspace = await resolveWorkspaceContext(ctx.auth.userId, hostname, ctx.prisma);

  return next({
    ctx: {
      ...ctx,
      workspace,
    } as WorkspaceTRPCContext,
  });
});

/**
 * Context type for team-only procedures
 */
export type TeamTRPCContext = ProtectedTRPCContext & {
  workspace: Extract<WorkspaceContext, { type: "team" }>;
};

/**
 * Procedure that requires a team workspace.
 * Throws FORBIDDEN if called from a personal workspace.
 */
export const teamProcedure = workspaceProcedure.use(({ ctx, next }) => {
  if (ctx.workspace.type !== "team") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This action requires a team workspace",
    });
  }

  return next({
    ctx: ctx as TeamTRPCContext,
  });
});

/**
 * Procedure that requires the user to have an Ultra plan.
 * Used for team creation and other Ultra-only features.
 */
export const ultraProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const hasUltra = await userHasUltraPlan(ctx.auth.userId, ctx.prisma);

  if (!hasUltra) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This feature requires an Ultra plan subscription",
    });
  }

  return next({ ctx });
});

/**
 * Admin procedure that requires the user to have isAdmin=true.
 * Reads from context (already fetched in protectedProcedure) — no extra DB query.
 */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.isAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }

  return next({ ctx });
});

export type PublicTRPCContext = {
  prisma: TRPCContext["prisma"];
  headers: TRPCContext["headers"];
};
