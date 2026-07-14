import { z } from "zod";
import Stripe from "stripe";
import { env } from "@/env.mjs";
import { getStripePriceId } from "@/lib/billing/plans";
import { logger } from "@/lib/logger";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { TRPCError } from "@trpc/server";

const log = logger.child({ component: "billing.stripe" });

const stripe = new Stripe(env.STRIPE_API_KEY || "");

export const stripeRouter = createTRPCRouter({
  createCheckoutOrUpdate: protectedProcedure
    .input(
      z.object({
        plan: z.enum(["pro", "ultra"]),
        interval: z.enum(["monthly", "annual"]).default("monthly"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.auth.userId;
      const priceId = getStripePriceId(input.plan, input.interval);

      const user = await ctx.prisma.user.findFirst({
        where: { id: userId },
      });

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const userSubscription = await ctx.prisma.subscription.findFirst({
        where: { userId },
      });

      // If user has an active Stripe subscription, create a portal session to upgrade/downgrade
      if (
        userSubscription &&
        userSubscription.status === "active" &&
        userSubscription.stripeCustomerId
      ) {
        if (userSubscription.stripePriceId === priceId) {
          return {
            status: "updated",
            message: "You are already on this plan.",
          };
        }

        const portalSession = await stripe.billingPortal.sessions.create({
          customer: userSubscription.stripeCustomerId,
          return_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard/settings/billing`,
        });

        return {
          status: "portal",
          url: portalSession.url,
        };
      }

      // Create a checkout session for new subscription
      const checkoutSession = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "subscription",
        client_reference_id: userId,
        customer_email: user.email || undefined,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard/settings/billing?success=true`,
        cancel_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard/settings/billing?canceled=true`,
      });

      return {
        status: "checkout",
        url: checkoutSession.url,
      };
    }),

  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.auth.userId;

    const userSubscription = await ctx.prisma.subscription.findFirst({
      where: { userId },
    });

    if (!userSubscription || !userSubscription.stripeCustomerId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No active subscription found",
      });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: userSubscription.stripeCustomerId,
      return_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard/settings/billing`,
    });

    return {
      url: portalSession.url,
    };
  }),

  cancelSubscription: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.auth.userId;

    const userSubscription = await ctx.prisma.subscription.findFirst({
      where: { userId },
    });

    if (!userSubscription || !userSubscription.stripeSubscriptionId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No active subscription found to cancel",
      });
    }

    await stripe.subscriptions.update(userSubscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    return {
      success: true,
      message: "Subscription will be canceled at the end of the billing period.",
    };
  }),
});
