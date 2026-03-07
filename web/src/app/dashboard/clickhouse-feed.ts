import fs from "node:fs";
import path from "node:path";
import { createClient } from "@clickhouse/client";

export type QueryLogItem = {
  timestamp: string;
  user_id?: string;
  query: string;
  verdict: string;
  language?: string;
  media_type?: string;
};

export type FeedData = {
  connected: boolean;
  error?: string;
  updatedAt?: string;
  recentItems: QueryLogItem[];
  riskItems: QueryLogItem[];
  verdictCounts: Array<{ verdict: string; count: number }>;
};

function normalizeErrorMessage(error: unknown, url: string) {
  const parts: string[] = [];

  if (error instanceof Error) {
    if (error.message?.trim()) parts.push(error.message.trim());

    const anyError = error as Error & {
      code?: string;
      cause?: unknown;
      errors?: unknown[];
    };

    if (typeof anyError.code === "string" && anyError.code.trim()) {
      parts.push(anyError.code.trim());
    }

    if (Array.isArray(anyError.errors)) {
      for (const nested of anyError.errors) {
        if (nested instanceof Error && nested.message?.trim()) {
          parts.push(nested.message.trim());
          const nestedAny = nested as Error & { code?: string };
          if (typeof nestedAny.code === "string" && nestedAny.code.trim()) {
            parts.push(nestedAny.code.trim());
          }
        } else if (nested !== null && nested !== undefined) {
          const text = String(nested).trim();
          if (text) parts.push(text);
        }
      }
    }

    if (anyError.cause instanceof Error && anyError.cause.message?.trim()) {
      parts.push(anyError.cause.message.trim());
      const causeAny = anyError.cause as Error & { code?: string };
      if (typeof causeAny.code === "string" && causeAny.code.trim()) {
        parts.push(causeAny.code.trim());
      }
    } else if (anyError.cause !== null && anyError.cause !== undefined) {
      const text = String(anyError.cause).trim();
      if (text) parts.push(text);
    }
  } else if (error !== null && error !== undefined) {
    const text = String(error).trim();
    if (text) parts.push(text);
  }

  const raw = parts.join(" | ").trim();
  const lowered = raw.toLowerCase();
  if (lowered.includes("etimedout") || lowered.includes("timeout")) {
    return `Connection timed out to ${url}. Check outbound network/firewall and ClickHouse Cloud IP allowlist.`;
  }
  if (lowered.includes("econnrefused")) {
    return `Connection refused by ${url}. Verify CH_HOST/CH_PORT and service state.`;
  }
  if (lowered.includes("enotfound") || lowered.includes("dns")) {
    return `DNS resolution failed for ${url}. Verify CH_HOST and DNS/network settings.`;
  }
  return raw || `Unknown ClickHouse error while connecting to ${url}`;
}

function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const idx = raw.indexOf("=");
    if (idx < 0) continue;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    out[key] = value;
  }
  return out;
}

function loadRootEnvFallback(): Record<string, string> {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf-8");
      return parseEnvText(text);
    }
  }
  return {};
}

function resolveConfig() {
  const fallback = loadRootEnvFallback();
  const host = (process.env.CH_HOST ?? fallback.CH_HOST ?? "").trim();
  const port = (process.env.CH_PORT ?? fallback.CH_PORT ?? "8443").trim();
  const user = (process.env.CH_USER ?? fallback.CH_USER ?? "default").trim();
  const password = (process.env.CH_PASSWORD ?? fallback.CH_PASSWORD ?? "").trim();
  const database = (process.env.CH_DATABASE ?? fallback.CH_DATABASE ?? "default").trim() || "default";
  const secureRaw = (process.env.CH_SECURE ?? fallback.CH_SECURE ?? "true").trim().toLowerCase();
  const timeoutRaw = (process.env.CH_REQUEST_TIMEOUT ?? fallback.CH_REQUEST_TIMEOUT ?? "30000").trim();
  const secure = ["1", "true", "yes", "on"].includes(secureRaw);
  const protocol = secure ? "https" : "http";
  const url = host ? `${protocol}://${host}:${port}` : "";
  const requestTimeout = Number.parseInt(timeoutRaw, 10);
  return { url, user, password, database, requestTimeout: Number.isNaN(requestTimeout) ? 30000 : requestTimeout };
}

export async function loadDashboardFeed(limit = 24): Promise<FeedData> {
  const cfg = resolveConfig();
  if (!cfg.url) {
    return {
      connected: false,
      error: "Missing CH_HOST in env",
      updatedAt: new Date().toISOString(),
      recentItems: [],
      riskItems: [],
      verdictCounts: [],
    };
  }

  const client = createClient({
    url: cfg.url,
    username: cfg.user,
    password: cfg.password,
    database: cfg.database,
    request_timeout: cfg.requestTimeout,
  });

  try {
    const columnResult = await client.query({
      query: `
        SELECT name
        FROM system.columns
        WHERE database = currentDatabase()
          AND table = 'query_logs'
      `,
      format: "JSONEachRow",
    });
    const columnRows = await columnResult.json<{ name: string }>();
    const columns = new Set(columnRows.map((row) => row.name.toLowerCase()));

    const hasTimestamp = columns.has("timestamp");
    const hasQuery = columns.has("query");
    const hasVerdict = columns.has("verdict");
    const hasUserId = columns.has("user_id");
    const hasLanguage = columns.has("language");
    const hasMediaType = columns.has("media_type");

    if (!hasQuery || !hasVerdict) {
      return {
        connected: false,
        updatedAt: new Date().toISOString(),
        error: "query_logs is missing required columns: query / verdict",
        recentItems: [],
        riskItems: [],
        verdictCounts: [],
      };
    }

    const selectTimestamp = hasTimestamp ? "toString(timestamp) AS timestamp" : "'' AS timestamp";
    const selectUserId = hasUserId ? "toString(user_id) AS user_id" : "'' AS user_id";
    const selectLanguage = hasLanguage ? "ifNull(language, '') AS language" : "'' AS language";
    const selectMedia = hasMediaType ? "ifNull(media_type, '') AS media_type" : "'' AS media_type";
    const tsExpr = "parseDateTimeBestEffortOrNull(toString(timestamp))";
    const recentWindow = hasTimestamp ? `WHERE ${tsExpr} >= now() - INTERVAL 30 DAY` : "";
    const recentOrder = hasTimestamp ? `ORDER BY ${tsExpr} DESC` : "";
    const riskWindow = hasTimestamp ? `AND ${tsExpr} >= now() - INTERVAL 30 DAY` : "";
    const riskOrder = hasTimestamp ? `ORDER BY ${tsExpr} DESC` : "";
    const verdictWindow = hasTimestamp ? `WHERE ${tsExpr} >= now() - INTERVAL 14 DAY` : "";

    const recentResult = await client.query({
      query: `
        SELECT
          ${selectTimestamp},
          ${selectUserId},
          query,
          verdict,
          ${selectLanguage},
          ${selectMedia}
        FROM query_logs
        ${recentWindow}
        ${recentOrder}
        LIMIT {limit:UInt32}
      `,
      format: "JSONEachRow",
      query_params: { limit },
    });
    const recentItems = (await recentResult.json<QueryLogItem>()).map((item) => ({
      ...item,
      verdict: (item.verdict ?? "").toLowerCase(),
    }));

    const riskResult = await client.query({
      query: `
        SELECT
          ${selectTimestamp},
          ${selectUserId},
          query,
          verdict,
          ${selectLanguage},
          ${selectMedia}
        FROM query_logs
        WHERE verdict IN ('false', 'misleading')
          ${riskWindow}
        ${riskOrder}
        LIMIT 12
      `,
      format: "JSONEachRow",
    });
    const riskItems = (await riskResult.json<QueryLogItem>()).map((item) => ({
      ...item,
      verdict: (item.verdict ?? "").toLowerCase(),
    }));

    const verdictResult = await client.query({
      query: `
        SELECT verdict, count() AS count
        FROM query_logs
        ${verdictWindow}
        GROUP BY verdict
        ORDER BY count DESC
        LIMIT 6
      `,
      format: "JSONEachRow",
    });
    const verdictCounts = await verdictResult.json<{ verdict: string; count: number }>();

    return {
      connected: true,
      updatedAt: new Date().toISOString(),
      recentItems,
      riskItems,
      verdictCounts: verdictCounts.map((item) => ({
        verdict: (item.verdict ?? "").toLowerCase(),
        count: Number(item.count) || 0,
      })),
    };
  } catch (error) {
    return {
      connected: false,
      updatedAt: new Date().toISOString(),
      error: normalizeErrorMessage(error, cfg.url),
      recentItems: [],
      riskItems: [],
      verdictCounts: [],
    };
  } finally {
    await client.close();
  }
}
