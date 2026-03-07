"""
Scrape recent fake-news fact-check headlines from public RSS feeds and write:
data/fake_news_facts.json
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import feedparser


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "fake_news_facts.json"

RSS_SOURCES = [
    ("PolitiFact Fact Checks", "https://www.politifact.com/rss/factchecks/"),
    ("Snopes Fact Checks", "https://www.snopes.com/feeds/fact-check/"),
    ("Reuters Fact Check", "https://www.reuters.com/fact-check/rss"),
]


def _iso_from_struct(entry: Dict) -> str:
    for key in ("published_parsed", "updated_parsed"):
        value = entry.get(key)
        if value:
            try:
                return datetime(*value[:6], tzinfo=timezone.utc).isoformat()
            except Exception:
                pass
    return ""


def scrape(limit_per_source: int = 12) -> List[Dict]:
    rows: List[Dict] = []

    for source_name, url in RSS_SOURCES:
        parsed = feedparser.parse(url)
        entries = parsed.entries[:limit_per_source]
        for entry in entries:
            rows.append(
                {
                    "source": source_name,
                    "title": (entry.get("title") or "").strip(),
                    "summary": (entry.get("summary") or entry.get("description") or "").strip(),
                    "url": (entry.get("link") or "").strip(),
                    "published_at": _iso_from_struct(entry),
                }
            )

    dedup: Dict[str, Dict] = {}
    for row in rows:
        key = row["url"] or row["title"]
        if not key:
            continue
        dedup[key] = row

    out = list(dedup.values())
    out.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    return out


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "items": scrape(),
    }
    # Keep output shape backward-compatible with dashboard loader (list of facts).
    facts = data["items"]
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(facts, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(facts)} fake-news facts to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
