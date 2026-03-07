"use client";

import { useState } from "react";

type DbAction = "ping" | "recent" | "risks" | "verdicts";

type QueryItem = {
  timestamp: string;
  query: string;
  verdict: string;
  language?: string;
  media_type?: string;
};

type VerdictItem = {
  verdict: string;
  count: number;
};

type PingData = {
  message: string;
  value: number;
  endpoint: string;
  database: string;
};

type RecentData = {
  updatedAt?: string;
  items: QueryItem[];
};

type VerdictData = {
  updatedAt?: string;
  counts: VerdictItem[];
};

type ResultState =
  | { action: "ping"; data: PingData }
  | { action: "recent" | "risks"; data: RecentData }
  | { action: "verdicts"; data: VerdictData }
  | null;

function formatTime(raw?: string) {
  if (!raw) return "-";
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return raw;
  return new Date(ts).toLocaleString("en-SG", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function trimText(text: string, len = 100) {
  const t = text.trim();
  if (t.length <= len) return t;
  return `${t.slice(0, len)}...`;
}

const BUTTONS: Array<{ action: DbAction; label: string; hint: string }> = [
  { action: "ping", label: "Ping DB", hint: "Test ClickHouse connectivity" },
  { action: "recent", label: "Latest 10", hint: "Read latest query logs" },
  { action: "risks", label: "Risk Signals", hint: "Read false/misleading rows" },
  { action: "verdicts", label: "Verdict Counts", hint: "Read verdict distribution" },
];

export default function DatabasePage() {
  const [running, setRunning] = useState<DbAction | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResultState>(null);

  async function runAction(action: DbAction) {
    setRunning(action);
    setError("");

    try {
      const response = await fetch("/api/database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        setResult(null);
        setError(payload?.error || "Database action failed.");
        return;
      }

      if (action === "ping") {
        setResult({ action, data: payload.data as PingData });
        return;
      }
      if (action === "recent" || action === "risks") {
        setResult({ action, data: payload.data as RecentData });
        return;
      }
      setResult({ action, data: payload.data as VerdictData });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setResult(null);
      setError(message || "Unexpected error while calling database API.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <section className="rounded-2xl border border-[#d5ddeb] bg-white p-6 shadow-[0_12px_24px_rgba(31,44,68,0.08)]">
      <header className="border-b border-[#e6ecf5] pb-4">
        <h1 className="text-3xl font-bold text-[#1a2744]">Database Console</h1>
        <p className="mt-2 text-sm text-[#4e5f7a]">
          Use the buttons below to run simple read actions against ClickHouse.
        </p>
      </header>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {BUTTONS.map((button) => (
          <button
            key={button.action}
            type="button"
            onClick={() => runAction(button.action)}
            disabled={running !== null}
            className="rounded-xl border border-[#c7d2e7] bg-[#f8fbff] px-4 py-3 text-left transition hover:border-[#3f5f97] hover:bg-[#eef4ff] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="text-sm font-semibold text-[#1d2b4a]">{button.label}</div>
            <div className="mt-1 text-xs text-[#5f7294]">{button.hint}</div>
          </button>
        ))}
      </div>

      {running ? (
        <div className="mt-5 rounded-lg border border-[#cdd9ef] bg-[#f3f7ff] px-3 py-2 text-sm text-[#2e4875]">
          Running: {running}
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 rounded-lg border border-[#efc3c3] bg-[#fff1f1] px-3 py-2 text-sm text-[#8b3333]">
          {error}
        </div>
      ) : null}

      {result?.action === "ping" ? (
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[#d8e2f4] bg-[#f8fbff] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#62779a]">Status</p>
            <p className="mt-2 text-xl font-bold text-[#1a2744]">Connected</p>
          </div>
          <div className="rounded-lg border border-[#d8e2f4] bg-[#f8fbff] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#62779a]">Database</p>
            <p className="mt-2 break-all text-sm font-semibold text-[#1a2744]">{result.data.database}</p>
          </div>
          <div className="rounded-lg border border-[#d8e2f4] bg-[#f8fbff] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#62779a]">Endpoint</p>
            <p className="mt-2 break-all text-sm font-semibold text-[#1a2744]">{result.data.endpoint}</p>
          </div>
        </div>
      ) : null}

      {(result?.action === "recent" || result?.action === "risks") && result.data.items ? (
        <div className="mt-5">
          <div className="mb-2 text-sm font-semibold text-[#43567a]">
            Updated: {formatTime(result.data.updatedAt)} | Rows: {result.data.items.length}
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#d8e1f0]">
            <table className="min-w-full bg-white text-sm">
              <thead className="bg-[#eef3fb] text-left text-[#304466]">
                <tr>
                  <th className="px-3 py-2">Timestamp</th>
                  <th className="px-3 py-2">Verdict</th>
                  <th className="px-3 py-2">Query</th>
                </tr>
              </thead>
              <tbody className="text-black">
                {result.data.items.map((item, idx) => (
                  <tr key={`${item.timestamp}-${idx}`} className="border-t border-[#edf2fb]">
                    <td className="px-3 py-2 text-xs text-[#415672]">{formatTime(item.timestamp)}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-[#1a2744]">{item.verdict}</td>
                    <td className="px-3 py-2">{trimText(item.query, 140)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {result?.action === "verdicts" ? (
        <div className="mt-5 rounded-xl border border-[#d8e1f0] bg-[#f9fbff] p-4">
          <div className="mb-3 text-sm font-semibold text-[#43567a]">
            Updated: {formatTime(result.data.updatedAt)}
          </div>
          <div className="space-y-2">
            {result.data.counts.map((row) => (
              <div key={row.verdict} className="flex items-center justify-between rounded-md bg-white px-3 py-2">
                <span className="font-semibold text-[#2b3f61]">{row.verdict}</span>
                <span className="font-bold text-[#182541]">{row.count}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
