import { describe, expect, test } from "bun:test";

import {
  TEMPLATE_PATH_PREFIXES,
  isPathPrefixAllowed,
  templatePageDisplayUrl,
  templatePagePreviewPath,
  templatePageUrl,
} from "./page-url";

const ID = "5f8d0d55b54764421b7156c9";

describe("templatePageUrl", () => {
  test("builds /<prefix>/<slug> on a custom share domain, for each prefix", () => {
    expect(templatePageUrl({ slug: "spring", shareDomain: "brand.com", pathPrefix: "p" })).toBe(
      "https://brand.com/p/spring",
    );
    expect(
      templatePageUrl({ slug: ID, shareDomain: "old-domain.com", pathPrefix: "productdetails" }),
    ).toBe(`https://old-domain.com/productdetails/${ID}`);
  });

  test("defaults to /p when the page has no prefix", () => {
    expect(templatePageUrl({ slug: "spring", shareDomain: "brand.com" })).toBe(
      "https://brand.com/p/spring",
    );
  });

  test("the platform domain ignores the prefix and serves /p only", () => {
    expect(templatePageUrl({ slug: ID, shareDomain: null, pathPrefix: "productdetails" })).toBe(
      `https://clickpath.analytai.in/p/${ID}`,
    );
    expect(
      templatePageUrl({ slug: ID, shareDomain: "clk.path", pathPrefix: "productdetails" }),
    ).toBe(`https://clk.path/p/${ID}`);
  });

  test("a root binding wins over the prefix", () => {
    expect(
      templatePageUrl({
        slug: ID,
        shareDomain: "brand.com",
        customDomain: "brand.com",
        pathPrefix: "productdetails",
      }),
    ).toBe("https://brand.com");
  });

  test("display URL drops the scheme; the dashboard preview stays on the platform /p path", () => {
    const page = { slug: ID, shareDomain: "old-domain.com", pathPrefix: "productdetails" };
    expect(templatePageDisplayUrl(page)).toBe(`old-domain.com/productdetails/${ID}`);
    expect(templatePagePreviewPath(page)).toBe(`/p/${ID}`);
  });
});

describe("isPathPrefixAllowed", () => {
  test("every prefix is allowed on a custom domain", () => {
    for (const prefix of TEMPLATE_PATH_PREFIXES) {
      expect(isPathPrefixAllowed(prefix, "brand.com")).toBe(true);
    }
  });

  test("only /p is allowed without a custom domain", () => {
    expect(isPathPrefixAllowed("p", null)).toBe(true);
    expect(isPathPrefixAllowed("productdetails", null)).toBe(false);
    expect(isPathPrefixAllowed("productdetails", "clickpath.analytai.in")).toBe(false);
  });

  test("prefixes outside the fixed list are never allowed", () => {
    expect(isPathPrefixAllowed("dashboard", "brand.com")).toBe(false);
    expect(isPathPrefixAllowed("l", "brand.com")).toBe(false);
  });
});
