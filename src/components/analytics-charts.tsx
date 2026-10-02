"use client";

/**
 * Recharts lives here and nowhere else on the Analytics page.
 *
 * Imported statically it added ~107 KB gzipped to that route's first load, and
 * the charts sit below the KPI cards — nobody reads them before the page has
 * painted. Keeping the whole charting stack behind this module lets the page
 * load its numbers first and stream the plots in after.
 */

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

const timelineConfig = {
  pageViews: { label: "Page views", color: "#f97316" },
  events: { label: "Events", color: "#0f172a" },
  users: { label: "Users", color: "#64748b" },
} satisfies ChartConfig;

const moduleConfig = {
  count: { label: "Events", color: "#f97316" },
} satisfies ChartConfig;

export type TimelinePoint = {
  bucket: string;
  events: number;
  pageViews: number;
  users: number;
  label: string;
};

export type ModulePoint = { name: string; count: number };

export function ActivityTimelineChart({ data }: { data: TimelinePoint[] }) {
  return (
    <ChartContainer config={timelineConfig} className="h-full w-full">
      <AreaChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} fontSize={10} />
        <YAxis tickLine={false} axisLine={false} width={28} fontSize={10} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          type="monotone"
          dataKey="pageViews"
          stroke="var(--color-pageViews)"
          fill="var(--color-pageViews)"
          fillOpacity={0.2}
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="events"
          stroke="var(--color-events)"
          fill="var(--color-events)"
          fillOpacity={0.08}
          strokeWidth={1.5}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function TopModulesChart({ data }: { data: ModulePoint[] }) {
  return (
    <ChartContainer config={moduleConfig} className="h-full w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} fontSize={10} />
        <YAxis
          type="category"
          dataKey="name"
          width={88}
          tickLine={false}
          axisLine={false}
          fontSize={10}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
