import { describe, expect, test } from "bun:test";

import { resolveShareMetadata } from "./share-metadata";

import type { ShareMetadataSource } from "./share-metadata";

const pharmaData = {
  productName: "Amoxicillin 500mg Capsules",
  composition: "Each capsule contains Amoxicillin 500mg",
  productOverview: "A broad-spectrum antibiotic.",
};

function pharmaPage(overrides: Partial<ShareMetadataSource> = {}): ShareMetadataSource {
  return {
    slug: "amoxilin-500",
    title: null,
    description: null,
    seoTitle: null,
    seoDescription: null,
    templateType: "pharma_product",
    templateData: pharmaData,
    ...overrides,
  };
}

describe("resolveShareMetadata", () => {
  test("derives a pharma page's title and description from its content", () => {
    const meta = resolveShareMetadata(pharmaPage());

    expect(meta.title).toBe("Amoxicillin 500mg Capsules");
    expect(meta.description).toBe("Each capsule contains Amoxicillin 500mg");
    expect(meta.usingAutoTitle).toBe(true);
    expect(meta.usingAutoDescription).toBe(true);
  });

  test("prefers the page's own title and description over derived ones", () => {
    const meta = resolveShareMetadata(
      pharmaPage({ title: "Acme Amox", description: "Our flagship antibiotic." }),
    );

    expect(meta.autoTitle).toBe("Acme Amox");
    expect(meta.autoDescription).toBe("Our flagship antibiotic.");
    // Still "auto" — auto means "follows the content", not "derived from templateData".
    expect(meta.usingAutoTitle).toBe(true);
  });

  test("an SEO override wins but leaves the auto value visible", () => {
    const meta = resolveShareMetadata(
      pharmaPage({ seoTitle: "Buy Amoxicillin Online", seoDescription: "Fast delivery." }),
    );

    expect(meta.title).toBe("Buy Amoxicillin Online");
    expect(meta.description).toBe("Fast delivery.");
    expect(meta.autoTitle).toBe("Amoxicillin 500mg Capsules");
    expect(meta.usingAutoTitle).toBe(false);
    expect(meta.usingAutoDescription).toBe(false);
  });

  test("treats a whitespace-only override as no override", () => {
    const meta = resolveShareMetadata(pharmaPage({ seoTitle: "   ", seoDescription: "\n" }));

    expect(meta.title).toBe("Amoxicillin 500mg Capsules");
    expect(meta.usingAutoTitle).toBe(true);
    expect(meta.usingAutoDescription).toBe(true);
  });

  test("falls back to the handle when there is no title anywhere", () => {
    const meta = resolveShareMetadata(pharmaPage({ templateData: {} }));

    expect(meta.title).toBe("@amoxilin-500");
    expect(meta.description).toBeNull();
  });

  test("uses the overview when a product has no composition yet", () => {
    const meta = resolveShareMetadata(
      pharmaPage({
        templateData: { ...pharmaData, composition: "" },
      }),
    );

    expect(meta.description).toBe("A broad-spectrum antibiotic.");
  });

  test("a bio page derives no description, only its own", () => {
    const bio: ShareMetadataSource = {
      slug: "jane",
      title: "Jane Doe",
      description: null,
      seoTitle: null,
      seoDescription: null,
      templateType: "bio",
      templateData: {},
    };

    expect(resolveShareMetadata(bio).title).toBe("Jane Doe");
    expect(resolveShareMetadata(bio).description).toBeNull();
    expect(resolveShareMetadata({ ...bio, description: "Designer" }).description).toBe("Designer");
  });

  test("tolerates a legacy templateData blob missing fields", () => {
    const meta = resolveShareMetadata(pharmaPage({ templateData: { productName: "Old Row" } }));

    expect(meta.title).toBe("Old Row");
    expect(meta.description).toBeNull();
  });
});
