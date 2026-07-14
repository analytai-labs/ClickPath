import DomainReminderEmail from "@/emails/domain-reminder";
import { env } from "@/env.mjs";
import { EMAIL_SENDER } from "@/lib/constants/app";
import { logger } from "@/lib/logger";

import { resend } from "./resend-client";

const log = logger.child({ notification: "domain-reminder" });

type Challenge = {
  type: "TXT" | "A" | "CNAME";
  domain: string;
  value: string;
};

type SendDomainReminderEmailInput = {
  email: string;
  recipientName?: string | null;
  domain: string;
  daysMisconfigured: number;
  challenges: Challenge[];
};

export async function sendDomainReminderEmail({
  email,
  recipientName,
  domain,
  daysMisconfigured,
  challenges,
}: SendDomainReminderEmailInput) {
  if (!resend) return;

  const dashboardUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard/domains`;

  try {
    await resend.emails.send({
      from: EMAIL_SENDER,
      to: email,
      subject: `${domain} needs configuration on ClickPath`,
      react: DomainReminderEmail({
        recipientName,
        domain,
        daysMisconfigured,
        challenges,
        dashboardUrl,
      }),
    });
  } catch (error) {
    log.error(
      { err: error, email, domain, daysMisconfigured },
      "failed to send domain reminder email",
    );
  }
}
