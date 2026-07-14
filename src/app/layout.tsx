import "@/styles/globals.css";

import { SessionProvider } from "next-auth/react";
import { ViewTransitions } from "next-view-transitions";
import Script from "next/script";

import { MicrosoftClarityScript } from "@/components/scripts/clarity";
import { ReleaseNotesScript } from "@/components/scripts/release-notes";
import { JsonLd } from "@/components/seo/json-ld";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { env } from "@/env.mjs";
import { APP_TITLE } from "@/lib/constants/app";
import {
  fontDisplay,
  fontHeading,
  fontLogo,
  fontSans,
  fontWarmDisplay,
  fontWarmUi,
} from "@/lib/fonts";
import { organizationSchema, websiteSchema } from "@/lib/seo/structured-data";
import { cn } from "@/lib/utils";
import { TRPCReactProvider } from "@/trpc/react";

import { CSPostHogProvider } from "./providers";

import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://clickpath.analytai.in"),
  title: {
    default: APP_TITLE,
    template: `%s | ${APP_TITLE}`,
  },
  description:
    "Branded short links with powerful privacy-friendly analytics, QR code logo overlays, and custom domains by ClickPath.",
  icons: [{ rel: "icon", url: "/icon.png" }],
  openGraph: {
    siteName: APP_TITLE,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
  alternates: {
    canonical: "./",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <ViewTransitions>
        {env.UMAMI_TRACKING_ID && (
          <Script
            strategy="lazyOnload"
            src={env.UMAMI_URL}
            data-website-id={env.UMAMI_TRACKING_ID}
          />
        )}
        <ReleaseNotesScript />
        <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
          <head>
            <JsonLd data={organizationSchema} />
            <JsonLd data={websiteSchema} />
          </head>
          <MicrosoftClarityScript />
          <CSPostHogProvider>
            <body
              className={cn(
                "min-h-screen bg-background font-sans antialiased",
                fontSans.variable,
                fontDisplay.variable,
                fontHeading.variable,
                fontLogo.variable,
                fontWarmDisplay.variable,
                fontWarmUi.variable,
              )}
            >
              <ThemeProvider
                attribute="class"
                defaultTheme="system"
                enableSystem
                disableTransitionOnChange
              >
                <TRPCReactProvider>{children}</TRPCReactProvider>
                <Toaster />
              </ThemeProvider>
            </body>
          </CSPostHogProvider>
        </html>
      </ViewTransitions>
    </SessionProvider>
  );
}
