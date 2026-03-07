"""
scrape_sources.py

Runs the full scraping pipeline to collect articles from trusted sources.

Steps:
1. Calls extractors.fetch_rss_entries() to collect RSS articles.
2. Calls extractors.poll_moh() to collect MOH newsroom links.
3. Uses extractors.extract_article() to download and extract full article text.
4. Filters out empty or failed extractions.
5. Saves cleaned article data to data/raw_sources.json.

This script should be run before building the vector database.

Output:
data/sources.json
"""

import json
from pathlib import Path

from extractors import fetch_rss_entries, poll_moh, extract_article

RAW_FILE = Path("data/sources.json")


def main():
    RAW_FILE.parent.mkdir(parents=True, exist_ok=True)

    print("Fetching RSS entries...")
    rss_entries = fetch_rss_entries()
    print(f"Found {len(rss_entries)} RSS entries")

    print("Polling MOH newsroom...")
    moh_entries = poll_moh()
    print(f"Found {len(moh_entries)} MOH entries")

    all_entries = rss_entries + moh_entries
    print(f"Total entries collected: {len(all_entries)}")

    extracted_articles = []

    for i, entry in enumerate(all_entries, start=1):
        print(f"[{i}/{len(all_entries)}] Extracting: {entry['title'][:80]}")
        try:
            article = extract_article(entry)
            if article:
                extracted_articles.append(article)
        except Exception as e:
            print(f"  Skipped due to error: {e}")

    with RAW_FILE.open("w", encoding="utf-8") as f:
        json.dump(extracted_articles, f, ensure_ascii=False, indent=2)

    print(f"\nSaved {len(extracted_articles)} articles to {RAW_FILE}")


if __name__ == "__main__":
    main()
