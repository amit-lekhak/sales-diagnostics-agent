'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { money, moneyAxisTick, num } from '@/lib/format';
import { ChartFrame } from './ChartFrame';

export function BreakdownChart({
  data,
}: {
  data: { label: string; net_sales: number }[];
}) {
  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-(--muted)">
        No breakdown rows.
      </div>
    );
  }
  return (
    <ChartFrame heightClass="h-56">
      <ResponsiveContainer>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
        >
          <CartesianGrid stroke="#e7e0d4" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => moneyAxisTick(Number(v))}
          />
          <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => money(Number(v))} />
          <Bar
            dataKey="net_sales"
            fill="#0f766e"
            name="Net sales"
            radius={[0, 3, 3, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function WaterfallChart({ data }: { data: { label: string; delta: number }[] }) {
  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-(--muted)">
        No period change to plot.
      </div>
    );
  }
  const rows = data.reduce<
    { label: string; base: number; rise: number; fall: number; cursor: number }[]
  >((acc, d) => {
    const cursor = acc.length ? acc[acc.length - 1]!.cursor : 0;
    const start = d.delta >= 0 ? cursor : cursor + d.delta;
    acc.push({
      label: d.label,
      base: start,
      rise: d.delta > 0 ? d.delta : 0,
      fall: d.delta < 0 ? Math.abs(d.delta) : 0,
      cursor: cursor + d.delta,
    });
    return acc;
  }, []);
  return (
    <ChartFrame heightClass="h-56">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="#e7e0d4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => moneyAxisTick(Number(v))}
          />
          <Tooltip
            formatter={(v, name) =>
              name === 'base'
                ? ['', '']
                : [money(Number(v)), name === 'rise' ? 'up' : 'down']
            }
          />
          <Bar dataKey="base" stackId="a" fill="transparent" />
          <Bar dataKey="rise" stackId="a" fill="#0f766e" />
          <Bar dataKey="fall" stackId="a">
            {rows.map((r) => (
              <Cell key={r.label} fill="#b45309" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function RunsChart({
  data,
}: {
  data: { day: string; runs: number; errors: number }[];
}) {
  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-(--muted)">
        No runs in the last 7 days.
      </div>
    );
  }
  return (
    <ChartFrame heightClass="h-56">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="#e7e0d4" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="runs" fill="#0f766e" name="Runs" />
          <Bar dataKey="errors" fill="#b45309" name="Errors" />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function VolumeSalesChart({
  data,
}: {
  data: { day: string; net_sales: number; units: number }[];
}) {
  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-(--muted)">
        No series in this range.
      </div>
    );
  }
  return (
    <ChartFrame heightClass="h-64">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="#e7e0d4" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis
            yAxisId="sales"
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => moneyAxisTick(Number(v))}
          />
          <YAxis yAxisId="units" orientation="right" tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(v, name) =>
              name === 'Net sales' ? money(Number(v)) : num(Number(v))
            }
          />
          <Bar yAxisId="sales" dataKey="net_sales" fill="#0f766e" name="Net sales" />
          <Bar yAxisId="units" dataKey="units" fill="#d6d3d1" name="Units" />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
