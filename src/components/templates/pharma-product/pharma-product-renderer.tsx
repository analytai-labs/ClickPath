// Shared, presentational renderer for the Pharma Product template.
// Used by BOTH the builder's live preview and the public /p/[slug] page
// so the two can never drift. No hooks → renders fine as a server component.

import type { CSSProperties } from "react";
import type { PharmaProductData } from "@/components/templates/types";
import { type ResolvedPharmaTheme, resolvePharmaTheme } from "./pharma-product-theme";
import { PharmaProductCarousel } from "./pharma-product-carousel";

const ENTER =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both";

type Props = {
  data: PharmaProductData;
  removeBranding: boolean;
  themePreset?: string | null;
  heightClass?: string;
};

export function PharmaProductRenderer({
  data,
  removeBranding,
  themePreset,
  heightClass = "min-h-full",
}: Props) {
  const t = resolvePharmaTheme(themePreset);

  return (
    <div
      className={`flex flex-col ${heightClass}`}
      style={{ background: t.background, color: t.textColor, fontFamily: "system-ui, sans-serif" }}
    >
      {/* Hero */}
      <div style={{ background: t.accentColor }} className="px-5 pb-6 pt-8">
        <div
          className={`mx-auto max-w-md ${ENTER}`}
          style={{ animationDelay: "0ms", animationDuration: "450ms" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest opacity-80" style={{ color: t.accentTextColor }}>
            Product Information
          </p>
          <h1
            className="mt-1 text-2xl font-bold leading-snug"
            style={{ color: t.accentTextColor }}
          >
            {data.productName || "Product Name"}
          </h1>
          {data.composition && (
            <p className="mt-1.5 text-sm opacity-85" style={{ color: t.accentTextColor }}>
              {data.composition}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 px-5 pb-12 pt-5">
        <div className="mx-auto max-w-md space-y-5">
          {/* Product Images Carousel */}
          {data.productImages.length > 0 && (
            <div
              className={`${ENTER}`}
              style={{ animationDelay: "70ms", animationDuration: "450ms" }}
            >
              <PharmaProductCarousel
                images={data.productImages}
                productName={data.productName}
                t={t}
              />
            </div>
          )}

          {/* Product Overview */}
          {data.productOverview && (
            <Section title="Product Overview" t={t} delay={140}>
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: t.mutedColor }}>
                {data.productOverview}
              </p>
            </Section>
          )}

          {/* Marketed / Manufactured */}
          {(data.marketed.name || data.manufactured.name) && (
            <div
              className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${ENTER}`}
              style={{ animationDelay: "210ms", animationDuration: "450ms" }}
            >
              {data.marketed.name && (
                <InfoCard title="Marketed By" t={t}>
                  <p className="text-[13px] font-medium">{data.marketed.name}</p>
                  {data.marketed.address && (
                    <p className="mt-0.5 text-xs leading-snug" style={{ color: t.mutedColor }}>
                      {data.marketed.address}
                    </p>
                  )}
                </InfoCard>
              )}
              {data.manufactured.name && (
                <InfoCard title="Manufactured By" t={t}>
                  <p className="text-[13px] font-medium">{data.manufactured.name}</p>
                  {data.manufactured.address && (
                    <p className="mt-0.5 text-xs leading-snug" style={{ color: t.mutedColor }}>
                      {data.manufactured.address}
                    </p>
                  )}
                </InfoCard>
              )}
            </div>
          )}

          {/* Documents */}
          {data.documents.filter(d => d.imageUrl).length > 0 && (
            <Section title="Documents & Literature" t={t} delay={280}>
              <div className="grid grid-cols-2 gap-3">
                {data.documents.filter(d => d.imageUrl).map((doc, i) => (
                  <div
                    key={`doc-${i}`}
                    className="rounded-xl overflow-hidden"
                    style={{ border: `1px solid ${t.borderColor}` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={doc.imageUrl}
                      alt={doc.name}
                      className="h-24 w-full object-cover"
                    />
                    <p
                      className="px-2 py-1.5 text-[11px] font-medium text-center truncate"
                      style={{ background: t.cardBackground }}
                    >
                      {doc.name}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Contact */}
          {(data.contact.name || data.contact.whatsapp || data.contact.email) && (
            <Section title="Contact" t={t} delay={350}>
              <div className="space-y-2">
                {data.contact.name && (
                  <p className="text-sm font-medium">{data.contact.name}</p>
                )}
                <div className="flex flex-col gap-2">
                  {data.contact.whatsapp && (
                    <ContactButton
                      href={`https://wa.me/${data.contact.whatsapp.replace(/\D/g, "")}`}
                      t={t}
                      label={`WhatsApp: ${data.contact.whatsapp}`}
                    />
                  )}
                  {data.contact.email && (
                    <ContactButton
                      href={`mailto:${data.contact.email}`}
                      t={t}
                      label={data.contact.email}
                    />
                  )}
                </div>
              </div>
            </Section>
          )}
        </div>

        {/* Branding */}
        {!removeBranding && (
          <div className="mt-10 text-center">
            <a
              href="https://clickpath.analytai.in"
              target="_blank"
              rel="noreferrer"
              className="text-xs opacity-50 transition-opacity hover:opacity-80"
              style={{ color: t.mutedColor }}
            >
              Made with ClickPath
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  t,
  delay = 0,
  children,
}: {
  title: string;
  t: ResolvedPharmaTheme;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl p-4 ${ENTER}`}
      style={{
        background: t.cardBackground,
        border: `1px solid ${t.borderColor}`,
        animationDelay: `${delay}ms`,
        animationDuration: "450ms",
      } as CSSProperties}
    >
      <h2
        className="mb-2.5 text-[11px] font-bold uppercase tracking-wider"
        style={{ color: t.mutedColor }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function InfoCard({
  title,
  t,
  children,
}: {
  title: string;
  t: ResolvedPharmaTheme;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: t.cardBackground, border: `1px solid ${t.borderColor}` }}
    >
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: t.mutedColor }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function ContactButton({
  href,
  label,
  t,
}: {
  href: string;
  label: string;
  t: ResolvedPharmaTheme;
}) {
  return (
    <a
      href={href}
      className="block w-full rounded-xl px-4 py-3 text-center text-sm font-medium shadow-sm transition-transform hover:-translate-y-0.5"
      style={{ background: t.accentColor, color: t.accentTextColor }}
    >
      {label}
    </a>
  );
}
