import type { Metadata } from "next";

import { JsonLd } from "@/components/seo/json-ld";
import {
  createBreadcrumbSchema,
  resolveCanonical,
  resolveDescription,
  resolveTitle,
} from "@/lib/seo/structured-data";

import { Footer } from "../_components/footer";
import { Header } from "../_components/header";
import { AbuseReportForm } from "./abuse-report-form";

export const metadata: Metadata = {
  title: resolveTitle("Report Abuse — ClickPath"),
  description: resolveDescription(
    "Report a short link that is being used for phishing, malware, spam, or other abuse. ClickPath reviews every report and acts on links that violate our policies.",
  ),
  alternates: {
    canonical: resolveCanonical("/abuse"),
  },
  openGraph: {
    title: resolveTitle("Report Abuse — ClickPath"),
    description: resolveDescription(
      "Report a short link that is being used for phishing, malware, spam, or other abuse.",
    ),
    type: "website",
    url: resolveCanonical("/abuse"),
  },
};

export default function AbusePage() {
  return (
    <main style={{ background: "var(--warm-bg)", color: "var(--warm-ink)" }}>
      <JsonLd
        data={createBreadcrumbSchema([
          { name: "Home", url: resolveCanonical("/") },
          { name: "Report Abuse", url: resolveCanonical("/abuse") },
        ])}
      />
      <Header />

      <section className="warm-subhero">
        <div className="warm-container">
          <div className="warm-eyebrow" style={{ marginBottom: 24 }}>
            <span className="warm-eyebrow-dot" />
            Trust &amp; Safety
          </div>
          <h1 className="warm-display" style={{ margin: 0, fontSize: "clamp(44px, 11vw, 104px)" }}>
            Report <em style={{ fontStyle: "italic", color: "var(--warm-accent)" }}>abuse</em>.
          </h1>
          <p
            style={{
              marginTop: 20,
              maxWidth: 560,
              fontSize: 15,
              lineHeight: 1.6,
              color: "var(--warm-mute)",
            }}
          >
            Found a short link being used for phishing, malware, spam, or impersonation? Let us
            know. We review every report and disable links that violate our policies.
          </p>
        </div>
      </section>

      <section style={{ padding: "16px 0 120px" }}>
        <div className="warm-container" style={{ maxWidth: 620 }}>
          <AbuseReportForm />
          <p
            style={{
              marginTop: 20,
              fontSize: 13,
              color: "var(--warm-mute)",
              lineHeight: 1.6,
            }}
          >
            For urgent legal matters, you can also reach us at{" "}
            <a
              href="mailto:support@clickpath.analytai.in"
              style={{
                color: "var(--warm-ink-soft)",
                textDecoration: "underline",
                textUnderlineOffset: 2,
              }}
            >
              support@clickpath.analytai.in
            </a>
            .
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
