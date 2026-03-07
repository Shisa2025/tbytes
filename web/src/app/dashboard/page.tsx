import MagazineHome from "./magazine-home";
import { loadDashboardFeed } from "./clickhouse-feed";

export const dynamic = "force-dynamic";

export default async function DashboardHomePage() {
  const feed = await loadDashboardFeed(36);
  return <MagazineHome feed={feed} />;
}
