"use client";

import { IconClick, IconEye, IconTrendingUp, IconUsers, IconWorld } from "@tabler/icons-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import { Card } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatChartDate } from "@/lib/utils";
import { api } from "@/trpc/react";

import { BarList } from "../../../analytics/[alias]/_components/bar-list";
import { CountriesAndCitiesStats } from "../../../analytics/[alias]/_components/countries-and-cities-stats";
import { QuickInfoCard } from "../../../analytics/[alias]/_components/quick-info-card";
import { RangeSelector } from "../../../analytics/[alias]/_components/range-selector";
import { ReferrerStats } from "../../../analytics/[alias]/_components/referrers";
import { UserAgentStats } from "../../../analytics/[alias]/_components/user-agent-stats";

import type { Plan } from "@/lib/billing/plans";
import type { AnalyticsRange } from "@/lib/core/analytics/range";
import type { RouterOutputs } from "@/trpc/shared";
import type { TemplatePageData } from "./editor-types";

// react-simple-maps pulls in a large topology and touches the DOM on mount.
const WorldMapHeatmap = dynamic(
  () => import("../../../analytics/[alias]/_components/world-map-heatmap"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[320px] rounded-xl" />,
  },
);

type Analytics = RouterOutputs["templatePage"]["getAnalytics"];

const chartConfig = {
  views: { label: "Views", color: "#2563eb" },
  uniqueViews: { label: "Unique", color: "#93c5fd" },
} satisfies ChartConfig;

/** Percent change, or null when there is no meaningful baseline to compare to. */
function percentGrowth(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function toRecords(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([name, clicks]) => ({ name, clicks }))
    .sort((a, b) => b.clicks - a.clicks);
}

/**
 * Analytics for one template page.
 *
 * A template page is a link with a page attached, so this shows the same
 * dimensions the per-link dashboard does and reuses its components outright —
 * every breakdown here is already recorded on each view.
 */
export function AnalyticsPanel({ page, plan }: { page: TemplatePageData; plan: Plan }) {
  const [range, setRange] = useState<AnalyticsRange>("7d");
  const isPro = plan !== "free";

  const { data, isLoading, isFetching } = api.templatePage.getAnalytics.useQuery(
    { id: page.id, range },
    {
      // Lazy by design (this tab unmounts when inactive). Keep the previous
      // range's data on screen while a new range loads so switching never
      // flashes a skeleton, and don't refetch aggressively.
      keepPreviousData: true,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-foreground">
            Analytics
          </h3>
          <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
            {data
              ? `${data.lifetimeViews.toLocaleString()} views since this page was created`
              : "Everyone who opened this page"}
          </p>
        </div>
        <div className={cn("transition-opacity", isFetching && "opacity-60")}>
          <RangeSelector
            isProPlan={isPro}
            initialRange={range}
            onRangeChange={(next) => setRange(next as AnalyticsRange)}
          />
        </div>
      </div>

      {isLoading || !data ? <AnalyticsSkeleton /> : <Report data={data} isPro={isPro} />}
    </div>
  );
}

function Report({ data, isPro }: { data: Analytics; isPro: boolean }) {
  const countryRecords = useMemo(() => toRecords(data.viewsPerCountry), [data.viewsPerCountry]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickInfoCard
          title="Views"
          value={data.views}
          icon={<IconEye size={15} stroke={1.5} />}
          growth={percentGrowth(data.views, data.previous?.views)}
        />
        <QuickInfoCard
          title="Unique visitors"
          value={data.uniqueViews}
          icon={<IconUsers size={15} stroke={1.5} />}
          growth={percentGrowth(data.uniqueViews, data.previous?.uniqueViews)}
        />
        <QuickInfoCard
          title="Top country"
          value={data.topCountry}
          icon={<IconWorld size={15} stroke={1.5} />}
        />
        <QuickInfoCard
          title="Top referrer"
          value={data.topReferrer}
          icon={<IconTrendingUp size={15} stroke={1.5} />}
        />
      </div>

      <ViewsChart viewsPerDay={data.viewsPerDay} uniqueViewsPerDay={data.uniqueViewsPerDay} />

      <div className="grid gap-5 lg:grid-cols-2">
        <CountriesAndCitiesStats
          countriesRecords={data.viewsPerCountry}
          citiesRecords={data.viewsPerCity}
          continentsRecords={data.viewsPerContinent}
          proUser={isPro}
          totalClicks={data.views}
        />
        <UserAgentStats
          clicksPerDevice={data.viewsPerDevice}
          clicksPerOS={data.viewsPerOS}
          clicksPerBrowser={data.viewsPerBrowser}
          clicksPerModel={data.viewsPerModel}
          totalClicks={data.views}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ReferrerStats referers={data.referers} totalClicks={data.views} />
        {/* Only templates whose content is link blocks have clicks to attribute. */}
        {data.tracksBlockClicks && <BlockClicks data={data} />}
      </div>

      {isPro && countryRecords.length > 0 && (
        <Card className="overflow-hidden rounded-xl border-neutral-200 shadow-none dark:border-border">
          <div className="border-b border-neutral-100 px-5 pb-4 pt-5 dark:border-border/50">
            <h3 className="text-[14px] font-semibold tracking-tight text-neutral-900 dark:text-foreground">
              Where your visitors are
            </h3>
            <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
              Views by country across the selected range
            </p>
          </div>
          <WorldMapHeatmap data={data.viewsPerCountry} />
        </Card>
      )}
    </>
  );
}

function BlockClicks({ data }: { data: Analytics }) {
  const records = data.perBlock.map((b) => ({ name: b.title, clicks: b.clicks }));

  return (
    <BarList.BarListTitle
      title="Link clicks"
      description={`${data.totalClicks} clicks · ${(data.ctr * 100).toFixed(1)}% of views`}
    >
      {records.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-neutral-400 dark:text-neutral-500">
          No link clicks in this range yet.
        </p>
      ) : (
        <BarList records={records} totalClicks={data.totalClicks} color="green" />
      )}
    </BarList.BarListTitle>
  );
}

function ViewsChart({
  viewsPerDay,
  uniqueViewsPerDay,
}: {
  viewsPerDay: Record<string, number>;
  uniqueViewsPerDay: Record<string, number>;
}) {
  const chartData = useMemo(() => {
    const entries = Object.entries(viewsPerDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, views]) => ({ date, views, uniqueViews: uniqueViewsPerDay[date] ?? 0 }));
    // A single point renders as a flat sliver — pad with a leading zero day.
    if (entries.length === 1 && entries[0]) {
      const prev = new Date(new Date(entries[0].date).getTime() - 86400000)
        .toISOString()
        .split("T")[0]!;
      return [{ date: prev, views: 0, uniqueViews: 0 }, ...entries];
    }
    return entries;
  }, [viewsPerDay, uniqueViewsPerDay]);

  return (
    <Card className="overflow-hidden rounded-xl border-neutral-200 shadow-none dark:border-border">
      <div className="border-b border-neutral-100 px-5 pb-4 pt-5 dark:border-border/50">
        <h3 className="text-[14px] font-semibold tracking-tight text-neutral-900 dark:text-foreground">
          Views over time
        </h3>
        <p className="text-[12px] text-neutral-400 dark:text-neutral-500">
          Total and unique views across the selected range
        </p>
      </div>
      <div className="px-2 pb-5 pt-4 sm:px-5">
        {chartData.length === 0 ? (
          <div className="flex h-56 items-center justify-center text-[13px] text-neutral-400 dark:text-neutral-500">
            No views in this range yet.
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="fillTplViews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-views)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-views)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="fillTplUnique" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-uniqueViews)" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="var(--color-uniqueViews)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={formatChartDate}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => formatChartDate(String(value))}
                    indicator="dot"
                  />
                }
              />
              <Area
                dataKey="views"
                type="natural"
                fill="url(#fillTplViews)"
                stroke="var(--color-views)"
              />
              <Area
                dataKey="uniqueViews"
                type="natural"
                fill="url(#fillTplUnique)"
                stroke="var(--color-uniqueViews)"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </div>
    </Card>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {["views", "unique", "country", "referrer"].map((key) => (
          <Skeleton key={key} className="h-[84px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
