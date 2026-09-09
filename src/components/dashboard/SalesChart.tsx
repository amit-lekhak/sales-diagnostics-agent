'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { money, moneyAxisTick } from '@/lib/format';
import { ChartFrame } from './ChartFrame';

export function SalesChart({ data }: { data: { day: string; net_sales: number }[] }) {
  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-(--muted)">
        No sales in this range.
      </div>
    );
  }
  return (
    <ChartFrame heightClass="h-72">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="#e7e0d4" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => moneyAxisTick(Number(v))}
          />
          <Tooltip formatter={(v) => money(Number(v))} />
          <Bar
            dataKey="net_sales"
            fill="#0f766e"
            name="Net sales"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
