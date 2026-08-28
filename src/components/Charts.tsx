"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface MetricPoint {
  t: string;
  rps: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  errors: number;
  timeouts: number;
  successes: number;
  failures: number;
}

const axis = { stroke: "rgb(var(--muted))", fontSize: 11 };

export function RpsChart({ data }: { data: MetricPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
        <XAxis dataKey="t" {...axis} />
        <YAxis {...axis} />
        <Tooltip
          contentStyle={{
            background: "rgb(var(--surface))",
            border: "1px solid rgb(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="rps"
          stroke="rgb(var(--brand))"
          fill="rgb(var(--brand))"
          fillOpacity={0.15}
          name="Requests/sec"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LatencyChart({ data }: { data: MetricPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
        <XAxis dataKey="t" {...axis} />
        <YAxis {...axis} unit="ms" />
        <Tooltip
          contentStyle={{
            background: "rgb(var(--surface))",
            border: "1px solid rgb(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Line type="monotone" dataKey="latencyP50" stroke="#10b981" dot={false} name="p50" />
        <Line type="monotone" dataKey="latencyP95" stroke="#f59e0b" dot={false} name="p95" />
        <Line type="monotone" dataKey="latencyP99" stroke="#ef4444" dot={false} name="p99" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ErrorsChart({ data }: { data: MetricPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
        <XAxis dataKey="t" {...axis} />
        <YAxis {...axis} />
        <Tooltip
          contentStyle={{
            background: "rgb(var(--surface))",
            border: "1px solid rgb(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Area type="monotone" dataKey="errors" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} name="Errors" />
        <Area type="monotone" dataKey="timeouts" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} name="Timeouts" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
