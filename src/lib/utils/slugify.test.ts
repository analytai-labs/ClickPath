import { describe, expect, test } from "bun:test";

import { generateRandomSlug, slugifyLinkName } from "./slugify";

describe("generateRandomSlug", () => {
  test("returns lowercase alphanumerics of the requested length", () => {
    for (const length of [1, 7, 20]) {
      expect(generateRandomSlug(length)).toMatch(new RegExp(`^[a-z0-9]{${length}}$`));
    }
  });

  test("does not repeat across calls", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateRandomSlug(7)));
    expect(seen.size).toBe(200);
  });
});

describe("slugifyLinkName", () => {
  test("strips accents and joins words with hyphens", () => {
    expect(slugifyLinkName("Flücérae Spring Sale")).toBe("flucerae-spring-sale");
  });

  test("never exceeds the 20-character alias column", () => {
    expect(slugifyLinkName("a very long product name for the summer").length).toBeLessThanOrEqual(
      20,
    );
  });

  test("pads short names and falls back to random for non-Latin names", () => {
    expect(slugifyLinkName("app")).toMatch(/^app-[a-z0-9]{3,}$/);
    expect(slugifyLinkName("日本語")).toMatch(/^[a-z0-9]{7}$/);
  });
});
