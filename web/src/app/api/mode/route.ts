import { NextResponse } from "next/server";

function backendBase() {
  return (process.env.BACKEND_BASE_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
}

type Mode = "openai_only" | "hybrid";

async function inferCurrentMode(base: string): Promise<Mode> {
  const [engineResp, mediaResp] = await Promise.all([
    fetch(`${base}/api/engine`, { cache: "no-store" }),
    fetch(`${base}/api/media_engine`, { cache: "no-store" }),
  ]);

  if (!engineResp.ok || !mediaResp.ok) {
    throw new Error(`Backend reachable but mode endpoints failed at ${base}. Check /api/engine and /api/media_engine.`);
  }

  const engine = (await engineResp.json()) as { active_engine?: string };
  const media = (await mediaResp.json()) as { active_media_engine?: string };

  const rag = (engine.active_engine || "").toLowerCase();
  const mediaEngine = (media.active_media_engine || "").toLowerCase();

  if (rag === "openai" && mediaEngine === "openai") return "openai_only";
  return "hybrid";
}

export async function GET() {
  const base = backendBase();
  try {
    const mode = await inferCurrentMode(base);
    return NextResponse.json({ ok: true, mode });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const clear = message.includes("fetch failed")
      ? `Cannot reach backend at ${base}. Start FastAPI (python -m app.main) or set BACKEND_BASE_URL.`
      : message || `Failed to read mode from backend at ${base}.`;
    return NextResponse.json({ ok: false, error: clear }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const base = backendBase();
  try {
    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    const mode = (body.mode || "").trim().toLowerCase();
    if (mode !== "openai_only" && mode !== "hybrid") {
      return NextResponse.json({ ok: false, error: "mode must be openai_only or hybrid" }, { status: 400 });
    }

    const resp = await fetch(`${base}/api/global_mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ ok: false, error: text || `Backend rejected mode change at ${base}.` }, { status: 500 });
    }

    const payload = (await resp.json()) as { status?: string; mode?: Mode };
    return NextResponse.json({ ok: true, mode: payload.mode || mode });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const clear = message.includes("fetch failed")
      ? `Cannot reach backend at ${base}. Start FastAPI (python -m app.main) or set BACKEND_BASE_URL.`
      : message || `Failed to set mode via backend at ${base}.`;
    return NextResponse.json({ ok: false, error: clear }, { status: 500 });
  }
}
