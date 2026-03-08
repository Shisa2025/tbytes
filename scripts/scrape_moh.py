"""
MOH Newsroom Scraper
Scrapes MOH newsroom entries from MOH, including both newer and older articles.

Usage:
    python scripts/scrape_moh.py
    python scripts/scrape_moh.py --max-articles 200 --max-pages 80
"""

import argparse
import json
import logging
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://www.moh.gov.sg"
LIST_URL_TMPL = "https://www.moh.gov.sg/newsroom/?page={page}"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

OUTPUT_FILE = Path("data/moh_newsroom.json")
MAX_ARTICLES = 200
MAX_PAGES = 80
TIMEOUT = 30
SLEEP = 1.0
MIN_CONTENT_LENGTH = 200

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

DATE_RE = re.compile(
    r"\b(?:" + "|".join(MONTHS) + r")\s+\d{1,2},?\s+\d{4}\b"
    r"|\b\d{1,2}\s+(?:" + "|".join(MONTHS) + r")\s+\d{4}\b",
    re.IGNORECASE,
)


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def get_html(url: str, session: requests.Session) -> str:
    resp = session.get(url, timeout=TIMEOUT)
    resp.raise_for_status()

    if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
        resp.encoding = resp.apparent_encoding or "utf-8"

    return resp.text


def find_date(soup: BeautifulSoup) -> str:
    for el in soup.find_all("time"):
        candidate = el.get("datetime", "") or el.get_text(" ", strip=True)
        m = DATE_RE.search(candidate)
        if m:
            return m.group()

    for tag in ["p", "span", "div", "li"]:
        for el in soup.find_all(tag):
            txt = clean(el.get_text(" ", strip=True))
            if len(txt) <= 120:
                m = DATE_RE.search(txt)
                if m:
                    return m.group()

    return ""


def detect_category(soup: BeautifulSoup) -> str:
    known = {
        "Press Releases",
        "Parliamentary QA",
        "Speeches",
        "News Highlights",
        "Circulars",
        "Consultations",
        "Advisories",
    }

    for el in soup.find_all(["p", "span", "div", "li"]):
        txt = clean(el.get_text(" ", strip=True))
        if txt in known:
            return txt

    return ""


def collect_links(html: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    links = []
    seen = set()

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()

        if not href.startswith("/newsroom/"):
            continue
        if href in {"/newsroom/", "/newsroom"}:
            continue
        if "#" in href:
            continue

        # Remove query string but keep article path
        href = href.split("?", 1)[0].rstrip("/")

        # Skip generic landing pages
        if href.lower() in {"/newsroom", "/newsroom/"}:
            continue

        url = urljoin(BASE, href)

        if url not in seen:
            seen.add(url)
            links.append(url)

    return links


def remove_noise(root: BeautifulSoup) -> None:
    selectors = (
        "nav, footer, script, style, noscript, header, "
        ".breadcrumb, .share, .social, .feedback, .contact, .masthead, "
        ".related, .related-links, .recommended, .sidebar, .search, "
        ".cookie, .alert, .subscription, .newsletter"
    )

    for noise in root.select(selectors):
        noise.decompose()


def parse_article(html: str, url: str, min_content_length: int = MIN_CONTENT_LENGTH) -> dict | None:
    soup = BeautifulSoup(html, "lxml")

    h1 = soup.find("h1")
    title = clean(h1.get_text(" ", strip=True)) if h1 else ""
    if not title:
        log.info("  Skip (no title): %s", url)
        return None

    category = detect_category(soup)
    published_date = find_date(soup)

    root = (
        soup.find("main")
        or soup.find("article")
        or soup.find(attrs={"class": re.compile(r"(content|body|article|prose|markdown)", re.I)})
        or soup.body
        or soup
    )

    remove_noise(root)

    blocks = []
    seen_text = set()

    for el in root.find_all(["h2", "h3", "h4", "p", "li"]):
        txt = clean(el.get_text(" ", strip=True))

        if len(txt) < 20:
            continue
        if txt in seen_text:
            continue
        if txt in {title, category, published_date}:
            continue
        if txt.startswith("Skip to main content"):
            continue
        if txt.startswith("Back to top"):
            continue

        seen_text.add(txt)

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
            if line in {title, category, published_date}:
                continue
            if line.startswith("Skip to main content"):
                continue
            if line.startswith("Back to top"):
                continue
            if line.startswith("©"):
                continue
            if "ScamShield" in line:
                continue
            if line in {
                "Home", "Newsroom", "Resources", "About us",
                "Contact", "Feedback", "Ministry of Health"
            }:
                continue

            seen_lines.add(line)
            lines.append(line)

        content = "\n\n".join(lines).strip()

    if len(content) < min_content_length:
        log.info("  Skip (content too short): %s", url)
        return None

    return {
        "source": "MOH",
        "source_type": "government",
        "title": title,
        "url": url,
        "published_date": published_date,
        "category": category,
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


def scrape_with_requests(
    max_articles: int,
    max_pages: int,
    min_content_length: int,
) -> list[dict]:
    results = []
    seen_urls = set()
    consecutive_empty_pages = 0

    with requests.Session() as s:
        s.headers.update(HEADERS)

        for page_num in range(1, max_pages + 1):
            list_url = LIST_URL_TMPL.format(page=page_num)
            log.info("Fetching listing page %d...", page_num)

            try:
                html = get_html(list_url, s)
            except requests.RequestException as e:
                log.error("Listing page %d failed: %s", page_num, e)
                continue

            links = collect_links(html)
            log.info("Found %d candidate links on page %d", len(links), page_num)

            new_links = [url for url in links if url not in seen_urls]
            if not new_links:
                consecutive_empty_pages += 1
                if consecutive_empty_pages >= 3:
                    log.info("Stopping after %d consecutive pages with no new links.", consecutive_empty_pages)
                    break
                continue

            consecutive_empty_pages = 0

            for url in new_links:
                seen_urls.add(url)

                try:
                    article_html = get_html(url, s)
                    article = parse_article(article_html, url, min_content_length=min_content_length)

                    if article:
                        results.append(article)
                        log.info("  ✓ %s", article["title"][:100])

                    if len(results) >= max_articles:
                        return dedupe_articles(results)

                    time.sleep(SLEEP)

                except Exception as e:
                    log.error("  X Failed article %s: %s", url, e)

    return dedupe_articles(results)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape MOH newsroom articles.")
    parser.add_argument(
        "--max-articles",
        type=int,
        default=MAX_ARTICLES,
        help=f"Maximum number of articles to collect (default: {MAX_ARTICLES})",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=MAX_PAGES,
        help=f"Maximum number of listing pages to scan (default: {MAX_PAGES})",
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

    results = scrape_with_requests(
        max_articles=max(1, args.max_articles),
        max_pages=max(1, args.max_pages),
        min_content_length=max(1, args.min_content_length),
    )

    if not results:
        log.error("No articles collected.")
        return

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("Saved %d articles -> %s", len(results), args.output)


if __name__ == "__main__":
    main()