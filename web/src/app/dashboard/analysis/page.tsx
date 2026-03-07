import DashboardClient from "./dashboard-client";
import { loadQueryLogs } from "./query-logs";

export const dynamic = "force-dynamic";

export default async function Home() {
  const result = await loadQueryLogs();
  return (
    <DashboardClient
      logs={result.rows}
      connected={result.connected}
      error={result.error}
    />
  );
}
