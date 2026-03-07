"""
SFA Newsroom Scraper
Scrapes SFA newsroom entries from the official RSS feed, including newer and
older entries exposed by the feed.

Usage:
    python scripts/scrape_sfa.py
    python scripts/scrape_sfa.py --max-articles 100
"""

import argparse
import json
import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

BASE = "https://www.sfa.gov.sg"
RSS_URL = "https://www.sfa.gov.sg/rss/newsroom"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.sfa.gov.sg/news-publications/newsroom/subscribe-to-sfa-rss-feeds",
}

OUTPUT_FILE = Path("data/sfa_newsroom.json")
MAX_ARTICLES = 100
TIMEOUT = 30
SLEEP = 1.0
MIN_CONTENT_LENGTH = 200

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

VALID_CATEGORIES = {
    "Advisories",
    "Forum Replies",
    "Media Releases",
    "Media Replies",
    "Speeches",
    "WTO Notifications",
}


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def format_date_ddmmyy(raw_date: str) -> str:
    raw_date = clean(raw_date)
    if not raw_date:
        return ""

    candidates = [raw_date]

    if "T" in raw_date:
        candidates.append(raw_date.split("T", 1)[0])

    if "," in raw_date:
        parts = raw_date.split(",", 1)
        if len(parts) == 2:
            candidates.append(parts[1].strip())

    for candidate in candidates:
        try:
            dt = parsedate_to_datetime(candidate)
            return dt.strftime("%d-%m-%y")
        except Exception:
            pass

        for fmt in (
            "%d %b %Y",
            "%d %B %Y",
            "%B %d, %Y",
            "%Y-%m-%d",
            "%d-%m-%Y",
            "%d/%m/%Y",
        ):
            try:
                dt = datetime.strptime(candidate, fmt)
                return dt.strftime("%d-%m-%y")
            except ValueError:
                continue

    return raw_date


def get_text(url: str, session: requests.Session, extra_headers: dict | None = None) -> str:
    headers = {}
    if extra_headers:
        headers.update(extra_headers)

    resp = session.get(url, timeout=TIMEOUT, allow_redirects=True, headers=headers)
    resp.raise_for_status()

    if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
        resp.encoding = resp.apparent_encoding or "utf-8"

    text = resp.text.lstrip("\ufeff").strip()

    log.info("Fetched: %s", resp.url)
    log.info("Content-Type: %s", resp.headers.get("Content-Type", ""))

    return text


def get_rss_xml(session: requests.Session) -> str:
    xml_text = get_text(RSS_URL, session)

    if xml_text[:100].lower().startswith("<!doctype html") or xml_text[:100].lower().startswith("<html"):
        raise ValueError(
            "RSS URL returned HTML instead of XML. "
            "The feed may be blocked, redirected, or require a fallback approach."
        )

    return xml_text


def parse_rss_items(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    items = []
    seen_urls = set()

    for item in root.findall(".//item"):
        title = clean(item.findtext("title", default=""))
        link = clean(item.findtext("link", default=""))
        pub_date = clean(item.findtext("pubDate", default=""))
        category = clean(item.findtext("category", default=""))

        if not title or not link:
            continue

        parsed = urlparse(link)
        if "sfa.gov.sg" not in parsed.netloc:
            continue
        if not parsed.path.startswith("/news-publications/newsroom/"):
            continue

        normalized_url = link.rstrip("/")
        if normalized_url in seen_urls:
            continue
        seen_urls.add(normalized_url)

        items.append(
            {
                "title": title,
                "url": normalized_url,
                "published_date": pub_date,
                "category": category,
            }
        )

    return items


def extract_title(soup: BeautifulSoup, fallback: str = "") -> str:
    h1 = soup.find("h1")
    if h1:
        return clean(h1.get_text(" ", strip=True))

    og = soup.find("meta", attrs={"property": "og:title"})
    if og and og.get("content"):
        return clean(og["content"])

    title_tag = soup.find("title")
    if title_tag:
        return clean(title_tag.get_text(" ", strip=True))

    return fallback


def extract_category(soup: BeautifulSoup, fallback: str = "") -> str:
    for el in soup.find_all(["p", "span", "div", "li"]):
        txt = clean(el.get_text(" ", strip=True))
        if txt in VALID_CATEGORIES:
            return txt
    return fallback


def extract_date(soup: BeautifulSoup, fallback: str = "") -> str:
    for el in soup.find_all("time"):
        candidate = el.get("datetime", "") or el.get_text(" ", strip=True)
        candidate = clean(candidate)
        if candidate:
            return candidate

    date_patterns = [
        r"\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b",
        r"\b[A-Za-z]+\s+\d{1,2},\s+\d{4}\b",
    ]

    for el in soup.find_all(["p", "span", "div", "li"]):
        txt = clean(el.get_text(" ", strip=True))
        if len(txt) > 100:
            continue
        for pat in date_patterns:
            m = re.search(pat, txt)
            if m:
                return m.group()

    return fallback


def remove_noise(root: BeautifulSoup) -> None:
    for noise in root.select(
        "nav, footer, script, style, noscript, header, form, svg, "
        ".breadcrumb, .share, .social, .feedback, .contact, "
        ".related, .recommended, .pagination, .newsletter, .cookie, "
        ".sidebar, .search"
    ):
        noise.decompose()


def parse_article(html: str, url: str, rss_meta: dict, min_content_length: int = MIN_CONTENT_LENGTH) -> dict | None:
    soup = BeautifulSoup(html, "lxml")

    title = extract_title(soup, fallback=rss_meta.get("title", ""))
    if not title:
        log.info("  Skip (no title): %s", url)
        return None

    detected_category = extract_category(soup, fallback=rss_meta.get("category", ""))
    published_date = format_date_ddmmyy(
        extract_date(soup, fallback=rss_meta.get("published_date", ""))
    )

    root = (
        soup.find("main")
        or soup.find("article")
        or soup.find(attrs={"class": re.compile(r"(content|body|article|rich|editorial)", re.I)})
        or soup.body
        or soup
    )

    remove_noise(root)

    blocks = []
    seen = set()

    for el in root.find_all(["h2", "h3", "h4", "p", "li"]):
        txt = clean(el.get_text(" ", strip=True))

        if len(txt) < 20:
            continue
        if txt in seen:
            continue
        if txt == title:
            continue
        if detected_category and txt == detected_category:
            continue
        if published_date and txt == published_date:
            continue
        if txt.lower().startswith("last updated"):
            continue
        if "privacy statement" in txt.lower():
            continue
        if "terms of use" in txt.lower():
            continue
        if "subscribe to our rss feeds" in txt.lower():
            continue

        seen.add(txt)

        if el.name in {"h2", "h3", "h4"}:
            blocks.append(f"### {txt}")
        else:
            blocks.append(txt)

    content = "\n\n".join(blocks).strip()

    if len(content) < min_content_length:
        raw_text = root.get_text("\n", strip=True)
        lines = []
        seen_lines = set()

        for line in raw_text.splitlines():
            line = clean(line)

            if len(line) < 20:
                continue
            if line in seen_lines:
                continue
            if line == title:
                continue
            if detected_category and line == detected_category:
                continue
            if published_date and line == published_date:
                continue
            if line.lower().startswith("last updated"):
                continue
            if "privacy statement" in line.lower():
                continue
            if "terms of use" in line.lower():
                continue
            if line in {
                "Home",
                "Newsroom",
                "About Us",
                "Contact Us",
                "Feedback",
            }:
                continue

            seen_lines.add(line)
            lines.append(line)

        content = "\n\n".join(lines).strip()

    if len(content) < min_content_length:
        log.info("  Skip (content too short): %s", url)
        return None

    return {
        "source": "SFA",
        "source_type": "government",
        "title": title,
        "url": url,
        "published_date": published_date,
        "category": "food_safety",
        "content": content,
    }


def dedupe_articles(articles: list[dict]) -> list[dict]:
    unique = []
    seen_urls = set()
    seen_keys = set()

    for article in articles:
        url = article.get("url", "").rstrip("/")
        title = clean(article.get("title", "")).lower()
        date = clean(article.get("published_date", "")).lower()
        key = (title, date)

        if url and url in seen_urls:
            continue
        if key in seen_keys:
            continue

        if url:
            seen_urls.add(url)
        seen_keys.add(key)
        unique.append(article)

    return unique


def scrape_newsroom(max_articles: int, min_content_length: int) -> list[dict]:
    results = []

    with requests.Session() as session:
        session.headers.update(HEADERS)

        log.info("Fetching RSS feed: %s", RSS_URL)
        xml_text = get_rss_xml(session)
        items = parse_rss_items(xml_text)

        log.info("Found %d RSS items", len(items))

        if not items:
            return results

        for i, item in enumerate(items[:max_articles], 1):
            url = item["url"]
            log.info("Fetching article %d/%d: %s", i, min(max_articles, len(items)), url)

            try:
                article_html = get_text(url, session)
                article = parse_article(article_html, url, item, min_content_length=min_content_length)

                if article:
                    results.append(article)
                    log.info("  ✓ %s", article["title"][:100])
                else:
                    log.info("  Skip after parsing: %s", url)

                time.sleep(SLEEP)

            except requests.RequestException as e:
                log.error("  ✗ Request failed: %s", e)
            except Exception as e:
                log.error("  ✗ Parse failed: %s", e)

    return dedupe_articles(results)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape SFA newsroom articles from RSS.")
    parser.add_argument(
        "--max-articles",
        type=int,
        default=MAX_ARTICLES,
        help=f"Maximum number of RSS articles to collect (default: {MAX_ARTICLES})",
    )
    parser.add_argument(
        "--min-content-length",
        type=int,
        default=MIN_CONTENT_LENGTH,
        help=f"Minimum extracted content length required (default: {MIN_CONTENT_LENGTH})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_FILE,
        help=f"Output JSON file (default: {OUTPUT_FILE})",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    results = scrape_newsroom(
        max_articles=max(1, args.max_articles),
        min_content_length=max(1, args.min_content_length),
    )

    if not results:
        log.error("No SFA newsroom articles collected.")
        return

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("Saved %d SFA newsroom entries -> %s", len(results), args.output)


if __name__ == "__main__":
    main()
