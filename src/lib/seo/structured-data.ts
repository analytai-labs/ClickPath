import { PLAN_PRICES_USD } from "@/lib/constants/plan-pricing";

export function resolveCanonical(pathOrUrl: string = ""): string {
  const base = "https://clickpath.analytai.in";
  if (!pathOrUrl || pathOrUrl === "/" || pathOrUrl === "./") return base;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    let url = pathOrUrl
      .replace(/https?:\/\/(?:ishortn\.ink|clk\.path)/g, base)
      .replace(/http:\/\/localhost:3000/g, base);
    if (url !== base && url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    return url;
  }
  const cleanPath = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  const trimmedPath = cleanPath.endsWith("/") && cleanPath !== "/" ? cleanPath.slice(0, -1) : cleanPath;
  return trimmedPath === "/" ? base : `${base}${trimmedPath}`;
}

export function resolveTitle(pageTitle?: string, sectionTitle?: string): string {
  const defaultTitle = "ClickPath — Open-Source URL Shortener & Link Intelligence";
  const rawTitle = pageTitle?.trim() || sectionTitle?.trim() || defaultTitle;
  if (rawTitle.length <= 70) return rawTitle;
  return rawTitle.slice(0, 69).trimEnd() + "…";
}

export function resolveDescription(pageDescription?: string, excerpt?: string): string {
  const defaultDesc =
    "Branded short links with powerful privacy-friendly analytics, QR code logo overlays, and custom domains by ClickPath.";
  const rawDesc = pageDescription?.trim() || excerpt?.trim() || defaultDesc;
  if (rawDesc.length <= 160) return rawDesc;
  return rawDesc.slice(0, 159).trimEnd() + "…";
}

export function resolveOgImage(image?: string): string {
  if (image && image.trim().length > 0) {
    return resolveCanonical(image.trim());
  }
  return resolveCanonical("/og-image.png");
}

export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "ClickPath",
  url: "https://clickpath.analytai.in",
  logo: "https://clickpath.analytai.in/icon.png",
  sameAs: [
    "https://github.com/Shlok-Zanwar/ClickPath",
  ],
  description: "Open-Source URL Shortener & Link Intelligence with powerful analytics, custom domains, and QR codes.",
};

export const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "ClickPath",
  url: "https://clickpath.analytai.in",
  description:
    "Branded short links with powerful privacy-friendly analytics, QR code logo overlays, and custom domains by ClickPath.",
  publisher: {
    "@type": "Organization",
    name: "ClickPath",
    url: "https://clickpath.analytai.in",
  },
};

export const softwareApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "ClickPath",
  url: "https://clickpath.analytai.in",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  // Prices derive from the pricing source of truth so the JSON-LD can't drift.
  offers: [
    {
      "@type": "Offer",
      price: String(PLAN_PRICES_USD.free),
      priceCurrency: "USD",
      name: "Free",
      description: "30 links per month with basic analytics",
    },
    {
      "@type": "Offer",
      price: String(PLAN_PRICES_USD.pro),
      priceCurrency: "USD",
      name: "Pro",
      description: "1,000 links per month with full analytics and custom domains",
    },
    {
      "@type": "Offer",
      price: String(PLAN_PRICES_USD.ultra),
      priceCurrency: "USD",
      name: "Ultra",
      description: "Unlimited links with team collaboration",
    },
  ],
};

export function createFaqSchema(faqs: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function createBreadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: resolveCanonical(item.url),
    })),
  };
}

export function createArticleSchema(article: {
  title: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified: string;
  author: string;
  image?: string;
}) {
  const canonicalUrl = resolveCanonical(article.url);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: resolveTitle(article.title),
    description: resolveDescription(article.description),
    mainEntityOfPage: canonicalUrl,
    url: canonicalUrl,
    datePublished: article.datePublished,
    dateModified: article.dateModified,
    author: {
      "@type": "Person",
      name: article.author,
    },
    publisher: {
      "@type": "Organization",
      name: "ClickPath",
      logo: {
        "@type": "ImageObject",
        url: "https://clickpath.analytai.in/icon.png",
      },
    },
    ...(article.image && { image: resolveOgImage(article.image) }),
  };
}
