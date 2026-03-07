import fs from "node:fs";
import path from "node:path";

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

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function detectLanguage(text: string): string {
  if (!text.trim()) return "Unknown";
  if (/[\u4e00-\u9fff]/.test(text)) return "Chinese";
  if (/[\u3040-\u30ff]/.test(text)) return "Japanese";
  if (/[\uac00-\ud7af]/.test(text)) return "Korean";
  if (/[A-Za-z]/.test(text)) return "English";
  return "Unknown";
}

function resolveCsvPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "data", "query_logs.csv"),
    path.resolve(process.cwd(), "..", "data", "query_logs.csv"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function loadQueryLogs(): Promise<QueryLogRow[]> {
  const csvPath = resolveCsvPath();
  if (!csvPath) return [];

  const raw = await fs.promises.readFile(csvPath, "utf-8");
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.toLowerCase().replace(/^\uFEFF/, ""),
  );

  const rows: QueryLogRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));

    const timestamp = String(row.timestamp ?? "");
    const query = String(row.query ?? "");
    const languageValue = String(row.language ?? "").trim();
    const responseTime = Number.parseInt(String(row.response_time_ms ?? "0"), 10);
    const verdict = String(row.verdict ?? "").toLowerCase();
    const mediaType = String(row.media_type ?? "unknown").toLowerCase();

    // Skip accidental repeated header rows from appended CSV files.
    if (
      timestamp.toLowerCase() === "timestamp" ||
      query.toLowerCase() === "query" ||
      verdict === "verdict" ||
      mediaType === "media_type"
    ) {
      continue;
    }

    rows.push({
      timestamp,
      user_id: String(row.user_id ?? ""),
      query,
      verdict,
      media_type: mediaType,
      response_time_ms: Number.isNaN(responseTime) ? 0 : responseTime,
      language: languageValue || detectLanguage(query),
      date: timestamp ? timestamp.slice(0, 10) : "Unknown",
    });
  }

  return rows;
}
