import DashboardClient from "./dashboard-client";
import { loadQueryLogs } from "./query-logs";

export default async function Home() {
  const logs = await loadQueryLogs();
  return <DashboardClient logs={logs} />;
}
