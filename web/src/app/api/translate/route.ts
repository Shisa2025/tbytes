import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

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
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf-8");
    return parseEnvText(text);
  }
  return {};
}

function getOpenAiKey() {
  const fallback = loadRootEnvFallback();
  return (process.env.OPENAI_API_KEY ?? fallback.OPENAI_API_KEY ?? "").trim();
}

function safeJsonArray(raw: string): string[] | null {
  const text = (raw || "").trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {}

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {}

  return null;
}

function hasNonEnglishScript(text: string): boolean {
  if (!text) return false;
  return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u0400-\u04ff]/.test(text);
}

async function translateBatch(apiKey: string, texts: string[], systemPrompt: string): Promise<string[] | null> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(texts) },
      ],
    }),
  });

  if (!resp.ok) return null;
  const payload = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload?.choices?.[0]?.message?.content ?? "";
  const parsed = safeJsonArray(content);
  if (!parsed || parsed.length !== texts.length) return null;
  return parsed;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = Array.isArray(body?.texts) ? body.texts : [];
    const texts = input
      .map((value: unknown) => String(value ?? "").trim())
      .filter(Boolean)
      .slice(0, 120);

    if (texts.length === 0) {
      return NextResponse.json({ ok: false, error: "No texts provided." }, { status: 400 });
    }

    const apiKey = getOpenAiKey();
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    const translated = await translateBatch(
      apiKey,
      texts,
      "Translate each input string into English. Return only a JSON array of strings with the same order and length.",
    );

    if (!translated || translated.length !== texts.length) {
      return NextResponse.json(
        { ok: false, error: "Translation model returned invalid format." },
        { status: 500 },
      );
    }

    const finalTranslations = [...translated];
    const retryIndexes = finalTranslations
      .map((value, idx) => ({ idx, value }))
      .filter((x) => hasNonEnglishScript(x.value))
      .map((x) => x.idx);

    if (retryIndexes.length > 0) {
      const retryTexts = retryIndexes.map((idx) => texts[idx]);
      const strictRetry = await translateBatch(
        apiKey,
        retryTexts,
        "Translate to English only, using Latin characters only. Do not leave any Chinese, Malay, Tamil, Arabic, or other non-Latin script. If a proper noun has no standard English form, provide a phonetic romanization in Latin letters. Return only a JSON array with same order and length.",
      );

      if (strictRetry && strictRetry.length === retryIndexes.length) {
        for (let i = 0; i < retryIndexes.length; i += 1) {
          finalTranslations[retryIndexes[i]] = strictRetry[i];
        }
      }
    }

    return NextResponse.json({ ok: true, translations: finalTranslations });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message || "Unexpected translation error." }, { status: 500 });
  }
}
