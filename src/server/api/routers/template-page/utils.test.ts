import { describe, expect, test } from "bun:test";

import { RESERVED_TEMPLATE_SLUGS, assertSlugAllowed } from "./utils";

describe("reserved template page slugs", () => {
  test("excludes the /p route prefix and core app routes", () => {
    for (const slug of ["p", "api", "trpc", "dashboard", "auth", "admin", "abuse"]) {
      expect(RESERVED_TEMPLATE_SLUGS.has(slug)).toBe(true);
    }
  });

  test("assertSlugAllowed rejects reserved handles (case-insensitively)", () => {
    expect(() => assertSlugAllowed("dashboard")).toThrow();
    expect(() => assertSlugAllowed("API")).toThrow();
    expect(() => assertSlugAllowed("Admin")).toThrow();
  });

  test("assertSlugAllowed accepts normal handles", () => {
    expect(() => assertSlugAllowed("janedoe")).not.toThrow();
    expect(() => assertSlugAllowed("my-links")).not.toThrow();
    expect(() => assertSlugAllowed("acme_co")).not.toThrow();
  });
});
