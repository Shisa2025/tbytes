import { loadDashboardFeed } from "../clickhouse-feed";

export const dynamic = "force-dynamic";

export default async function BriefingPage() {
  const feed = await loadDashboardFeed(80);

  return (
    <section className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71839f]">Briefing</p>
        <h1 className="text-3xl font-bold text-[#1a2744]">Frequent Questions and Recent Enquiries</h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-[#d8e0ee] bg-white p-4 shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
          <h2 className="text-xl font-bold text-[#1a2744]">Top Frequent Questions</h2>
          <div className="mt-3 space-y-2">
            {feed.frequentQuestions.length === 0 ? (
              <p className="text-sm text-[#5f6f87]">No repeated questions found yet.</p>
            ) : (
              feed.frequentQuestions.map((item, index) => (
                <div key={`fq-${index}`} className="rounded-lg border border-[#e7edf6] bg-[#f9fbff] p-3">
                  <p className="text-sm font-semibold text-[#1f3350]">{item.question}</p>
                  <p className="mt-1 text-xs text-[#53637c]">{item.answer}</p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6d7f9d]">
                    {item.count}x · {item.latestVerdict}
                  </p>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-[#d8e0ee] bg-white p-4 shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
          <h2 className="text-xl font-bold text-[#1a2744]">Recent Enquiry Stream</h2>
          <div className="mt-3 space-y-2">
            {feed.recentItems.slice(0, 20).map((item, index) => (
              <div key={`rq-${index}`} className="rounded-lg border border-[#e7edf6] bg-[#f9fbff] p-3">
                <p className="text-sm text-[#1f3350]">{item.query}</p>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6d7f9d]">
                  {item.timestamp} · {item.verdict}
                </p>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
