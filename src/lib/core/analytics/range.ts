import { endOfYear, startOfMonth, startOfYear, subDays } from "date-fns";

/**
 * The date ranges every analytics surface offers. Links and template pages use
 * the same list so the two dashboards can't drift apart.
 */
export const ANALYTICS_RANGES = [
  "24h",
  "7d",
  "30d",
  "90d",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "all",
] as const;

export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** Ranges a free workspace may request; anything longer is clamped to 7d. */
const FREE_RANGES: readonly AnalyticsRange[] = ["24h", "7d"];

export type ResolvedAnalyticsRange = {
  /** The range actually used — may differ from the request after clamping. */
  range: AnalyticsRange;
  start: Date;
  end: Date;
  /**
   * The equally long window immediately before `start`, for period-over-period
   * deltas. Null for "all" (nothing precedes it) and for calendar ranges that
   * resolve to a non-positive duration.
   */
  previous: { start: Date; end: Date } | null;
};

export function clampRangeToPlan(range: AnalyticsRange, isPaid: boolean): AnalyticsRange {
  return isPaid || FREE_RANGES.includes(range) ? range : "7d";
}

/**
 * Turn a requested range into concrete window boundaries.
 *
 * `now` is injectable so this is testable and so a caller can pin every query in
 * one request to the same instant.
 */
export function resolveAnalyticsRange(
  requested: AnalyticsRange,
  options: { isPaid: boolean; now?: Date },
): ResolvedAnalyticsRange {
  const range = clampRangeToPlan(requested, options.isPaid);
  let end = options.now ? new Date(options.now) : new Date();
  let start: Date;

  switch (range) {
    case "24h":
      start = subDays(end, 1);
      break;
    case "7d":
      start = subDays(end, 7);
      break;
    case "30d":
      start = subDays(end, 30);
      break;
    case "90d":
      start = subDays(end, 90);
      break;
    case "this_month":
      start = startOfMonth(end);
      break;
    case "last_month":
      start = startOfMonth(subDays(end, 30));
      // Day 0 of the current month is the last day of the previous one.
      end = new Date(end);
      end.setDate(0);
      break;
    case "this_year":
      start = startOfYear(end);
      break;
    case "last_year":
      start = startOfYear(subDays(end, 365));
      end = endOfYear(subDays(end, 365));
      break;
    case "all":
      start = new Date(0);
      break;
    default:
      start = subDays(end, 7);
  }

  const windowMs = end.getTime() - start.getTime();
  const hasPrevious = range !== "all" && windowMs > 0;

  return {
    range,
    start,
    end,
    previous: hasPrevious ? { start: new Date(start.getTime() - windowMs), end: start } : null,
  };
}
