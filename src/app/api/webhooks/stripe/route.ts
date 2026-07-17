import { env } from "@/env.mjs";
import { prisma } from "@/server/db";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { resend } from "@/server/lib/notifications/resend-client";
import { WelcomeEmail } from "@/emails/welcome-to-pro";
import { sendDiscordNotification } from "@/server/lib/notifications/discord";

const stripe = new Stripe(env.STRIPE_API_KEY || "");

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("Stripe-Signature") as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET || "",
    );
  } catch (error: any) {
    return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (event.type === "checkout.session.completed") {
    const subscription = (await stripe.subscriptions.retrieve(
      session.subscription as string,
    )) as any;
    const customerId = String(session.customer);

    const user = await prisma.user.findFirst({
      where: {
        id: session?.client_reference_id as string,
      },
    });

    if (!user) {
      return new NextResponse("User not found", { status: 404 });
    }

    await prisma.subscription.upsert({
      where: { userId: user.id },
      update: {
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: customerId,
        stripePriceId: subscription.items?.data?.[0]?.price?.id ?? "",
        plan: "pro",
        status: subscription.status,
        renewsAt: new Date(subscription.current_period_end * 1000),
        endsAt: subscription.cancel_at
          ? new Date(subscription.cancel_at * 1000)
          : null,
      },
      create: {
        userId: user.id,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: customerId,
        stripePriceId: subscription.items?.data?.[0]?.price?.id ?? "",
        plan: "pro",
        status: subscription.status,
        renewsAt: new Date(subscription.current_period_end * 1000),
        createdAt: new Date(subscription.created * 1000),
        endsAt: subscription.cancel_at
          ? new Date(subscription.cancel_at * 1000)
          : null,
      },
    });

    // Send Welcome Email
    if (resend && user.email) {
      await resend.emails.send({
        from: env.EMAIL_FROM || "onboarding@resend.dev",
        to: user.email,
        subject: "Welcome to ClickPath Pro! 🚀",
        react: WelcomeEmail({ userName: user.name || "there", plan: "pro" }),
      });
    }

    await sendDiscordNotification({
      content: `🎉 **New Pro Subscription**\nUser: ${user.email}`,
    });
  }

  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as any;
    if (invoice.subscription) {
      const subscription = (await stripe.subscriptions.retrieve(
        invoice.subscription as string,
      )) as any;

      await prisma.subscription.updateMany({
        where: {
          stripeSubscriptionId: subscription.id,
        },
        data: {
          status: subscription.status,
          stripePriceId: subscription.items?.data?.[0]?.price?.id ?? "",
          renewsAt: new Date(subscription.current_period_end * 1000),
        },
      });
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;

    await prisma.subscription.updateMany({
      where: {
        stripeSubscriptionId: subscription.id,
      },
      data: {
        status: "canceled",
        renewsAt: null,
      },
    });
  }

  return new NextResponse(null, { status: 200 });
}
