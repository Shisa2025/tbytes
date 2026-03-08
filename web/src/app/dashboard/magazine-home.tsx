"use client";

import Link from "next/link";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { useMemo, useRef, useState } from "react";
import type { FeedData, FrequentQuestionItem, QueryLogItem } from "./clickhouse-feed";
import styles from "./magazine-home.module.css";

type CountItem = {
  label: string;
  count: number;
};

function verdictLabel(verdict: string) {
  if (verdict === "true") return "Verified";
  if (verdict === "false") return "False Claim";
  if (verdict === "misleading") return "Misleading";
  if (verdict === "unverified") return "Unverified";
  return "Unknown";
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

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
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

function isEnglishLanguageTag(value?: string) {
  const token = (value || "").trim().toLowerCase();
  if (!token) return false;
  return token === "en" || token === "eng" || token === "english";
}

function hasNonLatinScript(text: string) {
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f]/.test(text || "");
}

function shouldTranslate(text: string, languageTag?: string) {
  if (!text || !text.trim()) return false;
  if (hasNonLatinScript(text)) return true;
  return !isEnglishLanguageTag(languageTag);
}

function canonicalizeQuery(text: string) {
  return (text || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashCode(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function FeedItem({
  item,
  risk,
  translated,
  text,
  crop = 116,
}: {
  item: QueryLogItem;
  risk?: boolean;
  translated?: boolean;
  text?: string;
  crop?: number;
}) {
  return (
    <article
      className={`${styles.feedItem} ${risk ? styles.feedItemRisk : ""} ${translated ? styles.feedItemTranslated : ""}`}
    >
      <div className={styles.feedItemMeta}>
        <span className={styles.timeBadge}>{timeLabel(item.timestamp)}</span>
        <span className={`${styles.verdictChip} ${verdictTone(item.verdict)}`}>{verdictLabel(item.verdict)}</span>
      </div>
      <p className={styles.feedHeadline}>{text ?? trimHeadline(item.query, crop)}</p>
    </article>
  );
}

function FaqItem({
  item,
  question,
  answer,
  translated,
}: {
  item: FrequentQuestionItem;
  question: string;
  answer: string;
  translated?: boolean;
}) {
  return (
    <article className={`${styles.faqItem} ${translated ? styles.feedItemTranslated : ""}`}>
      <div className={styles.feedItemMeta}>
        <span className={styles.metaBadge}>Asked {item.count}x</span>
        <span className={`${styles.verdictChip} ${verdictTone(item.latestVerdict)}`}>{verdictLabel(item.latestVerdict)}</span>
      </div>
      <p className={styles.faqQuestion}>{question}</p>
      <p className={styles.faqAnswer}>{answer}</p>
    </article>
  );
}

export default function MagazineHome({ feed }: { feed: FeedData }) {
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [flipKey, setFlipKey] = useState(0);
  const [activeWord, setActiveWord] = useState<{ word: string; count: number } | null>(null);
  const [translateToEnglish, setTranslateToEnglish] = useState(false);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [translatedMap, setTranslatedMap] = useState<Record<string, string>>({});
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const viewerRef = useRef<HTMLDivElement | null>(null);

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
  const frequentQuestions = useMemo(() => feed.frequentQuestions ?? [], [feed.frequentQuestions]);
  const fakeFacts = useMemo(() => feed.fakeNewsFacts ?? [], [feed.fakeNewsFacts]);
  const wordMap = useMemo(() => feed.wordMap ?? [], [feed.wordMap]);
  const cloudWords = useMemo(() => {
    const slots = [
      [50, 44], [34, 58], [66, 58], [50, 70], [24, 44], [76, 44], [58, 30], [42, 30], [26, 70], [74, 70],
      [17, 56], [83, 56], [13, 38], [87, 38], [20, 26], [80, 26], [50, 18], [35, 16], [65, 16], [50, 82],
      [30, 82], [70, 82], [10, 70], [90, 70],
    ] as Array<[number, number]>;

    const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    const out: Array<{ word: string; count: number; x: number; y: number; rotate: number; size: number }> = [];

    for (let index = 0; index < Math.min(wordMap.length, 22); index += 1) {
      const item = wordMap[index];
      const base = slots[index % slots.length];
      const h = hashCode(item.word);
      const size = 1 + Math.min(item.count, 12) * 0.16;
      const rotate = ((h % 3) - 1) * 8;

      // Approximate text footprint in percentage units inside the cloud canvas.
      const w = Math.min(34, Math.max(8, item.word.length * size * 0.95));
      const hh = Math.min(10, Math.max(4.8, size * 3.8));

      let best = { x: base[0], y: base[1] };
      let found = false;

      for (let attempt = 0; attempt < 18; attempt += 1) {
        const ring = Math.floor(attempt / 6) + 1;
        const theta = ((attempt * 47 + h) % 360) * (Math.PI / 180);
        const radiusX = ring * 4.2;
        const radiusY = ring * 3.6;
        const x = Math.max(7 + w / 2, Math.min(93 - w / 2, base[0] + Math.cos(theta) * radiusX));
        const y = Math.max(13 + hh / 2, Math.min(87 - hh / 2, base[1] + Math.sin(theta) * radiusY));

        const overlaps = placed.some((p) => Math.abs(x - p.x) < (w + p.w) / 2 && Math.abs(y - p.y) < (hh + p.h) / 2);
        if (!overlaps) {
          best = { x, y };
          found = true;
          break;
        }
      }

      if (!found) {
        const x = Math.max(7 + w / 2, Math.min(93 - w / 2, base[0]));
        const y = Math.max(13 + hh / 2, Math.min(87 - hh / 2, base[1]));
        best = { x, y };
      }

      placed.push({ x: best.x, y: best.y, w, h: hh });
      out.push({ ...item, x: best.x, y: best.y, rotate, size });
    }

    return out;
  }, [wordMap]);
  const pageLabels = [
    "Cover",
    "Contents",
    "Lead Case",
    "Recent Enquiries",
    "Repeated Enquiries",
    "Misinformation Cases",
    "Credibility Outcomes",
    "Multilingual Access",
    "Editorial Notebook",
    "Action Blueprint",
    "Top FAQ",
    "Trending Topics",
    "Trust Signals",
    "Word Cloud",
  ];
  const translatableQueries = useMemo(() => {
    const pool = [...recent, ...risks];
    const nonEnglishQueries = pool
      .filter((item) => shouldTranslate(item.query, item.language))
      .map((item) => item.query);
    const nonEnglishLabels = [
      ...mediaMix.map((row) => row.label),
      ...languageMix.map((row) => row.label),
      lead?.media_type ?? "",
      lead?.language ?? "",
    ].filter((x) => shouldTranslate(x));
    const nonEnglishFaqs = frequentQuestions
      .filter((item) => shouldTranslate(item.question, item.latestLanguage) || shouldTranslate(item.answer, item.latestLanguage))
      .flatMap((item) => [item.question, item.answer]);
    const factStrings = fakeFacts
      .flatMap((fact) => [fact.source, fact.title, fact.summary])
      .filter((x) => shouldTranslate(x));
    const wordStrings = wordMap.map((x) => x.word).filter((x) => shouldTranslate(x));
    return [...new Set([...nonEnglishQueries, ...nonEnglishFaqs, ...nonEnglishLabels, ...factStrings, ...wordStrings].filter(Boolean))];
  }, [recent, risks, frequentQuestions, mediaMix, languageMix, lead?.media_type, lead?.language, fakeFacts, wordMap]);
  const totalPages = 14;

  const isTimeout = (feed.error ?? "").toLowerCase().includes("timeout");
  const issueStamp = issueLabel(feed.updatedAt);
  const dangerRate = riskRatio(risks.length, recent.length || 1);
  const knownVerdicts = recent.filter((x) => ["true", "false", "misleading", "unverified"].includes(x.verdict)).length;
  const verdictCoverage = recent.length ? Math.round((knownVerdicts / recent.length) * 100) : 0;
  const nonEnglishCount = recent.filter((x) => !isEnglishLanguageTag(x.language)).length;
  const nonEnglishShare = recent.length ? Math.round((nonEnglishCount / recent.length) * 100) : 0;
  const uniqueLanguages = new Set(recent.map((x) => (x.language || "unknown").toLowerCase())).size;
  const p95Response = percentile(
    recent.map((x) => Number(x.response_time_ms ?? 0)).filter((x) => Number.isFinite(x) && x > 0),
    95,
  );
  const normalizedQueries = recent.map((x) => canonicalizeQuery(x.query)).filter(Boolean);
  const duplicateCount = normalizedQueries.length - new Set(normalizedQueries).size;
  const repeatRate = normalizedQueries.length ? Math.round((duplicateCount / normalizedQueries.length) * 100) : 0;
  const unverifiedCount = recent.filter((x) => x.verdict === "unverified").length;
  const uncertaintyRate = recent.length ? Math.round((unverifiedCount / recent.length) * 100) : 0;

  function plainText(raw: string) {
    return translateToEnglish ? translatedMap[raw] || raw : raw;
  }

  function queryText(raw: string, crop = 88) {
    return trimHeadline(plainText(raw), crop);
  }

  async function fetchMissingTranslations() {
    const missing = translatableQueries.filter((q) => !translatedMap[q]);
    if (missing.length === 0) return;

    setTranslationLoading(true);
    setTranslationError("");
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: missing }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; translations?: string[] };
      if (!response.ok || !payload.ok || !Array.isArray(payload.translations)) {
        throw new Error(payload.error || "Failed to translate dashboard content.");
      }

      const nextMap: Record<string, string> = {};
      for (let i = 0; i < missing.length; i += 1) {
        nextMap[missing[i]] = payload.translations[i] || missing[i];
      }
      setTranslatedMap((prev) => ({ ...prev, ...nextMap }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Translation failed.";
      setTranslationError(message);
      setTranslateToEnglish(false);
    } finally {
      setTranslationLoading(false);
    }
  }

  async function onToggleTranslate() {
    const next = !translateToEnglish;
    setTranslateToEnglish(next);
    if (next) {
      await fetchMissingTranslations();
    } else {
      setTranslationError("");
    }
  }

  function go(delta: 1 | -1) {
    const next = page + delta;
    if (next < 0 || next >= totalPages) return;
    setDirection(delta);
    setPage(next);
    setFlipKey((k) => k + 1);
  }

  async function waitForPaint() {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  function isLikelyBlankCanvas(canvas: HTMLCanvasElement) {
    if (canvas.width < 8 || canvas.height < 8) return true;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;

    try {
      const base = ctx.getImageData(0, 0, 1, 1).data;
      const samples = 72;
      let varied = 0;

      for (let i = 1; i <= samples; i += 1) {
        const x = Math.floor((canvas.width - 1) * (i / (samples + 1)));
        const y = Math.floor((canvas.height - 1) * (((i * 13) % (samples + 1)) / (samples + 1)));
        const px = ctx.getImageData(x, y, 1, 1).data;
        const diff =
          Math.abs(px[0] - base[0]) +
          Math.abs(px[1] - base[1]) +
          Math.abs(px[2] - base[2]) +
          Math.abs(px[3] - base[3]);
        if (diff > 20) {
          varied += 1;
          if (varied >= 3) return false;
        }
      }
      return true;
    } catch {
      // If pixel read fails (security/browser edge), don't treat it as blank.
      return false;
    }
  }

  function preparePageNodeForExport(pageNode: HTMLElement) {
    const undoStack: Array<() => void> = [];
    const setStyle = (el: HTMLElement, key: string, value: string) => {
      const previous = el.style.getPropertyValue(key);
      const hadValue = previous.length > 0;
      el.style.setProperty(key, value);
      undoStack.push(() => {
        if (hadValue) {
          el.style.setProperty(key, previous);
        } else {
          el.style.removeProperty(key);
        }
      });
    };

    setStyle(pageNode, "height", "auto");
    setStyle(pageNode, "minHeight", "auto");
    setStyle(pageNode, "overflow", "visible");
    setStyle(pageNode, "transform", "none");
    setStyle(pageNode, "animation", "none");
    setStyle(pageNode, "backface-visibility", "visible");
    setStyle(pageNode, "-webkit-font-smoothing", "antialiased");
    setStyle(pageNode, "text-rendering", "geometricPrecision");
    pageNode.classList.add(styles.exportCapture);
    undoStack.push(() => {
      pageNode.classList.remove(styles.exportCapture);
    });

    const scrollBlocks = pageNode.querySelectorAll<HTMLElement>(`.${styles.scrollBlock}`);
    scrollBlocks.forEach((node) => {
      setStyle(node, "overflow", "visible");
      setStyle(node, "maxHeight", "none");
      setStyle(node, "height", "auto");
      setStyle(node, "minHeight", "auto");
      setStyle(node, "paddingRight", "0");
      node.scrollTop = 0;
    });

    const framedBlocks = pageNode.querySelectorAll<HTMLElement>(`.${styles.panel}, .${styles.coverPanel}`);
    framedBlocks.forEach((node) => {
      setStyle(node, "minHeight", "auto");
      setStyle(node, "height", "auto");
      setStyle(node, "overflow", "visible");
    });

    return () => {
      for (let i = undoStack.length - 1; i >= 0; i -= 1) {
        undoStack[i]();
      }
    };
  }

  async function onDownloadMagazine() {
    if (downloadLoading) return;
    const viewer = viewerRef.current;
    if (!viewer) return;

    setDownloadLoading(true);
    setDownloadError("");
    const originalPage = page;

    try {
      let pdf: jsPDF | null = null;
      const sheet = viewer.querySelector<HTMLElement>(`.${styles.sheetBase}`);
      if (!sheet) {
        throw new Error("Unable to locate magazine sheet for export.");
      }
      const docWithFonts = document as Document & { fonts?: { ready: Promise<unknown> } };
      if (docWithFonts.fonts?.ready) {
        await docWithFonts.fonts.ready;
      }

      for (let i = 0; i < totalPages; i += 1) {
        setPage(i);
        await waitForPaint();

        const pageNode = sheet.firstElementChild as HTMLElement | null;
        if (!pageNode) {
          throw new Error("Unable to locate rendered magazine page.");
        }
        const restore = preparePageNodeForExport(pageNode);
        const preparedCanvas = await html2canvas(pageNode, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#f5ead3",
        }).finally(() => {
          restore();
        });

        let canvas = preparedCanvas;
        if (isLikelyBlankCanvas(preparedCanvas)) {
          // Fallback: capture the current page again without export-time style overrides.
          canvas = await html2canvas(pageNode, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: "#f5ead3",
          });
          if (isLikelyBlankCanvas(canvas)) {
            throw new Error("Export capture returned blank pages. Please retry after refreshing.");
          }
        }

        const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
        const format: [number, number] = [canvas.width, canvas.height];
        if (!pdf) {
          // Use native captured size so aspect ratio is preserved exactly.
          pdf = new jsPDF({
            orientation,
            unit: "px",
            format,
            compress: true,
          });
        } else {
          pdf.addPage(format, orientation);
        }

        const imgData = canvas.toDataURL("image/png");
        pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height, undefined, "FAST");
      }

      if (!pdf) {
        throw new Error("No pages were captured.");
      }
      const stamp = new Date().toISOString().slice(0, 10);
      pdf.save(`scam-watch-weekly-${stamp}.pdf`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate PDF.";
      setDownloadError(message);
    } finally {
      setPage(originalPage);
      setFlipKey((k) => k + 1);
      setDownloadLoading(false);
    }
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
                { n: "01", title: "Lead Case", desc: lead ? `"${queryText(lead.query, 72)}"` : "No lead record available" },
                { n: "02", title: "Recent Enquiries", desc: `${recentBoard.length} recent question${recentBoard.length !== 1 ? "s" : ""}` },
                { n: "03", title: "Misinformation Cases", desc: risks.length > 0 ? `${risks.length} false/misleading case${risks.length !== 1 ? "s" : ""}` : "No misinformation cases in this window" },
                { n: "04", title: "Credibility Outcomes", desc: `${feed.verdictCounts.length} verdict ${feed.verdictCounts.length !== 1 ? "categories" : "category"}` },
                { n: "05", title: "Multilingual Access", desc: `${languageMix.length} language${languageMix.length !== 1 ? "s" : ""} across ${mediaMix.length} media type${mediaMix.length !== 1 ? "s" : ""}` },
                { n: "06", title: "Word Cloud", desc: `${wordMap.length} frequent keyword${wordMap.length !== 1 ? "s" : ""} from cleaned queries` },
                { n: "07", title: "Fact-check Sources", desc: `${fakeFacts.length} recent web fact-check item${fakeFacts.length !== 1 ? "s" : ""}` },
                { n: "08", title: "Trust Signals", desc: `Risk rate ${dangerRate}% · ${recent.length} total records` },
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

      {/* Page 2: Lead Case */}
      {page === 2 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Lead Case</p>
            <h2 className={styles.panelTitle}>
              {risks.length > 0
                ? `Primary misinformation case in this 30-day window`
                : "No misinformation case found in this 30-day window"}
            </h2>
            <p className={styles.panelSubtitle}>
              {recent.length} records in 30 days. Risk rate = (false + misleading) / total = {dangerRate}%. Lead verdict: {lead ? verdictLabel(lead.verdict) : "N/A"}.
            </p>
          </header>
          <div className={styles.scrollBlock}>
            <p className={`${styles.pullQuote} ${translateToEnglish ? styles.translatedBlock : ""}`}>
              &quot;{lead ? queryText(lead.query, 164) : "No records found in the last 30 days."}&quot;
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
            {lead?.media_type ? <span className={styles.metaBadge}>{plainText(lead.media_type)}</span> : null}
            {lead?.language ? <span className={styles.metaBadge}>{plainText(lead.language)}</span> : null}
          </div>
        </article>
      )}

      {/* Page 3: Recent Enquiries */}
      {page === 3 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Recent Enquiries</p>
            <h3 className={styles.panelTitle}>
              {recentBoard.length > 0 ? `${recentBoard.length} Most Recent Community Questions` : "No Recent Questions"}
            </h3>
          </header>
          <div className={styles.scrollBlock}>
            {recentBoard.length === 0 ? (
              <p className={styles.panelSubtitle}>No records found in the last 30 days.</p>
            ) : (
              <div className={styles.feedList}>
                {recentBoard.map((item, index) => (
                  <FeedItem
                    key={`cover-${index}`}
                    item={item}
                    crop={126}
                    translated={translateToEnglish}
                    text={queryText(item.query, 126)}
                  />
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
                  <FeedItem
                    key={`q-${index}`}
                    item={item}
                    crop={140}
                    translated={translateToEnglish}
                    text={queryText(item.query, 140)}
                  />
                ))}
              </div>
            )}
          </div>
          <p className={styles.panelNote}>
            {questionBoard.length} records from the last 30 days · last updated {issueStamp}. Compare timestamps to identify clusters of repeated queries.
          </p>
        </article>
      )}

      {/* Page 5: Misinformation Cases */}
      {page === 5 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Misinformation Cases</p>
            <h3 className={styles.panelTitle}>
              {risks.length > 0 ? `${risks.length} False or Misleading Cases` : "No False or Misleading Cases"}
            </h3>
          </header>
          <div className={styles.scrollBlock}>
            {riskBoard.length === 0 ? (
              <p className={styles.panelSubtitle}>No false or misleading verdicts in the last 30 days.</p>
            ) : (
              <div className={styles.feedList}>
                {riskBoard.map((item, index) => (
                  <FeedItem
                    key={`risk-${index}`}
                    item={item}
                    risk
                    crop={132}
                    translated={translateToEnglish}
                    text={queryText(item.query, 132)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className={styles.featureBox}>
            <h4 className={styles.featureBoxTitle}>
              {risks[0] ? `Lead ${verdictLabel(risks[0].verdict)} Signal` : "Lead Risk Signal"}
            </h4>
            <p className={`${styles.featureBoxText} ${translateToEnglish ? styles.translatedBlock : ""}`}>
              {risks[0] ? queryText(risks[0].query, 178) : `No high-risk items found in the last 30 days.`}
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
                {feed.verdictCounts.map((row, index) => (
                  <div key={`${row.verdict}-${index}`}>
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

      {/* Page 7: Multilingual Access */}
      {page === 7 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Multilingual Access</p>
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
                    <span className={styles.ledgerName}>{plainText(row.label)}</span>
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
                    <span className={styles.ledgerName}>{plainText(row.label)}</span>
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
              <p className={`${styles.featureBoxText} ${translateToEnglish ? styles.translatedBlock : ""}`}>
                {lead ? queryText(lead.query, 188) : `No lead record available in the last 30 days.`}
              </p>
            </div>
            <div className={styles.feedList}>
              {riskBoard.slice(0, 3).map((item, index) => (
                <FeedItem
                  key={`editor-risk-${index}`}
                  item={item}
                  risk
                  crop={130}
                  translated={translateToEnglish}
                  text={queryText(item.query, 130)}
                />
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

      {/* Page 10: Frequent Questions */}
      {page === 10 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Top FAQ</p>
            <h3 className={styles.panelTitle}>Most Frequent Questions & Answers</h3>
          </header>
          <div className={styles.scrollBlock}>
            {frequentQuestions.length === 0 ? (
              <p className={styles.panelSubtitle}>No repeated questions captured yet.</p>
            ) : (
              <div className={styles.feedList}>
                {frequentQuestions.map((item, index) => (
                  <FaqItem
                    key={`faq-${index}`}
                    item={item}
                    question={queryText(item.question, 148)}
                    answer={queryText(item.answer, 220)}
                    translated={translateToEnglish}
                  />
                ))}
              </div>
            )}
          </div>
          <p className={styles.panelNote}>
            Frequent questions are computed from recent query logs and sorted by repeat count.
          </p>
        </article>
      )}

      {/* Page 11: Trending Topics */}
      {page === 11 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Trending Topics</p>
            <h3 className={styles.panelTitle}>Misinformation Topics Trending Right Now</h3>
          </header>
          <div className={styles.scrollBlock}>
            {fakeFacts.length === 0 ? (
              <p className={styles.panelSubtitle}>
                No scraped fake-news facts found. Run the scraper script in `scripts/` to populate this feed.
              </p>
            ) : (
              <div className={styles.factList}>
                {fakeFacts.slice(0, 10).map((fact, idx) => (
                  <article key={`fact-${idx}`} className={styles.factItem}>
                    <p className={styles.factSource}>{plainText(fact.source)}{fact.published_at ? ` · ${fact.published_at.slice(0, 10)}` : ""}</p>
                    <a href={fact.url} target="_blank" rel="noreferrer" className={styles.factTitle}>
                      {plainText(fact.title)}
                    </a>
                    <p className={styles.factSummary}>{plainText(fact.summary)}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
          <p className={styles.panelNote}>
            This list is loaded from `data/fake_news_facts.json` generated by a scraper script.
          </p>
        </article>
      )}

      {/* Page 12: Community Signals */}
      {page === 12 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Community Signals</p>
            <h3 className={styles.panelTitle}>Trust for Multilingual Communities (Proxy Metrics)</h3>
          </header>
          <div className={styles.scrollBlock}>
            <div className={styles.feedList}>
              <article className={styles.faqItem}>
                <h4 className={styles.featureBoxTitle}>1) Credibility Detection Quality</h4>
                <p className={styles.faqAnswer}>Risk share: <strong>{dangerRate}%</strong> · Verdict coverage: <strong>{verdictCoverage}%</strong></p>
              </article>
              <article className={styles.faqItem}>
                <h4 className={styles.featureBoxTitle}>2) Multilingual Coverage & Fairness</h4>
                <p className={styles.faqAnswer}>Unique languages: <strong>{uniqueLanguages}</strong> · Non-English share: <strong>{nonEnglishShare}%</strong></p>
              </article>
              <article className={styles.faqItem}>
                <h4 className={styles.featureBoxTitle}>3) Context & Explainability</h4>
                <p className={styles.faqAnswer}>Frequent Q&A pairs available: <strong>{frequentQuestions.length}</strong> · Web fact sources loaded: <strong>{fakeFacts.length}</strong></p>
              </article>
              <article className={styles.faqItem}>
                <h4 className={styles.featureBoxTitle}>4) Community Trust & Actionability</h4>
                <p className={styles.faqAnswer}>Repeat enquiry rate (proxy): <strong>{repeatRate}%</strong> · Latest records: <strong>{recent.length}</strong></p>
              </article>
              <article className={styles.faqItem}>
                <h4 className={styles.featureBoxTitle}>5) Operational Reliability</h4>
                <p className={styles.faqAnswer}>P95 response time (proxy): <strong>{Math.round(p95Response)} ms</strong> · Data update: <strong>{issueStamp}</strong></p>
              </article>
              <article className={styles.faqItem}>
                <h4 className={styles.featureBoxTitle}>6) Safety & Uncertainty Handling</h4>
                <p className={styles.faqAnswer}>Unverified rate: <strong>{uncertaintyRate}%</strong> · High-risk items: <strong>{risks.length}</strong></p>
              </article>
            </div>
          </div>
          <p className={styles.panelNote}>
            Risk rate definition: (false + misleading) / total enquiries in the selected window. These are proxy indicators from current schema.
          </p>
        </article>
      )}

      {/* Page 13: Word Cloud */}
      {page === 13 && (
        <article className={styles.panel}>
          <header>
            <p className={styles.sectionTag}>Word Cloud</p>
            <h3 className={styles.panelTitle}>Word Cloud</h3>
          </header>
          <div className={styles.scrollBlock}>
            <div className={styles.wordCloudFrame}>
              {activeWord ? (
                <div className={styles.wordTooltip}>
                  <strong>{plainText(activeWord.word)}</strong> appears <strong>{activeWord.count}</strong> times
                </div>
              ) : (
                <div className={styles.wordTooltipHint}>Click a word to see its frequency.</div>
              )}
              <div className={styles.wordCloudCanvas}>
                {cloudWords.map((item, index) => (
                  <button
                    type="button"
                    key={`wm-${item.word}`}
                    className={`${styles.wordChip} ${styles.wordPlaced} ${styles[`wordTone${(index % 6) + 1}`]}`}
                    style={{
                      fontSize: `${item.size}rem`,
                      left: `${item.x}%`,
                      top: `${item.y}%`,
                      transform: `translate(-50%, -50%) rotate(${item.rotate}deg)`,
                    }}
                    onClick={() => setActiveWord(item)}
                  >
                    {plainText(item.word)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className={styles.panelNote}>
            Keywords are extracted from cleaned enquiries; click any word to see how many times it appears.
          </p>
        </article>
      )}
    </>
  );

  return (
    <section className={`${styles.magazineFrame} ${styles.paperTexture}`}>
      <header className={styles.masthead}>
        <div className={styles.topControls}>
          <h1 className={styles.title}>Scam Watch Weekly</h1>
          <div className={styles.controlActions}>
            <button
              type="button"
              onClick={onToggleTranslate}
              disabled={translationLoading || downloadLoading}
              className={`${styles.translateButton} ${translateToEnglish ? styles.translateButtonOn : ""}`}
            >
              {translationLoading ? "Translating..." : translateToEnglish ? "Show Original" : "Translate to English"}
            </button>
            <button
              type="button"
              onClick={onDownloadMagazine}
              disabled={downloadLoading || translationLoading}
              className={styles.downloadButton}
            >
              {downloadLoading ? "Downloading..." : "Download Magazine"}
            </button>
          </div>
        </div>
        {translationError ? <p className={styles.translationError}>{translationError}</p> : null}
        {downloadError ? <p className={styles.translationError}>{downloadError}</p> : null}
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

      <div ref={viewerRef} className={styles.viewer}>
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
          {String(page + 1).padStart(2, "0")} / {String(totalPages).padStart(2, "0")}
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
      <div className={styles.pageMeta}>
        <span className={styles.metaBadge}>Section: {pageLabels[page] ?? "Magazine"}</span>
        <div className={styles.jumpRail}>
          {[
            { label: "Cover", target: 0 },
            { label: "Contents", target: 1 },
            { label: "Enquiries", target: 3 },
            { label: "Multilingual", target: 7 },
            { label: "FAQ", target: 10 },
            { label: "Trending", target: 11 },
            { label: "Trust Signals", target: 12 },
            { label: "Word Cloud", target: 13 },
          ].map((jump) => (
            <button
              key={jump.label}
              type="button"
              onClick={() => {
                setDirection(jump.target >= page ? 1 : -1);
                setPage(jump.target);
                setFlipKey((k) => k + 1);
              }}
              className={styles.jumpButton}
            >
              {jump.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
