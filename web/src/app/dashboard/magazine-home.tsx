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

  const recent = useMemo(() => feed.recentItems.slice(0, 16), [feed.recentItems]);
  const risks = useMemo(() => feed.riskItems.slice(0, 14), [feed.riskItems]);
  const lead = risks[0] ?? recent[0];
  const recentBoard = recent.slice(0, 8);
  const questionBoard = recent.slice(0, 10);
  const riskBoard = risks.slice(0, 10);
  const verdictMax = Math.max(...feed.verdictCounts.map((x) => x.count), 1);
  const mediaMix = useMemo(
    () => countBy(recent.map((x) => x.media_type || "unknown")).slice(0, 6),
    [recent],
  );
  const languageMix = useMemo(
    () => countBy(recent.map((x) => x.language || "unknown")).slice(0, 6),
    [recent],
  );
  const totalPages = 4;

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
      {page === 0 && (
        <>
          <article className={styles.panel}>
            <header>
              <p className={styles.sectionTag}>Cover Feature</p>
              <h2 className={styles.panelTitle}>
                Scam Signals You Should Not Ignore This Week
              </h2>
              <p className={styles.panelSubtitle}>
                Built from your latest ClickHouse logs, this lead spread highlights the top inquiry pattern and the
                most urgent misinformation narrative in circulation.
              </p>
            </header>
            <div className={styles.scrollBlock}>
              <p className={styles.pullQuote}>
                "{lead ? trimHeadline(lead.query, 164) : "No fresh records were returned from query_logs."}"
              </p>
              <div className={styles.splitStats}>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Recent Items</span>
                  <span className={styles.statValue}>{recent.length}</span>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Risk Entries</span>
                  <span className={styles.statValue}>{risks.length}</span>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Risk Rate</span>
                  <span className={styles.statValue}>{dangerRate}%</span>
                </div>
              </div>
            </div>
            <div className={styles.storyMetaRow}>
              <span className={styles.timeBadge}>{lead ? timeLabel(lead.timestamp) : "No timestamp"}</span>
              {lead ? (
                <span className={`${styles.verdictChip} ${verdictTone(lead.verdict)}`}>{verdictLabel(lead.verdict)}</span>
              ) : null}
              {lead?.media_type ? <span className={styles.metaBadge}>{lead.media_type}</span> : null}
              {lead?.language ? <span className={styles.metaBadge}>{lead.language}</span> : null}
            </div>
          </article>

          <article className={styles.panel}>
            <header>
              <p className={styles.sectionTag}>Frontline Bulletin</p>
              <h3 className={styles.panelTitle}>Recently Updated Questions</h3>
            </header>
            <div className={styles.scrollBlock}>
              {recentBoard.length === 0 ? (
                <p className={styles.panelSubtitle}>No recent rows returned from ClickHouse.</p>
              ) : (
                <div className={styles.feedList}>
                  {recentBoard.map((item, index) => (
                    <FeedItem key={`cover-${index}`} item={item} crop={126} />
                  ))}
                </div>
              )}
            </div>
            <p className={styles.panelNote}>
              Issue checkpoint: {issueStamp}. Keep these cards as swipe-ready snippets for your Telegram Mini App.
            </p>
          </article>
        </>
      )}

      {page === 1 && (
        <>
          <article className={styles.panel}>
            <header>
              <p className={styles.sectionTag}>Question Ledger</p>
              <h3 className={styles.panelTitle}>Recent Inquiry Stream</h3>
            </header>
            <div className={styles.scrollBlock}>
              {questionBoard.length === 0 ? (
                <p className={styles.panelSubtitle}>No question records available.</p>
              ) : (
                <div className={styles.feedList}>
                  {questionBoard.map((item, index) => (
                    <FeedItem key={`q-${index}`} item={item} crop={140} />
                  ))}
                </div>
              )}
            </div>
            <p className={styles.panelNote}>
              Editorial note: focus on recurring topics appearing within short time windows.
            </p>
          </article>

          <article className={styles.panel}>
            <header>
              <p className={styles.sectionTag}>Fraud Radar</p>
              <h3 className={styles.panelTitle}>Scam / Misinformation Signals</h3>
            </header>
            <div className={styles.scrollBlock}>
              {riskBoard.length === 0 ? (
                <p className={styles.panelSubtitle}>No false or misleading entries in the latest window.</p>
              ) : (
                <div className={styles.feedList}>
                  {riskBoard.map((item, index) => (
                    <FeedItem key={`risk-${index}`} item={item} risk crop={132} />
                  ))}
                </div>
              )}
            </div>
            <div className={styles.featureBox}>
              <h4 className={styles.featureBoxTitle}>Lead Risk Signal</h4>
              <p className={styles.featureBoxText}>
                {risks[0]
                  ? trimHeadline(risks[0].query, 178)
                  : "No high-risk item in the selected time window."}
              </p>
            </div>
          </article>
        </>
      )}

      {page === 2 && (
        <>
          <article className={styles.panel}>
            <header>
              <p className={styles.sectionTag}>14-Day Pulse</p>
              <h3 className={styles.panelTitle}>Verdict Spectrum</h3>
            </header>
            <div className={styles.scrollBlock}>
              {feed.verdictCounts.length === 0 ? (
                <p className={styles.panelSubtitle}>No verdict distribution returned.</p>
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
              The bars compare relative volume, making spikes in false or misleading verdicts immediately visible.
            </p>
          </article>

          <article className={styles.panel}>
            <header>
              <p className={styles.sectionTag}>Distribution Desk</p>
              <h3 className={styles.panelTitle}>Topic and Language Mix</h3>
            </header>
            <div className={styles.dualColumn}>
              <section className={styles.miniPanel}>
                <p className={styles.sectionTag}>Media Type</p>
                <div className={styles.ledger}>
                  {mediaMix.length === 0 ? (
                    <p className={styles.panelSubtitle}>No media data available.</p>
                  ) : (
                    mediaMix.map((row) => (
                      <div key={`m-${row.label}`} className={styles.ledgerRow}>
                        <span className={styles.ledgerName}>{row.label}</span>
                        <span className={styles.ledgerCount}>{row.count}</span>
                      </div>
                    ))
                  )}
                </div>
              </section>
              <section className={styles.miniPanel}>
                <p className={styles.sectionTag}>Language</p>
                <div className={styles.ledger}>
                  {languageMix.length === 0 ? (
                    <p className={styles.panelSubtitle}>No language data available.</p>
                  ) : (
                    languageMix.map((row) => (
                      <div key={`l-${row.label}`} className={styles.ledgerRow}>
                        <span className={styles.ledgerName}>{row.label}</span>
                        <span className={styles.ledgerCount}>{row.count}</span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
            <p className={styles.panelNote}>Use this spread to decide which narratives to localize or prioritize.</p>
          </article>
        </>
      )}

      {page === 3 && (
        <>
          <article className={styles.panel}>
            <header>
              <p className={styles.sectionTag}>Editorial Notebook</p>
              <h3 className={styles.panelTitle}>How to Package This Week's Story</h3>
            </header>
            <div className={styles.scrollBlock}>
              <p className={styles.panelSubtitle}>
                Turn the highest-risk entries into swipeable cards. Each card should have one key claim, one verdict,
                and one brief rationale to keep reading friction low in Telegram.
              </p>
              <div className={styles.featureBox}>
                <h4 className={styles.featureBoxTitle}>Narrative in Focus</h4>
                <p className={styles.featureBoxText}>
                  {lead
                    ? trimHeadline(lead.query, 188)
                    : "No lead record available. Check ClickHouse connectivity and query window settings."}
                </p>
              </div>
              <div className={styles.feedList}>
                {riskBoard.slice(0, 3).map((item, index) => (
                  <FeedItem key={`editor-risk-${index}`} item={item} risk crop={130} />
                ))}
              </div>
            </div>
            <p className={styles.panelNote}>
              Keep card titles short and visual-first. Users should understand the risk within three seconds.
            </p>
          </article>

          <article className={styles.panel}>
            <header>
              <p className={styles.sectionTag}>Publishing Board</p>
              <h3 className={styles.panelTitle}>Action Blueprint</h3>
            </header>
            <div className={styles.scrollBlock}>
              <div className={styles.checklist}>
                <div className={styles.checkItem}>1. Pull the latest rows from `query_logs` at issue refresh.</div>
                <div className={styles.checkItem}>
                  2. Prioritize `false` and `misleading` verdicts in the first two slides.
                </div>
                <div className={styles.checkItem}>
                  3. Generate one visual card per risky query with source and mitigation cue.
                </div>
                <div className={styles.checkItem}>
                  4. Publish a daily issue and compare with the analytics page trend movement.
                </div>
              </div>
            </div>
            <div className={styles.storyMetaRow}>
              <Link href="/dashboard/analysis" className={styles.analysisLink}>
                Open Analytics
              </Link>
            </div>
          </article>
        </>
      )}
    </>
  );

  return (
    <section className={`${styles.magazineFrame} ${styles.paperTexture}`}>
      <header className={styles.masthead}>
        <div className={styles.mastheadTop}>
          <span className={`${styles.badge} ${styles.brandBadge}`}>TBytes Magazine</span>
          <span className={`${styles.badge} ${feed.connected ? styles.statusLive : styles.statusDown}`}>
            {feed.connected ? "Data Live" : "Data Unavailable"}
          </span>
          <span className={styles.issueText}>Issue updated: {issueStamp}</span>
        </div>
        <h1 className={styles.title}>Scam Watch Weekly</h1>
        <p className={styles.subtitle}>
          Magazine-style intelligence spread generated from your recent ClickHouse activity, optimized for visual reading
          and fast editorial decisions.
        </p>
      </header>

      {!feed.connected ? (
        <div className={styles.errorBanner}>
          <div className={styles.errorTitle}>ClickHouse query failed</div>
          <div>{feed.error || "Unknown error"}</div>
          {isTimeout ? (
            <div className={styles.errorHint}>
              Timeout detected: check outbound network, IP allowlist, and CH_REQUEST_TIMEOUT.
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
          {String(page + 1).padStart(2, "0")} / 04
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
