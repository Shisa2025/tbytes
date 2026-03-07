"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { QueryLogRow } from "./query-logs";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type CountItem = {
  label: string;
  count: number;
};

const COLORS = ["#3a6fd8", "#f5a623", "#5ec0b9", "#e56054", "#915db7", "#1f2c4d"];

function buildCounts(values: string[]): CountItem[] {
  const map = new Map<string, number>();
  for (const value of values) {
    const key = value || "Unknown";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function HorizontalChart({ title, items, mounted }: { title: string; items: CountItem[]; mounted: boolean }) {
  const rowHeight = 30;
  const chartHeight = Math.max(items.length * rowHeight + 24, 220);

  return (
    <section className="rounded-2xl bg-white p-4 shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
      <h3 className="mb-2 text-[24px] font-semibold text-[#1a2744] lg:text-[18px]">{title}</h3>
      <div style={{ width: "100%", height: chartHeight }}>
        {mounted ? (
          <ResponsiveContainer>
            <BarChart data={items} layout="vertical" margin={{ top: 4, right: 20, left: 0, bottom: 6 }}>
              <CartesianGrid stroke="#eef2f7" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#697688", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="label"
                width={90}
                tick={{ fill: "#32435f", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip cursor={{ fill: "rgba(58,111,216,0.08)" }} />
              <Bar dataKey="count" radius={[0, 7, 7, 0]} barSize={12} maxBarSize={12}>
                {items.map((_, index) => (
                  <Cell key={`${title}-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full rounded-lg bg-[#f4f7fb]" />
        )}
      </div>
    </section>
  );
}

type DashboardClientProps = {
  logs: QueryLogRow[];
  connected: boolean;
  error?: string;
};

export default function DashboardClient({ logs, connected, error }: DashboardClientProps) {
  const [mounted, setMounted] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => setMounted(true), []);

  const selectedMedia = useMemo(() => {
    const value = searchParams.get("media");
    return value && value.trim() ? value : "All";
  }, [searchParams]);

  const cleanLogs = useMemo(
    () =>
      logs.filter(
        (row) =>
          normalize(row.timestamp) !== "timestamp" &&
          normalize(row.verdict) !== "verdict" &&
          normalize(row.media_type) !== "media_type",
      ),
    [logs],
  );

  const filteredLogs = useMemo(() => {
    if (normalize(selectedMedia) === "all") return cleanLogs;
    return cleanLogs.filter((row) => normalize(row.media_type) === normalize(selectedMedia));
  }, [cleanLogs, selectedMedia]);

  const verdictCounts = useMemo(
    () =>
      buildCounts(
        filteredLogs
          .map((row) => row.verdict)
          .filter((verdict) => verdict === "true" || verdict === "false" || verdict === "misleading"),
      ),
    [filteredLogs],
  );

  const languageCounts = useMemo(
    () => buildCounts(filteredLogs.map((row) => row.language)).slice(0, 10),
    [filteredLogs],
  );

  const mediaCounts = useMemo(
    () => buildCounts(filteredLogs.map((row) => row.media_type)),
    [filteredLogs],
  );

  const dailyCounts = useMemo(
    () => buildCounts(filteredLogs.map((row) => row.date)).sort((a, b) => a.label.localeCompare(b.label)),
    [filteredLogs],
  );

  const verdictDonutData = useMemo(
    () => verdictCounts.map((item) => ({ name: item.label, value: item.count })),
    [verdictCounts],
  );

  const tableRows = useMemo(
    () => filteredLogs.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [filteredLogs],
  );

  const totalQueries = filteredLogs.length;
  const trueCount = filteredLogs.filter((row) => row.verdict === "true").length;
  const falseCount = filteredLogs.filter((row) => row.verdict === "false").length;
  const misleadingCount = filteredLogs.filter((row) => row.verdict === "misleading").length;

  if (!connected) {
    return (
      <section className="rounded-2xl bg-white p-6 shadow-[0_1px_8px_rgba(0,0,0,0.08)]">
        <h1 className="mb-3 text-2xl font-bold text-slate-900">TBytes Fact-Check Dashboard</h1>
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
          ClickHouse query failed: {error || "Unknown database error"}
        </p>
      </section>
    );
  }

  if (cleanLogs.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-6 shadow-[0_1px_8px_rgba(0,0,0,0.08)]">
        <h1 className="mb-3 text-2xl font-bold text-slate-900">TBytes Fact-Check Dashboard</h1>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          No data returned from ClickHouse `query_logs`.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-sm font-semibold text-[#9aa5b8]">Dashboard Overview</div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-[#1a2744] px-6 py-5 text-white shadow-[0_1px_6px_rgba(0,0,0,0.2)]">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7a8dae]">Total Queries</div>
          <div className="mt-2 text-5xl font-extrabold leading-none">{totalQueries}</div>
        </div>
        <div className="rounded-2xl bg-white px-6 py-5 shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#9aa3b4]">Verified True</div>
          <div className="mt-2 text-5xl font-extrabold leading-none text-[#1a2744]">{trueCount}</div>
        </div>
        <div className="rounded-2xl bg-white px-6 py-5 shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#9aa3b4]">Verified False</div>
          <div className="mt-2 text-5xl font-extrabold leading-none text-[#1a2744]">{falseCount}</div>
        </div>
        <div className="rounded-2xl bg-white px-6 py-5 shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[#9aa3b4]">Misleading</div>
          <div className="mt-2 text-5xl font-extrabold leading-none text-[#1a2744]">{misleadingCount}</div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl bg-white p-4 shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
          <h3 className="mb-2 text-[24px] font-semibold text-[#1a2744] lg:text-[18px]">Daily Query Volume</h3>
          <div style={{ width: "100%", height: 290 }}>
            {mounted ? (
              <ResponsiveContainer>
                <AreaChart data={dailyCounts} margin={{ top: 10, right: 12, left: 0, bottom: 10 }}>
                  <defs>
                    <linearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3a6fd8" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#3a6fd8" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#eef2f7" />
                  <XAxis dataKey="label" tick={{ fill: "#637088", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#637088", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="count" stroke="#3a6fd8" fill="url(#dailyFill)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full rounded-lg bg-[#f4f7fb]" />
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
          <h3 className="mb-2 text-[24px] font-semibold text-[#1a2744] lg:text-[18px]">Verdict Breakdown</h3>
          <div style={{ width: "100%", height: 290 }}>
            {mounted ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={verdictDonutData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={72}
                    outerRadius={112}
                    paddingAngle={1}
                  >
                    {verdictDonutData.map((_, index) => (
                      <Cell key={`donut-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full rounded-lg bg-[#f4f7fb]" />
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <HorizontalChart title="Language Distribution" items={languageCounts} mounted={mounted} />
        <HorizontalChart title="Media Type Distribution" items={mediaCounts} mounted={mounted} />
      </section>

      <details className="rounded-2xl bg-white p-4 shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
        <summary className="cursor-pointer text-[20px] font-semibold text-[#1a2744] lg:text-[16px]">
          Raw Query Logs
        </summary>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm text-black">
            <thead className="bg-[#f7f9fc] text-[#4f5d75]">
              <tr>
                <th className="px-3 py-2">Timestamp</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Query</th>
                <th className="px-3 py-2">Verdict</th>
                <th className="px-3 py-2">Media</th>
                <th className="px-3 py-2">Response (ms)</th>
                <th className="px-3 py-2">Language</th>
              </tr>
            </thead>
            <tbody className="text-black">
              {tableRows.map((row, index) => (
                <tr key={`${row.timestamp}-${row.user_id}-${index}`} className="border-t border-[#edf1f6]">
                  <td className="px-3 py-2">{row.timestamp}</td>
                  <td className="px-3 py-2">{row.user_id}</td>
                  <td className="max-w-[460px] truncate px-3 py-2" title={row.query}>
                    {row.query}
                  </td>
                  <td className="px-3 py-2">{row.verdict}</td>
                  <td className="px-3 py-2">{row.media_type}</td>
                  <td className="px-3 py-2">{row.response_time_ms}</td>
                  <td className="px-3 py-2">{row.language}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
