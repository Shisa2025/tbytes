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
  answer?: string;
  response_time_ms?: number;
};

export type FrequentQuestionItem = {
  question: string;
  count: number;
  latestVerdict: string;
  latestLanguage: string;
  answer: string;
};

export type FakeNewsFactItem = {
  title: string;
  summary: string;
  url: string;
  source: string;
  published_at?: string;
};

export type PandasSnapshot = {
  generated_at?: string;
  total_queries: number;
  risk_rate: number;
  daily_counts: Array<{ date: string; count: number }>;
  verdict_counts: Array<{ label: string; count: number }>;
  language_counts: Array<{ label: string; count: number }>;
  media_counts: Array<{ label: string; count: number }>;
};

export type QueryFamilyItem = {
  key: string;
  count: number;
  representative: string;
  samples: string[];
};

export type WordMapItem = {
  word: string;
  count: number;
};

export type FeedData = {
  connected: boolean;
  error?: string;
  updatedAt?: string;
  recentItems: QueryLogItem[];
  riskItems: QueryLogItem[];
  verdictCounts: Array<{ verdict: string; count: number }>;
  frequentQuestions: FrequentQuestionItem[];
  fakeNewsFacts: FakeNewsFactItem[];
  pandasSnapshot?: PandasSnapshot;
  queryFamilies: QueryFamilyItem[];
  wordMap: WordMapItem[];
};

export function normalizeClickHouseErrorMessage(error: unknown, url: string) {
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

export function resolveClickHouseConfig() {
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

function detectLanguage(text: string): string {
  if (!text) return "";
  if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(text)) return "zh";
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  if (/[\u0e00-\u0e7f]/.test(text)) return "th";
  if (/[\u0900-\u097f]/.test(text)) return "hi";
  if (/[a-zA-Z]/.test(text)) return "en";
  return "";
}

function normalizeVerdict(value: string): "true" | "false" | "misleading" | "unverified" | "unknown" {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return "unknown";

  if (
    raw.includes("misleading") ||
    raw.includes("partly false") ||
    raw.includes("partially false") ||
    raw.includes("needs context")
  ) {
    return "misleading";
  }
  if (
    raw.startsWith("🔴") ||
    raw.includes(" false") ||
    raw === "false" ||
    raw.includes("scam") ||
    raw.includes("hoax")
  ) {
    return "false";
  }
  if (raw.startsWith("🟢") || raw.includes(" true") || raw === "true" || raw.includes("verified true")) {
    return "true";
  }
  if (raw.startsWith("⚪") || raw.includes("unverified")) {
    return "unverified";
  }
  return "unknown";
}

function mergeVerdictCounts(rows: Array<{ verdict: string; count: number }>) {
  const merged = new Map<"true" | "false" | "misleading" | "unverified" | "unknown", number>();
  for (const row of rows) {
    const verdict = normalizeVerdict(row.verdict ?? "");
    const count = Number(row.count) || 0;
    merged.set(verdict, (merged.get(verdict) ?? 0) + count);
  }
  return [...merged.entries()]
    .map(([verdict, count]) => ({ verdict, count }))
    .sort((a, b) => b.count - a.count);
}

function loadJsonFromDataDir<T>(fileName: string): T | undefined {
  const candidates = [
    path.resolve(process.cwd(), "data", fileName),
    path.resolve(process.cwd(), "..", "data", fileName),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = fs.readFileSync(file, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeQuestion(text: string) {
  const source = (text || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();

  return source
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackAnswerFromVerdict(verdict: string) {
  const v = (verdict || "").toLowerCase();
  if (v === "false") return "This claim was assessed as false based on trusted fact-checking context.";
  if (v === "misleading") return "This claim was assessed as misleading and requires additional context.";
  if (v === "true") return "This claim was assessed as true based on trusted fact-checking context.";
  return "No stored answer is available for this query yet.";
}

function buildFrequentQuestions(items: QueryLogItem[], topN = 8): FrequentQuestionItem[] {
  const grouped = new Map<
    string,
    {
      question: string;
      count: number;
      latestTimestamp: number;
      latestVerdict: string;
      latestLanguage: string;
      answer: string;
    }
  >();

  for (const item of items) {
    const question = (item.query || "").trim();
    if (!question) continue;
    const key = normalizeQuestion(question);
    if (!key) continue;

    const ts = Date.parse(item.timestamp || "");
    const current = grouped.get(key);
    const answer = (item.answer || "").trim();

    if (!current) {
      grouped.set(key, {
        question,
        count: 1,
        latestTimestamp: Number.isNaN(ts) ? 0 : ts,
        latestVerdict: (item.verdict || "unknown").toLowerCase(),
        latestLanguage: ((item.language && item.language.toLowerCase() !== "unknown") ? item.language : detectLanguage(question)) || "en",
        answer: answer || fallbackAnswerFromVerdict(item.verdict),
      });
      continue;
    }

    current.count += 1;
    if (!Number.isNaN(ts) && ts >= current.latestTimestamp) {
      current.latestTimestamp = ts;
      current.latestVerdict = (item.verdict || "unknown").toLowerCase();
      current.latestLanguage = ((item.language && item.language.toLowerCase() !== "unknown") ? item.language : detectLanguage(question)) || "en";
      if (answer) current.answer = answer;
    } else if (!current.answer && answer) {
      current.answer = answer;
    }
  }

  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || b.latestTimestamp - a.latestTimestamp)
    .slice(0, topN)
    .map((row) => ({
      question: row.question,
      count: row.count,
      latestVerdict: row.latestVerdict,
      latestLanguage: row.latestLanguage,
      answer: row.answer || fallbackAnswerFromVerdict(row.latestVerdict),
    }));
}

function computePandasFallback(recentItems: QueryLogItem[]): PandasSnapshot {
  const daily = new Map<string, number>();
  const verdict = new Map<string, number>();
  const language = new Map<string, number>();
  const media = new Map<string, number>();

  for (const row of recentItems) {
    const date = (row.timestamp || "").slice(0, 10) || "Unknown";
    daily.set(date, (daily.get(date) ?? 0) + 1);

    const v = (row.verdict || "unknown").toLowerCase();
    verdict.set(v, (verdict.get(v) ?? 0) + 1);

    const l = (((row.language && row.language.toLowerCase() !== "unknown") ? row.language : detectLanguage(row.query)) || "en").toLowerCase();
    language.set(l, (language.get(l) ?? 0) + 1);

    const m = (row.media_type || "unknown").toLowerCase();
    media.set(m, (media.get(m) ?? 0) + 1);
  }

  const total = recentItems.length;
  const risk = recentItems.filter((x) => x.verdict === "false" || x.verdict === "misleading").length;

  return {
    generated_at: new Date().toISOString(),
    total_queries: total,
    risk_rate: total ? Math.round((risk / total) * 100) : 0,
    daily_counts: [...daily.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14),
    verdict_counts: [...verdict.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    language_counts: [...language.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    media_counts: [...media.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6),
  };
}

function buildQueryFamilies(items: QueryLogItem[], topN = 8): QueryFamilyItem[] {
  const groups = new Map<string, { count: number; representative: string; samples: string[] }>();
  for (const item of items) {
    const query = (item.query || "").trim();
    if (!query) continue;
    const key = normalizeQuestion(query);
    if (!key) continue;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { count: 1, representative: query, samples: [query] });
      continue;
    }
    current.count += 1;
    if (query.length > current.representative.length) current.representative = query;
    if (current.samples.length < 3 && !current.samples.includes(query)) current.samples.push(query);
  }
  return [...groups.entries()]
    .map(([key, value]) => ({ key, count: value.count, representative: value.representative, samples: value.samples }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

function buildWordMap(items: QueryLogItem[], topN = 40): WordMapItem[] {
  const stop = new Set([
    "the", "and", "for", "with", "this", "that", "from", "your", "have", "has", "are", "was", "were", "can",
    "you", "what", "when", "where", "which", "will", "about", "into", "how", "why", "does", "is", "to", "of",
    "a", "an", "in", "on", "at", "be", "it", "or", "if", "as", "by", "i", "we", "they", "he", "she",
    "dan", "yang", "untuk", "dengan", "tidak", "adalah", "ini", "itu", "apa", "bila", "boleh", "dalam",
  ]);
  const counts = new Map<string, number>();
  for (const item of items) {
    const norm = normalizeQuestion(item.query || "");
    if (!norm) continue;
    for (const token of norm.split(" ")) {
      const t = token.trim();
      if (!t || t.length < 3 || stop.has(t) || /^\d+$/.test(t)) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export async function loadDashboardFeed(limit = 24): Promise<FeedData> {
  const cfg = resolveClickHouseConfig();
  if (!cfg.url) {
    return {
      connected: false,
      error: "Missing CH_HOST in env",
      updatedAt: new Date().toISOString(),
      recentItems: [],
      riskItems: [],
      verdictCounts: [],
      frequentQuestions: [],
      fakeNewsFacts: loadJsonFromDataDir<FakeNewsFactItem[]>("fake_news_facts.json") ?? [],
      queryFamilies: [],
      wordMap: [],
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
    const hasResponseTime = columns.has("response_time_ms");

    if (!hasQuery || !hasVerdict) {
      return {
        connected: false,
        updatedAt: new Date().toISOString(),
        error: "query_logs is missing required columns: query / verdict",
        recentItems: [],
        riskItems: [],
        verdictCounts: [],
        frequentQuestions: [],
        fakeNewsFacts: loadJsonFromDataDir<FakeNewsFactItem[]>("fake_news_facts.json") ?? [],
        queryFamilies: [],
        wordMap: [],
      };
    }

    const selectTimestamp = hasTimestamp ? "toString(timestamp) AS timestamp" : "'' AS timestamp";
    const selectUserId = hasUserId ? "toString(user_id) AS user_id" : "'' AS user_id";
    const selectLanguage = hasLanguage ? "ifNull(language, '') AS language" : "'' AS language";
    const selectMedia = hasMediaType ? "ifNull(media_type, '') AS media_type" : "'' AS media_type";
    const selectResponse = hasResponseTime ? "toInt32OrZero(response_time_ms) AS response_time_ms" : "0 AS response_time_ms";
    const answerColumn =
      (["answer", "response", "assistant_response", "verdict_text", "result_text"] as const).find((name) =>
        columns.has(name),
      ) ?? "";
    const selectAnswer = answerColumn ? `toString(ifNull(${answerColumn}, '')) AS answer` : "'' AS answer";
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
          ${selectMedia},
          ${selectAnswer},
          ${selectResponse}
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
      verdict: normalizeVerdict(item.verdict ?? ""),
      language: (item.language && item.language.toLowerCase() !== "unknown")
        ? item.language
        : detectLanguage(item.query),
    }));

    const riskResult = await client.query({
      query: `
        SELECT
          ${selectTimestamp},
          ${selectUserId},
          query,
          verdict,
          ${selectLanguage},
          ${selectMedia},
          ${selectAnswer},
          ${selectResponse}
        FROM query_logs
        WHERE (
          lowerUTF8(toString(verdict)) = 'false'
          OR lowerUTF8(toString(verdict)) = 'misleading'
          OR lowerUTF8(toString(verdict)) LIKE '🔴%'
          OR lowerUTF8(toString(verdict)) LIKE '% false%'
          OR lowerUTF8(toString(verdict)) LIKE '%misleading%'
        )
          ${riskWindow}
        ${riskOrder}
        LIMIT 12
      `,
      format: "JSONEachRow",
    });
    const riskItems = (await riskResult.json<QueryLogItem>()).map((item) => ({
      ...item,
      verdict: normalizeVerdict(item.verdict ?? ""),
      language: (item.language && item.language.toLowerCase() !== "unknown")
        ? item.language
        : detectLanguage(item.query),
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
      frequentQuestions: buildFrequentQuestions(recentItems, 8),
      fakeNewsFacts: loadJsonFromDataDir<FakeNewsFactItem[]>("fake_news_facts.json") ?? [],
      pandasSnapshot:
        loadJsonFromDataDir<PandasSnapshot>("dashboard_analysis_snapshot.json") ??
        computePandasFallback(recentItems),
      queryFamilies: buildQueryFamilies(recentItems, 10),
      wordMap: buildWordMap(recentItems, 44),
      verdictCounts: mergeVerdictCounts(verdictCounts),
    };
  } catch (error) {
    return {
      connected: false,
      updatedAt: new Date().toISOString(),
      error: normalizeClickHouseErrorMessage(error, cfg.url),
      recentItems: [],
      riskItems: [],
      verdictCounts: [],
      frequentQuestions: [],
      fakeNewsFacts: loadJsonFromDataDir<FakeNewsFactItem[]>("fake_news_facts.json") ?? [],
      queryFamilies: [],
      wordMap: [],
    };
  } finally {
    await client.close();
  }
}
