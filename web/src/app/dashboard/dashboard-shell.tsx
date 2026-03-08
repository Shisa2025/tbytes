"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const MEDIA_OPTIONS = ["All", "text", "video", "image", "audio"];

function navClass(active: boolean) {
  if (active) {
    return "flex h-11 items-center rounded-md bg-[#243057] px-3 font-semibold transition-colors hover:bg-[#2e3d66]";
  }
  return "flex h-11 items-center rounded-md px-3 transition-colors hover:bg-[#243057]";
}

export default function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"openai_only" | "hybrid">("hybrid");
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState("");

  const media = searchParams.get("media");
  const selectedMedia = media && media.trim() ? media : "All";

  const paramsForNav = new URLSearchParams(searchParams.toString());
  if (!paramsForNav.get("media")) {
    paramsForNav.delete("media");
  }
  const navQuery = paramsForNav.toString();
  const homeHref = navQuery ? `/dashboard?${navQuery}` : "/dashboard";
  const analysisHref = navQuery ? `/dashboard/analysis?${navQuery}` : "/dashboard/analysis";
  const briefingHref = navQuery ? `/dashboard/briefing?${navQuery}` : "/dashboard/briefing";
  const factsHref = navQuery ? `/dashboard/facts?${navQuery}` : "/dashboard/facts";
  const databaseHref = navQuery ? `/dashboard/database?${navQuery}` : "/dashboard/database";

  const isHome = pathname === "/dashboard";
  const isAnalysis = pathname.startsWith("/dashboard/analysis");
  const isBriefing = pathname.startsWith("/dashboard/briefing");
  const isFacts = pathname.startsWith("/dashboard/facts");
  const isDatabase = pathname.startsWith("/dashboard/database");

  function onMediaChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "All") {
      params.delete("media");
    } else {
      params.set("media", next.toLowerCase());
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  useEffect(() => {
    let canceled = false;
    async function loadMode() {
      try {
        const resp = await fetch("/api/mode", { cache: "no-store" });
        const payload = (await resp.json()) as { ok?: boolean; mode?: "openai_only" | "hybrid"; error?: string };
        if (canceled) return;
        if (resp.ok && payload.ok && payload.mode) {
          setMode(payload.mode);
          setModeError("");
        } else {
          setModeError(payload.error || "Unable to read mode.");
        }
      } catch (error) {
        if (canceled) return;
        const message = error instanceof Error ? error.message : "Unable to read mode.";
        setModeError(message);
      }
    }
    loadMode();
    return () => {
      canceled = true;
    };
  }, []);

  async function onModeChange(next: "openai_only" | "hybrid") {
    if (modeBusy || next === mode) return;
    setModeBusy(true);
    setModeError("");
    try {
      const resp = await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const payload = (await resp.json()) as { ok?: boolean; mode?: "openai_only" | "hybrid"; error?: string };
      if (!resp.ok || !payload.ok || !payload.mode) {
        throw new Error(payload.error || "Mode switch failed.");
      }
      setMode(payload.mode);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mode switch failed.";
      setModeError(message);
    } finally {
      setModeBusy(false);
    }
  }

  return (
    <div className="h-screen w-full overflow-hidden bg-[#eef2f7]">
      <div className="flex h-full w-full flex-col overflow-hidden lg:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto bg-[#1a2744] px-5 py-6 text-white lg:h-full lg:w-[300px]">
<div className="mb-5 flex flex-col items-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[#243057] text-xl">Q</div>
            <div className="text-xl font-bold">TBytes</div>
            <div className="text-sm text-[#aab4c8]">Fact-Check System</div>
          </div>

          <hr className="mb-4 border-[#2d3f6b]" />
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#aab4c8]">Navigation</div>
          <div className="space-y-2 text-base">
            <Link href={homeHref} className={navClass(isHome)}>
              Issue Cover
            </Link>
            <Link href={analysisHref} className={navClass(isAnalysis)}>
              Data Desk
            </Link>
            <Link href={briefingHref} className={navClass(isBriefing)}>
              Editorial Briefing
            </Link>
            <Link href={factsHref} className={navClass(isFacts)}>
              Trending Topics
            </Link>

          </div>

          <hr className="mb-4 mt-5 border-[#2d3f6b]" />
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#aab4c8]">Database</div>
          <Link
            href={databaseHref}
            className={`mb-4 flex h-11 items-center justify-center rounded-xl border px-3 text-sm font-semibold transition-colors ${
              isDatabase
                ? "border-[#5f7bc4] bg-[#2f3f70] text-white"
                : "border-[#3a4f7a] bg-[#243057] text-[#d7e2f8] hover:bg-[#2f3f70]"
            }`}
          >
            Open Database Page
          </Link>

          <hr className="mb-4 border-[#2d3f6b]" />
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#aab4c8]">Inference Mode</div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={modeBusy}
              onClick={() => onModeChange("hybrid")}
              className={`h-10 rounded-lg border text-xs font-semibold uppercase tracking-[0.08em] ${
                mode === "hybrid"
                  ? "border-[#5f7bc4] bg-[#2f3f70] text-white"
                  : "border-[#3a4f7a] bg-[#243057] text-[#d7e2f8] hover:bg-[#2f3f70]"
              }`}
            >
              Hybrid
            </button>
            <button
              type="button"
              disabled={modeBusy}
              onClick={() => onModeChange("openai_only")}
              className={`h-10 rounded-lg border text-xs font-semibold uppercase tracking-[0.08em] ${
                mode === "openai_only"
                  ? "border-[#5f7bc4] bg-[#2f3f70] text-white"
                  : "border-[#3a4f7a] bg-[#243057] text-[#d7e2f8] hover:bg-[#2f3f70]"
              }`}
            >
              OpenAI Only
            </button>
          </div>
          <div className="mb-4 text-[11px] font-semibold text-[#aab4c8]">
            Current: {mode === "openai_only" ? "OpenAI Only" : "Hybrid"}
            {modeBusy ? " · Updating..." : ""}
            {modeError ? ` · ${modeError}` : ""}
          </div>

          <hr className="mb-4 border-[#2d3f6b]" />
          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-[#aab4c8]">
            Filters
          </label>
          <div className="text-xs font-semibold text-white">Media Type</div>
          <select
            className="mt-2 w-full rounded-lg border border-[#3a4f7a] bg-[#243057] px-3 py-2 text-sm text-white outline-none"
            value={selectedMedia}
            onChange={(event) => onMediaChange(event.target.value)}
          >
            {MEDIA_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto p-3">{children}</main>
      </div>
    </div>
  );
}
