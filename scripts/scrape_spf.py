"""
SPF scam news scraper
Scrapes recent scam-related news releases from:
https://www.police.gov.sg/Media-Hub/News?type=All&from=From&to=To&keyword=scam

Output:
- title
- url
- published_date
- section/category
- content

Good for building a scam-focused RAG dataset.
"""

import json
import logging
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASE = "https://www.police.gov.sg"
SEARCH_URL = "https://www.police.gov.sg/Media-Hub/News?type=All&from=From&to=To&keyword=scam"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

OUTPUT_FILE = Path("data/spf_scams_recent.json")
TIMEOUT = 30
SLEEP = 1.0
MAX_ARTICLES = 100

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

DATE_RE = re.compile(r"\b\d{2}\s+[A-Z][a-z]{2}\s+\d{4}\b")  # e.g. 05 Feb 2026


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def format_date_ddmmyy(raw_date: str) -> str:
    raw_date = clean(raw_date)
    if not raw_date:
        return ""

    for fmt in (
        "%d %b %Y",
        "%d %B %Y",
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
    ):
        try:
            dt = datetime.strptime(raw_date, fmt)
            return dt.strftime("%d-%m-%y")
        except ValueError:
            continue

    return raw_date


def get_html(url: str, session: requests.Session) -> str:
    resp = session.get(url, timeout=TIMEOUT)
    resp.raise_for_status()

    if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
        resp.encoding = resp.apparent_encoding or "utf-8"

    return resp.text


def is_news_article_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return path.startswith("/media-hub/news/") and path.count("/") >= 5


def collect_article_links(html: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    links = []
    seen = set()

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        full_url = urljoin(BASE, href)

        if is_news_article_url(full_url) and full_url not in seen:
            seen.add(full_url)
            links.append(full_url)

    return links


def find_title(soup: BeautifulSoup) -> str:
    h1 = soup.find("h1")
    if h1:
        return clean(h1.get_text(" ", strip=True))
    return ""


def find_section(soup: BeautifulSoup) -> str:
    # On SPF article pages, "Police News Releases" appears near the title/date block
    candidates = ["Police News Releases", "Police Life", "Publications", "Statistics"]
    text = soup.get_text("\n", strip=True)

    for c in candidates:
        if c in text:
            return c
    return ""


def find_date(soup: BeautifulSoup) -> str:
    text = soup.get_text("\n", strip=True)
    m = DATE_RE.search(text)
    return m.group(0) if m else ""


def parse_article(html: str, url: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")

    title = find_title(soup)
    if not title:
        log.info("Skip (no title): %s", url)
        return None

    section = find_section(soup)
    published_date = format_date_ddmmyy(find_date(soup))

    # Use full text first, then trim obvious boilerplate
    raw_text = soup.get_text("\n", strip=True)
    lines = []
    seen = set()

    boilerplate_starts = (
        "Home",
        "Who We Are",
        "E-Services",
        "Media Hub",
        "Advisories",
        "Knowledge Hub",
        "Join Us",
        "Community Engagement",
        "Contact Us",
        "Feedback",
        "FAQs",
        "Privacy Statement",
        "Terms of Use",
        "Sitemap",
        "Singapore Police Force",
        "PUBLIC AFFAIRS DEPARTMENT",
        "© 2026, Government of Singapore",
        "Last updated on",
    )

    for line in raw_text.splitlines():
        line = clean(line)

        if (
            len(line) < 25
            or line in seen
            or line == title
            or line == section
            or line == published_date
            or line.startswith(boilerplate_starts)
            or line.startswith("Image:")
            or line.startswith("Read latest news and updates")
            or line.startswith("Access official Police News Releases")
        ):
            continue

        seen.add(line)
        lines.append(line)

    content = "\n\n".join(lines)

    # Optional guard: keep only pages that are actually scam-related
    scam_keywords = [
        "scam", "scams", "fraud", "victim", "victims",
        "anti-scam", "scamshield", "money mule", "phishing",
        "impersonation", "job scam", "e-commerce scam"
    ]
    lowered = f"{title}\n{content}".lower()
    if not any(k in lowered for k in scam_keywords):
        log.info("Skip (not scam-related enough): %s", title)
        return None

    if not content.strip():
        log.info("Skip (empty content): %s", url)
        return None

    return {
        "source": "SPF",
        "source_type": "government",
        "title": title,
        "url": url,
        "published_date": published_date,
        "category": "crime",
        "content": content,
    }


def scrape_spf_scams(max_articles: int = MAX_ARTICLES) -> list[dict]:
    results = []
    seen_urls = set()

    with requests.Session() as s:
        s.headers.update(HEADERS)

        log.info("Fetching SPF scam search page...")
        html = get_html(SEARCH_URL, s)

        links = collect_article_links(html)
        log.info("Found %d candidate article links", len(links))

        for url in links:
            if url in seen_urls:
                continue
            seen_urls.add(url)

            try:
                article_html = get_html(url, s)
                article = parse_article(article_html, url)

                if article:
                    results.append(article)
                    log.info("✓ %s", article["title"])

                if len(results) >= max_articles:
                    break

                time.sleep(SLEEP)

            except Exception as e:
                log.error("X %s -> %s", url, e)

    return results


def main() -> None:
    results = scrape_spf_scams()

    if not results:
        log.error("No scam-related SPF articles collected.")
        return

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("Saved %d articles -> %s", len(results), OUTPUT_FILE)


if __name__ == "__main__":
    main()
