import { createClient } from "@clickhouse/client";
import {
  normalizeClickHouseErrorMessage,
  resolveClickHouseConfig,
} from "../clickhouse-feed";

export type QueryLogRow = {
  timestamp: string;
  user_id: string;
  query: string;
  verdict: string;
  media_type: string;
  response_time_ms: number;
  language: string;
  date: string;
};

export type QueryLogsResult = {
  connected: boolean;
  error?: string;
  rows: QueryLogRow[];
};

function normalizeToken(value: string) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function toTitleCase(raw: string) {
  const t = (raw || "").trim();
  if (!t) return "Unknown";
  return t
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeLanguage(value: string) {
  const raw = (value || "").trim();
  if (!raw) return "";

  const token = normalizeToken(raw);
  if (
    !token ||
    token === "unknown" ||
    token === "unk" ||
    token === "na" ||
    token === "n" ||
    token === "null" ||
    token === "none" ||
    token === "other"
  ) {
    return "";
  }

  const map: Record<string, string> = {
    en: "English",
    eng: "English",
    english: "English",
    zh: "Chinese",
    zhs: "Chinese",
    zhcn: "Chinese",
    chinese: "Chinese",
    ja: "Japanese",
    jp: "Japanese",
    jpn: "Japanese",
    japanese: "Japanese",
    ko: "Korean",
    kr: "Korean",
    kor: "Korean",
    korean: "Korean",
    id: "Indonesian",
    indonesian: "Indonesian",
    ms: "Malay",
    malay: "Malay",
    vi: "Vietnamese",
    vietnamese: "Vietnamese",
    th: "Thai",
    thai: "Thai",
    ar: "Arabic",
    arabic: "Arabic",
    hi: "Hindi",
    hindi: "Hindi",
  };

  if (map[token]) return map[token];
  return toTitleCase(raw);
}

function detectLanguage(text: string): string {
  if (!text.trim()) return "Unknown";
  if (/[\u4e00-\u9fff]/.test(text)) return "Chinese";
  if (/[\u3040-\u30ff]/.test(text)) return "Japanese";
  if (/[\uac00-\ud7af]/.test(text)) return "Korean";
  if (/[\u0E00-\u0E7F]/.test(text)) return "Thai";
  if (/[\u0600-\u06FF]/.test(text)) return "Arabic";
  if (/[\u0900-\u097F]/.test(text)) return "Hindi";
  if (/\p{Script=Latin}/u.test(text)) return "English";
  return "Unknown";
}

function normalizeVerdict(value: string) {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return "unknown";

  const token = normalizeToken(raw);
  if (!token) return "unknown";

  if (
    token === "true" ||
    token === "1" ||
    token === "yes" ||
    token.includes("verifiedtrue") ||
    token.includes("fact") ||
    token.includes("real") ||
    token.includes("safe") ||
    token.includes("legit")
  ) {
    return "true";
  }

  if (
    token === "false" ||
    token === "0" ||
    token === "no" ||
    token.includes("fake") ||
    token.includes("scam") ||
    token.includes("fraud") ||
    token.includes("hoax") ||
    token.includes("phishing")
  ) {
    return "false";
  }

  if (
    token === "misleading" ||
    token.includes("mixed") ||
    token.includes("partlyfalse") ||
    token.includes("partiallyfalse") ||
    token.includes("uncertain") ||
    token.includes("unverified") ||
    token.includes("needscontext")
  ) {
    return "misleading";
  }

  return raw;
}

function inferMediaType(query: string) {
  const q = (query || "").toLowerCase();
  if (!q) return "text";

  if (
    q.includes("youtube") ||
    q.includes("tiktok") ||
    q.includes("reel") ||
    q.includes("shorts") ||
    q.includes("video")
  ) {
    return "video";
  }
  if (
    q.includes("image") ||
    q.includes("photo") ||
    q.includes("picture") ||
    q.includes("screenshot")
  ) {
    return "image";
  }
  if (
    q.includes("audio") ||
    q.includes("voice") ||
    q.includes("podcast") ||
    q.includes("call recording")
  ) {
    return "audio";
  }
  return "text";
}

function normalizeMediaType(value: string, query: string) {
  const raw = (value || "").trim().toLowerCase();
  const token = normalizeToken(raw);

  if (!token || token === "unknown" || token === "null" || token === "na" || token === "none") {
    return inferMediaType(query);
  }
  if (
    token === "text" ||
    token === "txt" ||
    token === "message" ||
    token === "chat" ||
    token === "article" ||
    token === "post"
  ) {
    return "text";
  }
  if (
    token === "video" ||
    token === "vid" ||
    token === "reel" ||
    token === "short" ||
    token === "shorts" ||
    token === "youtube" ||
    token === "tiktok"
  ) {
    return "video";
  }
  if (
    token === "image" ||
    token === "img" ||
    token === "photo" ||
    token === "picture" ||
    token === "screenshot"
  ) {
    return "image";
  }
  if (
    token === "audio" ||
    token === "voice" ||
    token === "podcast" ||
    token === "call"
  ) {
    return "audio";
  }
  return raw;
}

function dateFromTimestamp(value: string) {
  const ts = Date.parse(value);
  if (!Number.isNaN(ts)) {
    return new Date(ts).toISOString().slice(0, 10);
  }
  return value ? value.slice(0, 10) : "Unknown";
}

export async function loadQueryLogs(limit = 800): Promise<QueryLogsResult> {
  const cfg = resolveClickHouseConfig();
  if (!cfg.url) {
    return { connected: false, error: "Missing CH_HOST in env", rows: [] };
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
    const hasMediaType = columns.has("media_type");
    const hasLanguage = columns.has("language");
    const hasResponseTime = columns.has("response_time_ms");

    if (!hasQuery || !hasVerdict) {
      return {
        connected: false,
        error: "query_logs is missing required columns: query / verdict",
        rows: [],
      };
    }

    const selectTimestamp = hasTimestamp ? "toString(timestamp) AS timestamp" : "'' AS timestamp";
    const selectUserId = hasUserId ? "toString(user_id) AS user_id" : "'' AS user_id";
    const selectMedia = hasMediaType ? "ifNull(media_type, 'unknown') AS media_type" : "'unknown' AS media_type";
    const selectLanguage = hasLanguage ? "ifNull(language, '') AS language" : "'' AS language";
    const selectResponse = hasResponseTime ? "toInt32OrZero(response_time_ms) AS response_time_ms" : "0 AS response_time_ms";

    const tsExpr = "parseDateTimeBestEffortOrNull(toString(timestamp))";
    const whereWindow = hasTimestamp ? `WHERE ${tsExpr} >= now() - INTERVAL 60 DAY` : "";
    const orderWindow = hasTimestamp ? `ORDER BY ${tsExpr} DESC` : "";

    const result = await client.query({
      query: `
        SELECT
          ${selectTimestamp},
          ${selectUserId},
          query,
          verdict,
          ${selectMedia},
          ${selectResponse},
          ${selectLanguage}
        FROM query_logs
        ${whereWindow}
        ${orderWindow}
        LIMIT {limit:UInt32}
      `,
      format: "JSONEachRow",
      query_params: { limit },
    });

    const rawRows = await result.json<{
      timestamp: string;
      user_id: string;
      query: string;
      verdict: string;
      media_type: string;
      response_time_ms: number;
      language: string;
    }>();

    const rows: QueryLogRow[] = rawRows.map((row) => {
      const query = String(row.query ?? "");
      const timestamp = String(row.timestamp ?? "");
      const languageRaw = String(row.language ?? "").trim();
      const responseTime = Number(row.response_time_ms ?? 0);
      const normalizedLanguage = normalizeLanguage(languageRaw);

      return {
        timestamp,
        user_id: String(row.user_id ?? ""),
        query,
        verdict: normalizeVerdict(String(row.verdict ?? "")),
        media_type: normalizeMediaType(String(row.media_type ?? "unknown"), query),
        response_time_ms: Number.isFinite(responseTime) ? responseTime : 0,
        language: normalizedLanguage || detectLanguage(query),
        date: dateFromTimestamp(timestamp),
      };
    });

    return { connected: true, rows };
  } catch (error) {
    return {
      connected: false,
      error: normalizeClickHouseErrorMessage(error, cfg.url),
      rows: [],
    };
  } finally {
    await client.close();
  }
}
