"""
extractors.py

Handles collecting and extracting articles from trusted sources.

Responsibilities:
1. Fetch article metadata from RSS feeds (CNA, ST, SFA).
2. Scrape MOH newsroom links (since MOH does not provide RSS).
3. Download each article page and extract the main text content.

This file does NOT save data or interact with the database.
It only returns structured article dictionaries used by the scraper pipeline.

Output format for each article:
{
    "source": str,
    "title": str,
    "url": str,
    "published_date": str,
    "content": str
}
"""

import feedparser
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
REQUEST_TIMEOUT = 10

RSS_SOURCES = {
    "SFA": "https://www.sfa.gov.sg/rss-feeds",
    "CNA": "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416",
    "ST": "https://www.straitstimes.com/news/singapore/rss.xml"
}

MOH_NEWSROOM = "https://www.moh.gov.sg/newsroom"


def fetch_rss_entries():

    articles = []

    for source, url in RSS_SOURCES.items():

        feed = feedparser.parse(url)

        for entry in feed.entries[:20]:

            articles.append({
                "source": source,
                "title": entry.title,
                "url": entry.link,
                "published_date": entry.get("published", ""),
            })

    return articles


def poll_moh():

    r = requests.get(MOH_NEWSROOM, timeout=REQUEST_TIMEOUT)
    soup = BeautifulSoup(r.text, "lxml")

    entries = []

    for a in soup.select("a[href*='/newsroom/']")[:20]:

        href = a.get("href")

        if not href:
            continue

        url = urljoin(MOH_NEWSROOM, href)

        entries.append({
            "source": "MOH",
            "title": a.get_text(strip=True),
            "url": url,
            "published_date": ""
        })

    return entries


def extract_article(entry):

    url = entry["url"]

    r = requests.get(url, timeout=REQUEST_TIMEOUT)
    soup = BeautifulSoup(r.text, "lxml")

    title = soup.find("h1")
    title = title.get_text(strip=True) if title else entry["title"]

    paragraphs = []

    main = soup.find("main") or soup

    for p in main.select("p"):

        text = p.get_text(strip=True)

        if len(text) > 40:
            paragraphs.append(text)

    content = " ".join(paragraphs)

    if not content:
        return None

    entry["title"] = title
    entry["content"] = content

    return entry

if __name__ == "__main__":

    print("Fetching RSS entries...")
    rss = fetch_rss_entries()
    print("RSS articles found:", len(rss))

    print("Polling MOH newsroom...")
    moh = poll_moh()
    print("MOH articles found:", len(moh))

    articles = rss + moh

    print("Extracting first article...")
    article = extract_article(articles[0])

    print("\nExample article:")
    print(article["title"])
    print(article["url"])
    print(article["content"][:500])