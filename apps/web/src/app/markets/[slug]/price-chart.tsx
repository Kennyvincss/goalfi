"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface PricePoint { t: number; yes: number }

export function PriceChart({ points }: { points: PricePoint[] }) {
  if (points.length < 2)
    return <div className="grid h-56 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">Price history appears after a few trades.</div>;
  const data = points.map((p) => ({ t: p.t, yes: Math.round(p.yes * 1000) / 10 }));
  const multiDay = points[points.length - 1]!.t - points[0]!.t > 36 * 3_600_000;
  const tick = (t: number) => new Date(t).toLocaleString("en-US", multiDay ? { month: "short", day: "numeric" } : { hour: "numeric", minute: "2-digit" });
  return (
    <div className="h-56 w-full" role="img" aria-label={`YES probability over time, now ${data[data.length - 1]!.yes}%`}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="yesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--yes)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--yes)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
            formatter={(v) => [`${v}%`, "YES"]}
          />
          <Area type="stepAfter" dataKey="yes" stroke="var(--yes)" strokeWidth={2} fill="url(#yesFill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
