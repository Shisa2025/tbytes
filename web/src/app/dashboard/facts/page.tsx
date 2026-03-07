import { loadDashboardFeed } from "../clickhouse-feed";

export const dynamic = "force-dynamic";

export default async function FactsPage() {
  const feed = await loadDashboardFeed(30);

  return (
    <section className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71839f]">Fact Feed</p>
        <h1 className="text-3xl font-bold text-[#1a2744]">Recent Fake-News Facts from Web Sources</h1>
        <p className="text-sm text-[#5f6f87]">Source file: `data/fake_news_facts.json` from scraper in `scripts/`.</p>
      </header>

      <div className="grid gap-3">
        {feed.fakeNewsFacts.length === 0 ? (
          <article className="rounded-2xl border border-[#f2d8d8] bg-[#fff6f6] p-4 text-[#7a2e2e]">
            No web facts found yet. Run `python scripts/scrape_fake_news_facts.py`.
          </article>
        ) : (
          feed.fakeNewsFacts.map((fact, idx) => (
            <article key={`fact-${idx}`} className="rounded-2xl border border-[#d8e0ee] bg-white p-4 shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#6f80a0]">
                {fact.source}
                {fact.published_at ? ` · ${fact.published_at.slice(0, 10)}` : ""}
              </p>
              <a href={fact.url} target="_blank" rel="noreferrer" className="mt-1 block text-lg font-bold text-[#1b3b76]">
                {fact.title}
              </a>
              <p className="mt-1 text-sm text-[#50617d]">{fact.summary}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
