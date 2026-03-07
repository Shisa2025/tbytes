"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

  const media = searchParams.get("media");
  const selectedMedia = media && media.trim() ? media : "All";

  const paramsForNav = new URLSearchParams(searchParams.toString());
  if (!paramsForNav.get("media")) {
    paramsForNav.delete("media");
  }
  const navQuery = paramsForNav.toString();
  const homeHref = navQuery ? `/dashboard?${navQuery}` : "/dashboard";
  const analysisHref = navQuery ? `/dashboard/analysis?${navQuery}` : "/dashboard/analysis";

  const isHome = pathname === "/dashboard";
  const isAnalysis = pathname.startsWith("/dashboard/analysis");

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

  return (
    <div className="h-screen w-full bg-[#eef2f7]">
      <div className="flex h-full w-full flex-col lg:flex-row">
        <aside className="w-full shrink-0 bg-[#1a2744] px-5 py-6 text-white lg:h-full lg:w-[300px]">
          <div className="mb-8 text-center text-xl font-bold">&lt;&lt;</div>
          <div className="mb-5 flex flex-col items-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[#243057] text-xl">Q</div>
            <div className="text-xl font-bold">TBytes</div>
            <div className="text-sm text-[#aab4c8]">Fact-Check System</div>
          </div>

          <hr className="mb-4 border-[#2d3f6b]" />
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#aab4c8]">Navigation</div>
          <div className="space-y-2 text-base">
            <Link href={homeHref} className={navClass(isHome)}>
              Home
            </Link>
            <Link href={analysisHref} className={navClass(isAnalysis)}>
              Analytics
            </Link>
            <div className="flex h-11 items-center rounded-md px-3">Logs</div>
            <div className="flex h-11 items-center rounded-md px-3">Settings</div>
          </div>

          <hr className="mb-4 mt-5 border-[#2d3f6b]" />
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#aab4c8]">Database</div>
          <div className="mb-4 rounded-xl bg-[#2a1a2e] p-3 text-sm text-[#d9b7bd]">
            <div className="mb-1 font-semibold text-[#e8534a]">Disconnected</div>
            <div className="break-all text-xs text-[#b8a4ab]">ClickHouse status not connected in this UI</div>
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

        <main className="flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}
