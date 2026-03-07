"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FeedData, QueryLogItem } from "./clickhouse-feed";
import styles from "./magazine-home.module.css";

type CountItem = {
  label: string;
  count: number;
};

function verdictLabel(verdict: string) {
  if (verdict === "true") return "Verified";
  if (verdict === "false") return "False Claim";
  if (verdict === "misleading") return "Misleading";
  return verdict || "Unknown";
}

function verdictTone(verdict: string) {
  if (verdict === "true") return styles.verdictTrue;
  if (verdict === "false") return styles.verdictFalse;
  if (verdict === "misleading") return styles.verdictMisleading;
  return styles.verdictUnknown;
}

function timeLabel(raw: string) {
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return raw;
  return new Date(ts).toLocaleString("en-SG", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function trimHeadline(text: string, n = 88) {
  const t = text.trim();
  if (!t) return "Untitled signal";
  if (t.length <= n) return t;
  return `${t.slice(0, n)}...`;
}

function countBy(values: string[]): CountItem[] {
  const map = new Map<string, number>();
  for (const v of values) {
    const key = (v || "unknown").toLowerCase();
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function meterWidth(count: number, max: number) {
  return `${Math.max((count / Math.max(max, 1)) * 100, 5)}%`;
}

function riskRatio(risk: number, total: number) {
  if (!total) return 0;
  return Math.round((risk / total) * 100);
}

function issueLabel(raw?: string) {
  if (!raw) return "Unknown";
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return raw;
  return new Date(ts).toLocaleString("en-SG", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FeedItem({
  item,
  risk,
  crop = 116,
}: {
  item: QueryLogItem;
  risk?: boolean;
  crop?: number;
}) {
  return (
    <article className={`${styles.feedItem} ${risk ? styles.feedItemRisk : ""}`}>
      <div className={styles.feedItemMeta}>
        <span className={styles.timeBadge}>{timeLabel(item.timestamp)}</span>
        <span className={`${styles.verdictChip} ${verdictTone(item.verdict)}`}>{verdictLabel(item.verdict)}</span>
      </div>
      <p className={styles.feedHeadline}>{trimHeadline(item.query, crop)}</p>
    </article>
  );
}

export default function MagazineHome({ feed }: { feed: FeedData }) {
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [flipKey, setFlipKey] = useState(0);

  const recent = useMemo(() => feed.recentItems, [feed.recentItems]);
  const risks = useMemo(() => feed.riskItems, [feed.riskItems]);
  const lead = risks[0] ?? recent[0];
  const recentBoard = recent.slice(0, 12);
  const questionBoard = recent;
  const riskBoard = risks;
  const verdictMax = Math.max(...feed.verdictCounts.map((x) => x.count), 1);
  const mediaMix = useMemo(
    () => countBy(
      recent.filter((x) => x.media_type && x.media_type.trim()).map((x) => x.media_type as string)
    ).slice(0, 6),
    [recent],
  );
  const languageMix = useMemo(
    () => countBy(
      recent.filter((x) => x.language && x.language.trim()).map((x) => x.language as string)
    ).slice(0, 6),
    [recent],
  );
  const totalPages = 10;

  const isTimeout = (feed.error ?? "").toLowerCase().includes("timeout");
  const issueStamp = issueLabel(feed.updatedAt);
  const dangerRate = riskRatio(risks.length, recent.length || 1);

  function go(delta: 1 | -1) {
    const next = page + delta;
    if (next < 0 || next >= totalPages) return;
    setDirection(delta);
    setPage(next);
    setFlipKey((k) => k + 1);
  }

  const spread = (
    <>
      {/* Page 0: Cover image */}
      {page === 0 && (
        <article className={styles.coverPanel}>
          <div className={styles.coverImageWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/unnamed.jpg" alt="TBytes Magazine Cover" />
          </div>
          <div className={styles.coverOverlay} />
          <div className={styles.coverContent}>
            <div>
              <h2 className={styles.coverHeadline}>Scam Watch<br />Weekly</h2>
              <p className={styles.coverByline}>{issueStamp} · {recent.length} queries · {dangerRate}% risk rate</p>
            </div>
          </div>
        </article>
      )}

      {/* Page 1: Table of contents */}
      {page === 1 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>In This Issue</p>
            <h3 className={styles.panelTitle}>Contents</h3>
          </header>
          <div className={styles.scrollBlock}>
            <div className={styles.tocList}>
              {[
                { n: "01", title: "Cover Feature", desc: lead ? `"${trimHeadline(lead.query, 72)}"` : "No lead record available" },
                { n: "02", title: "Frontline Bulletin", desc: `${recentBoard.length} recent question${recentBoard.length !== 1 ? "s" : ""} logged` },
                { n: "03", title: "Question Ledger", desc: `${questionBoard.length} inquiries in the last 30 days` },
                { n: "04", title: "Fraud Radar", desc: risks.length > 0 ? `${risks.length} high-risk signal${risks.length !== 1 ? "s" : ""} detected` : "No risk signals in current window" },
                { n: "05", title: "Verdict Spectrum", desc: `${feed.verdictCounts.length} verdict ${feed.verdictCounts.length !== 1 ? "categories" : "category"} · 14-day window` },
                { n: "06", title: "Topic & Language", desc: `${mediaMix.length} media type${mediaMix.length !== 1 ? "s" : ""} · ${languageMix.length} language${languageMix.length !== 1 ? "s" : ""} detected` },
                { n: "07", title: "Editorial Notebook", desc: lead ? `Focus: ${trimHeadline(lead.query, 55)}` : "No focus story available" },
                { n: "08", title: "Action Blueprint", desc: `${dangerRate}% risk rate · ${recent.length} total records` },
              ].map((item) => (
                <div key={item.n} className={styles.tocItem}>
                  <span className={styles.tocNumber}>{item.n}</span>
                  <div>
                    <div className={styles.tocTitle}>{item.title}</div>
                    <div className={styles.tocDesc}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.storyMetaRow}>
            <span className={`${styles.badge} ${feed.connected ? styles.statusLive : styles.statusDown}`}>
              {feed.connected ? `${recent.length} Records Live` : "Data Unavailable"}
            </span>
            <span className={styles.metaBadge}>{dangerRate}% Risk Rate</span>
          </div>
        </article>
      )}

      {/* Page 2: Cover Feature */}
      {page === 2 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Cover Feature</p>
            <h2 className={styles.panelTitle}>
              {risks.length > 0
                ? `${risks.length} High-Risk Signal${risks.length !== 1 ? "s" : ""} Require Your Attention`
                : "No High-Risk Signals in Current Window"}
            </h2>
            <p className={styles.panelSubtitle}>
              {recent.length} records from the last 30 days · {risks.length} high-risk {risks.length !== 1 ? "entries" : "entry"} · {dangerRate}% risk rate. Lead verdict: {lead ? verdictLabel(lead.verdict) : "N/A"}.
            </p>
          </header>
          <div className={styles.scrollBlock}>
            <p className={styles.pullQuote}>
              "{lead ? trimHeadline(lead.query, 164) : "No records found in the last 30 days."}"
            </p>
            <div className={styles.splitStats}>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Queries (30 days)</span>
                <span className={styles.statValue}>{recent.length}</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>False / Misleading</span>
                <span className={styles.statValue}>{risks.length}</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Risk Rate</span>
                <span className={styles.statValue}>{dangerRate}%</span>
              </div>
            </div>
          </div>
          <div className={styles.storyMetaRow}>
            <span className={styles.timeBadge}>{lead ? timeLabel(lead.timestamp) : issueStamp}</span>
            {lead ? <span className={`${styles.verdictChip} ${verdictTone(lead.verdict)}`}>{verdictLabel(lead.verdict)}</span> : null}
            {lead?.media_type ? <span className={styles.metaBadge}>{lead.media_type}</span> : null}
            {lead?.language ? <span className={styles.metaBadge}>{lead.language}</span> : null}
          </div>
        </article>
      )}

      {/* Page 3: Frontline Bulletin */}
      {page === 3 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Frontline Bulletin</p>
            <h3 className={styles.panelTitle}>
              {recentBoard.length > 0 ? `${recentBoard.length} Recently Updated Questions` : "No Recent Questions"}
            </h3>
          </header>
          <div className={styles.scrollBlock}>
            {recentBoard.length === 0 ? (
              <p className={styles.panelSubtitle}>No records found in the last 30 days.</p>
            ) : (
              <div className={styles.feedList}>
                {recentBoard.map((item, index) => (
                  <FeedItem key={`cover-${index}`} item={item} crop={126} />
                ))}
              </div>
            )}
          </div>
          <p className={styles.panelNote}>
            {recentBoard.length} of {recent.length} records shown · last updated {issueStamp}. Use these as swipe-ready snippets for the Telegram Mini App.
          </p>
        </article>
      )}

      {/* Page 4: Question Ledger */}
      {page === 4 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Question Ledger</p>
            <h3 className={styles.panelTitle}>Recent Inquiry Stream · {questionBoard.length} Records</h3>
          </header>
          <div className={styles.scrollBlock}>
            {questionBoard.length === 0 ? (
              <p className={styles.panelSubtitle}>No inquiry records found in the last 30 days.</p>
            ) : (
              <div className={styles.feedList}>
                {questionBoard.map((item, index) => (
                  <FeedItem key={`q-${index}`} item={item} crop={140} />
                ))}
              </div>
            )}
          </div>
          <p className={styles.panelNote}>
            {questionBoard.length} records from the last 30 days · last updated {issueStamp}. Compare timestamps to identify clusters of repeated queries.
          </p>
        </article>
      )}

      {/* Page 5: Fraud Radar */}
      {page === 5 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Fraud Radar</p>
            <h3 className={styles.panelTitle}>
              {risks.length > 0 ? `${risks.length} Active Risk Signal${risks.length !== 1 ? "s" : ""}` : "No Active Risk Signals"}
            </h3>
          </header>
          <div className={styles.scrollBlock}>
            {riskBoard.length === 0 ? (
              <p className={styles.panelSubtitle}>No false or misleading verdicts in the last 30 days.</p>
            ) : (
              <div className={styles.feedList}>
                {riskBoard.map((item, index) => (
                  <FeedItem key={`risk-${index}`} item={item} risk crop={132} />
                ))}
              </div>
            )}
          </div>
          <div className={styles.featureBox}>
            <h4 className={styles.featureBoxTitle}>
              {risks[0] ? `Lead ${verdictLabel(risks[0].verdict)} Signal` : "Lead Risk Signal"}
            </h4>
            <p className={styles.featureBoxText}>
              {risks[0] ? trimHeadline(risks[0].query, 178) : `No high-risk items found in the last 30 days.`}
            </p>
          </div>
        </article>
      )}

      {/* Page 6: Verdict Spectrum */}
      {page === 6 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>14-Day Pulse</p>
            <h3 className={styles.panelTitle}>
              Verdict Breakdown · {feed.verdictCounts.length} {feed.verdictCounts.length !== 1 ? "Categories" : "Category"}
            </h3>
          </header>
          <div className={styles.scrollBlock}>
            {feed.verdictCounts.length === 0 ? (
              <p className={styles.panelSubtitle}>No verdict data found for the last 14 days.</p>
            ) : (
              <div className={styles.metricRows}>
                {feed.verdictCounts.map((row) => (
                  <div key={row.verdict}>
                    <div className={styles.metricHeader}>
                      <span className={styles.metricName}>{verdictLabel(row.verdict)}</span>
                      <span className={styles.metricValue}>{row.count}</span>
                    </div>
                    <div className={styles.metricBarTrack}>
                      <div className={styles.metricBarFill} style={{ width: meterWidth(row.count, verdictMax) }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className={styles.panelNote}>
            {feed.verdictCounts.reduce((s, r) => s + r.count, 0)} total verdicts across {feed.verdictCounts.length} {feed.verdictCounts.length !== 1 ? "categories" : "category"} in the last 14 days. Bars show relative volume — spikes in false or misleading indicate active misinformation.
          </p>
        </article>
      )}

      {/* Page 7: Distribution Desk */}
      {page === 7 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Distribution Desk</p>
            <h3 className={styles.panelTitle}>
              {mediaMix.length > 0 ? `${mediaMix.length} Media Type${mediaMix.length !== 1 ? "s" : ""}` : "No Media"} · {languageMix.length > 0 ? `${languageMix.length} Language${languageMix.length !== 1 ? "s" : ""}` : "No Language"}
            </h3>
          </header>
          <div className={styles.scrollBlock}>
            <p className={styles.sectionTag} style={{ marginBottom: "0.45rem" }}>Media Type</p>
            <div className={styles.ledger} style={{ marginBottom: "0.9rem" }}>
              {mediaMix.length === 0 ? (
                <p className={styles.panelSubtitle}>No media type recorded in the last 30 days.</p>
              ) : (
                mediaMix.map((row) => (
                  <div key={`m-${row.label}`} className={styles.ledgerRow}>
                    <span className={styles.ledgerName}>{row.label}</span>
                    <span className={styles.ledgerCount}>{row.count}</span>
                  </div>
                ))
              )}
            </div>
            <p className={styles.sectionTag} style={{ marginBottom: "0.45rem" }}>Language</p>
            <div className={styles.ledger}>
              {languageMix.length === 0 ? (
                <p className={styles.panelSubtitle}>No language recorded in the last 30 days.</p>
              ) : (
                languageMix.map((row) => (
                  <div key={`l-${row.label}`} className={styles.ledgerRow}>
                    <span className={styles.ledgerName}>{row.label}</span>
                    <span className={styles.ledgerCount}>{row.count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <p className={styles.panelNote}>
            Dominant media: <strong>{mediaMix[0]?.label ?? "N/A"}</strong> ({mediaMix[0]?.count ?? 0} records). Top language: <strong>{languageMix[0]?.label ?? "N/A"}</strong>. Prioritise localisation for the leading channel.
          </p>
        </article>
      )}

      {/* Page 8: Editorial Notebook */}
      {page === 8 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Editorial Notebook</p>
            <h3 className={styles.panelTitle}>
              {risks.length > 0
                ? `How to Package ${risks.length} Risk ${risks.length !== 1 ? "Stories" : "Story"} This Issue`
                : "How to Package This Issue"}
            </h3>
          </header>
          <div className={styles.scrollBlock}>
            <p className={styles.panelSubtitle}>
              {risks.length > 0
                ? `${risks.length} high-risk ${risks.length !== 1 ? "entries" : "entry"} identified this window. Turn each into a swipeable card with one key claim, one verdict, and one brief rationale.`
                : "No high-risk entries found in the current 30-day window. Monitor for new false or misleading verdicts."}
            </p>
            <div className={styles.featureBox}>
              <h4 className={styles.featureBoxTitle}>
                {lead ? `${verdictLabel(lead.verdict)} — Narrative in Focus` : "Narrative in Focus"}
              </h4>
              <p className={styles.featureBoxText}>
                {lead ? trimHeadline(lead.query, 188) : `No lead record available in the last 30 days.`}
              </p>
            </div>
            <div className={styles.feedList}>
              {riskBoard.slice(0, 3).map((item, index) => (
                <FeedItem key={`editor-risk-${index}`} item={item} risk crop={130} />
              ))}
            </div>
          </div>
          <p className={styles.panelNote}>
            {riskBoard.slice(0, 3).length} top risk {riskBoard.slice(0, 3).length !== 1 ? "entries" : "entry"} shown. Dominant verdict this window: {feed.verdictCounts[0] ? verdictLabel(feed.verdictCounts[0].verdict) : "N/A"} ({feed.verdictCounts[0]?.count ?? 0} occurrences).
          </p>
        </article>
      )}

      {/* Page 9: Publishing Board */}
      {page === 9 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Publishing Board</p>
            <h3 className={styles.panelTitle}>Action Blueprint · {recent.length} Records</h3>
          </header>
          <div className={styles.scrollBlock}>
            <div className={styles.checklist}>
              <div className={styles.checkItem}>
                1. {recent.length} records available in the current 30-day window. Refresh to pull the latest data.
              </div>
              <div className={styles.checkItem}>
                2. {risks.length} false/misleading {risks.length !== 1 ? "verdicts" : "verdict"} require immediate attention — prioritise these in the first two slides.
              </div>
              <div className={styles.checkItem}>
                3. Generate one visual card per risky query. Current risk rate: {dangerRate}%. Include source and mitigation cue per card.
              </div>
              <div className={styles.checkItem}>
                4. Publish a daily issue. Last data update: {issueStamp}. Compare against analytics page trend movement.
              </div>
            </div>
          </div>
          <div className={styles.storyMetaRow}>
            <Link href="/dashboard/analysis" className={styles.analysisLink}>
              Open Analytics
            </Link>
          </div>
        </article>
      )}
    </>
  );

  return (
    <section className={`${styles.magazineFrame} ${styles.paperTexture}`}>
      <header className={styles.masthead}>
        <h1 className={styles.title}>Scam Watch Weekly</h1>
      </header>

      {!feed.connected ? (
        <div className={styles.errorBanner}>
          <div className={styles.errorTitle}>Data feed unavailable</div>
          <div>{feed.error || "Unable to load data"}</div>
          {isTimeout ? (
            <div className={styles.errorHint}>
              Connection timed out. Check network connectivity and try again.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.viewer}>
        <div key={flipKey} className={`${styles.sheetBase} ${direction > 0 ? styles.flipForward : styles.flipBackward}`}>
          {spread}
        </div>
      </div>

      <footer className={styles.pageFooter}>
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={page === 0}
          className={styles.pageButton}
        >
          {"<"}
        </button>
        <span className={styles.pageIndicator}>
          {String(page + 1).padStart(2, "0")} / 10
        </span>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={page === totalPages - 1}
          className={styles.pageButton}
        >
          {">"}
        </button>
      </footer>
    </section>
  );
}
