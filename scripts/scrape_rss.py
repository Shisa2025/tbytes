"""
scrape_rss.py

Scrapes trusted RSS-based sources and saves extracted articles to JSON.

Responsibilities:
1. Read article metadata from RSS feeds.
2. Visit each article URL.
3. Extract the article title and body text.
4. Save successful extractions to data/rss_sources.json.

Current RSS sources:
- CNA
- Straits Times
"""

import json
from pathlib import Path
from datetime import datetime

import feedparser
import requests
from bs4 import BeautifulSoup

REQUEST_TIMEOUT = 10
MAX_PER_SOURCE = 30
OUTPUT_FILE = Path("data/rss_sources.json")

RSS_SOURCES = {
    "CNA": "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416",
    "ST": "https://www.straitstimes.com/news/singapore/rss.xml",
}


def format_date(date_str: str) -> str:
    """
    Convert RSS date format into dd-mm-yy.
    Example:
    Fri, 06 Mar 2026 23:09:53 +0800 -> 06-03-26
    """
    try:
        dt = datetime.strptime(date_str, "%a, %d %b %Y %H:%M:%S %z")
        return dt.strftime("%d-%m-%y")
    except Exception:
        return date_str


def fetch_rss_entries() -> list[dict]:
    """
    Fetch article metadata from all configured RSS feeds.
    Returns a list of article dictionaries without full content yet.
    """
    articles = []

    for source, url in RSS_SOURCES.items():
        print(f"Fetching RSS feed from {source}...")
        feed = feedparser.parse(url)

        for entry in feed.entries[:MAX_PER_SOURCE]:

            published_raw = entry.get("published", "").strip()
            published_date = format_date(published_raw)

            articles.append({
                "source": source,
                "source_type": "news",
                "title": entry.get("title", "").strip(),
                "url": entry.get("link", "").strip(),
                "published_date": published_date,
                "category": "general",
            })

    return articles


def extract_article(entry: dict) -> dict | None:
    """
    Visit an article page and extract the main text content.
    Returns the updated article dictionary, or None if extraction fails.
    """
    url = entry["url"]
    response = requests.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "lxml")

    title_tag = soup.find("h1")
    title = title_tag.get_text(strip=True) if title_tag else entry["title"]

    paragraphs = []
    main = soup.find("main") or soup

    for p in main.select("p"):
        text = p.get_text(" ", strip=True)
        if len(text) > 40:
            paragraphs.append(text)

    content = " ".join(paragraphs).strip()

    if not content:
        return None

    return {
        "source": entry["source"],
        "source_type": entry["source_type"],
        "title": title,
        "url": entry["url"],
        "published_date": entry["published_date"],
        "category": entry["category"],
        "content": content,
    }


def main():
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    print("Fetching RSS entries...")
    rss_entries = fetch_rss_entries()
    print(f"Found {len(rss_entries)} RSS entries")

    extracted_articles = []

    for i, entry in enumerate(rss_entries, start=1):
        print(f"[{i}/{len(rss_entries)}] Extracting: {entry['title'][:80]}")
        try:
            article = extract_article(entry)
            if article:
                extracted_articles.append(article)
            else:
                print("  Skipped: no content extracted")
        except Exception as e:
            print(f"  Skipped due to error: {e}")

    with OUTPUT_FILE.open("w", encoding="utf-8") as f:
        json.dump(extracted_articles, f, ensure_ascii=False, indent=2)

    print(f"\nSaved {len(extracted_articles)} articles to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()