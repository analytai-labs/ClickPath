import { describe, expect, test } from "bun:test";

import { ANALYTICS_RANGES, clampRangeToPlan, resolveAnalyticsRange } from "./range";

// A fixed instant mid-month/mid-year, so calendar ranges have room on both sides.
const NOW = new Date("2026-07-15T12:00:00.000Z");

const days = (n: number) => n * 24 * 60 * 60 * 1000;

describe("clampRangeToPlan", () => {
  test("a paid workspace keeps every range", () => {
    for (const range of ANALYTICS_RANGES) {
      expect(clampRangeToPlan(range, true)).toBe(range);
    }
  });

  test("a free workspace keeps only the short ranges", () => {
    expect(clampRangeToPlan("24h", false)).toBe("24h");
    expect(clampRangeToPlan("7d", false)).toBe("7d");
    for (const range of ["30d", "90d", "this_month", "last_month", "this_year", "all"] as const) {
      expect(clampRangeToPlan(range, false)).toBe("7d");
    }
  });
});

describe("resolveAnalyticsRange", () => {
  test("rolling ranges span exactly their length", () => {
    for (const [range, length] of [
      ["24h", 1],
      ["7d", 7],
      ["30d", 30],
      ["90d", 90],
    ] as const) {
      const { start, end } = resolveAnalyticsRange(range, { isPaid: true, now: NOW });
      expect(end.getTime() - start.getTime()).toBe(days(length));
    }
  });

  test("the previous window is the same length and ends where the current one starts", () => {
    const { start, previous } = resolveAnalyticsRange("30d", { isPaid: true, now: NOW });

    expect(previous).not.toBeNull();
    expect(previous!.end.getTime()).toBe(start.getTime());
    expect(previous!.end.getTime() - previous!.start.getTime()).toBe(days(30));
  });

  test("'all' starts at the epoch and has nothing to compare against", () => {
    const { start, previous } = resolveAnalyticsRange("all", { isPaid: true, now: NOW });

    expect(start.getTime()).toBe(0);
    expect(previous).toBeNull();
  });

  test("'this_month' starts on the first of the current month", () => {
    const { start, end } = resolveAnalyticsRange("this_month", { isPaid: true, now: NOW });

    expect(start.getMonth()).toBe(NOW.getMonth());
    expect(start.getDate()).toBe(1);
    expect(end.getTime()).toBe(NOW.getTime());
  });

  test("'last_month' ends on the last day of the previous month", () => {
    const { start, end } = resolveAnalyticsRange("last_month", { isPaid: true, now: NOW });

    // June 2026 — start in June, end on its last day.
    expect(start.getMonth()).toBe(5);
    expect(end.getMonth()).toBe(5);
    expect(end.getDate()).toBe(30);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  test("'last_year' covers the whole previous year", () => {
    const { start, end } = resolveAnalyticsRange("last_year", { isPaid: true, now: NOW });

    expect(start.getFullYear()).toBe(2025);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
    expect(end.getFullYear()).toBe(2025);
    expect(end.getMonth()).toBe(11);
    expect(end.getDate()).toBe(31);
  });

  test("clamps a free workspace and reports the range it actually used", () => {
    const resolved = resolveAnalyticsRange("90d", { isPaid: false, now: NOW });

    expect(resolved.range).toBe("7d");
    expect(resolved.end.getTime() - resolved.start.getTime()).toBe(days(7));
  });

  test("never returns an inverted window", () => {
    for (const range of ANALYTICS_RANGES) {
      const { start, end } = resolveAnalyticsRange(range, { isPaid: true, now: NOW });
      expect(end.getTime()).toBeGreaterThanOrEqual(start.getTime());
    }
  });

  test("does not mutate the caller's `now`", () => {
    const now = new Date(NOW);
    resolveAnalyticsRange("last_month", { isPaid: true, now });
    expect(now.getTime()).toBe(NOW.getTime());
  });
});
