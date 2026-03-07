import { createClient } from "@clickhouse/client";
import { NextResponse } from "next/server";
import {
  loadDashboardFeed,
  normalizeClickHouseErrorMessage,
  resolveClickHouseConfig,
} from "@/app/dashboard/clickhouse-feed";

export const dynamic = "force-dynamic";

type DbAction = "ping" | "recent" | "risks" | "verdicts";

function parseAction(value: unknown): DbAction | null {
  if (value === "ping" || value === "recent" || value === "risks" || value === "verdicts") {
    return value;
  }
  return null;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    actions: ["ping", "recent", "risks", "verdicts"],
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = parseAction(body?.action);

  if (!action) {
    return NextResponse.json(
      { ok: false, error: "Invalid action. Use one of: ping, recent, risks, verdicts." },
      { status: 400 },
    );
  }

  if (action === "ping") {
    const cfg = resolveClickHouseConfig();
    if (!cfg.url) {
      return NextResponse.json({ ok: false, error: "Missing CH_HOST in env" }, { status: 400 });
    }

    const client = createClient({
      url: cfg.url,
      username: cfg.user,
      password: cfg.password,
      database: cfg.database,
      request_timeout: cfg.requestTimeout,
    });

    try {
      const result = await client.query({
        query: "SELECT 1 AS ok",
        format: "JSONEachRow",
      });
      const rows = await result.json<{ ok: number }>();
      return NextResponse.json({
        ok: true,
        data: {
          message: "ClickHouse connection is healthy.",
          value: Number(rows[0]?.ok ?? 1),
          endpoint: cfg.url,
          database: cfg.database,
        },
      });
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: normalizeClickHouseErrorMessage(error, cfg.url) },
        { status: 500 },
      );
    } finally {
      await client.close();
    }
  }

  const feed = await loadDashboardFeed(24);
  if (!feed.connected) {
    return NextResponse.json({ ok: false, error: feed.error || "Failed to query ClickHouse" }, { status: 500 });
  }

  if (action === "recent") {
    return NextResponse.json({
      ok: true,
      data: {
        updatedAt: feed.updatedAt,
        items: feed.recentItems.slice(0, 10),
      },
    });
  }

  if (action === "risks") {
    return NextResponse.json({
      ok: true,
      data: {
        updatedAt: feed.updatedAt,
        items: feed.riskItems.slice(0, 10),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    data: {
      updatedAt: feed.updatedAt,
      counts: feed.verdictCounts,
    },
  });
}
