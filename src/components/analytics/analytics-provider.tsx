import { GoogleAnalytics } from "@next/third-parties/google";
import * as React from "react";

import { CSPostHogProvider } from "@/app/providers";
import { env } from "@/env.mjs";

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {env.NEXT_PUBLIC_GA_ID && <GoogleAnalytics gaId={env.NEXT_PUBLIC_GA_ID} />}
      {env.NEXT_PUBLIC_POSTHOG_KEY ? (
        <CSPostHogProvider>{children}</CSPostHogProvider>
      ) : (
        <>{children}</>
      )}
    </>
  );
}
