import type { Metadata } from "next";

import { JsonLd } from "@/components/seo/json-ld";
import { landingPageCopy } from "@/lib/copy/landing-page";
import {
  createFaqSchema,
  resolveCanonical,
  resolveDescription,
  resolveTitle,
  softwareApplicationSchema,
} from "@/lib/seo/structured-data";

import { CTA } from "./_components/cta";
import { DashboardPreview } from "./_components/dashboard-preview";
import { Faq } from "./_components/faq";
import { Features } from "./_components/features";
import { Footer } from "./_components/footer";
import { Header } from "./_components/header";
import { Hero } from "./_components/hero";
import { Pricing } from "./_components/pricing";
import { QRSection } from "./_components/qr-section";
import { Testimonials } from "./_components/testimonials";

export const metadata: Metadata = {
  title: {
    absolute: resolveTitle("ClickPath — Open-Source URL Shortener & Analytics"),
  },
  description: resolveDescription(
    "Shorten URLs for free with ClickPath. Create branded short links, track clicks and engagement, generate QR codes, and use custom domains.",
  ),
  keywords: [
    "url shortener",
    "free url shortener",
    "link shortener",
    "short url",
    "custom short links",
    "link analytics",
    "click tracking",
    "qr code generator",
    "branded links",
    "clickpath",
  ],
  alternates: {
    canonical: resolveCanonical(""),
  },
  openGraph: {
    title: resolveTitle("ClickPath — Open-Source URL Shortener & Analytics"),
    description: resolveDescription(
      "Shorten URLs for free with ClickPath. Create branded short links, track clicks and engagement, generate QR codes, and use custom domains.",
    ),
    type: "website",
    url: resolveCanonical(""),
  },
  twitter: {
    card: "summary_large_image",
    title: resolveTitle("ClickPath — Open-Source URL Shortener & Analytics"),
    description: resolveDescription(
      "Shorten URLs for free with ClickPath. Create branded short links, track clicks and engagement, generate QR codes, and use custom domains.",
    ),
  },
};

export default function HomePage() {
  return (
    <main style={{ background: "var(--warm-bg)", color: "var(--warm-ink)" }}>
      <JsonLd data={softwareApplicationSchema} />
      <JsonLd data={createFaqSchema(landingPageCopy.faq)} />
      <Header />
      <Hero />
      <DashboardPreview />
      <Features />
      <QRSection />
      <Pricing />
      <Testimonials />
      <Faq />
      <CTA />
      <Footer />
    </main>
  );
}
