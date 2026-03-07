"""
MOH Newsroom Scraper
Scrapes latest 20 entries from MOH newsroom articles
"""

import json
import logging
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://www.moh.gov.sg"
LIST_URL = (
    "https://www.moh.gov.sg/newsroom/"
    "?filters=%5B%7B%22id%22%3A%22year%22%2C%22items%22%3A%5B%7B%22id%22%3A%222026%22%7D%5D%7D%5D&page=1"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

OUTPUT_FILE = Path("data/moh_newsroom_2026.json")
MAX_ARTICLES = 50
TIMEOUT = 30
SLEEP = 1.0

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

    # Fix mojibake / weird encoding like Â and â€™
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
            if len(txt) <= 80:
                m = DATE_RE.search(txt)
                if m:
                    return m.group()
    return ""


def detect_category(soup: BeautifulSoup) -> str:
    known = {"Press Releases", "Parliamentary QA", "Speeches", "News Highlights"}
    for el in soup.find_all(["p", "span", "div"]):
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

        if (
            href.startswith("/newsroom/")
            and href not in {"/newsroom/", "/newsroom"}
            and "?" not in href
            and "#" not in href
        ):
            url = urljoin(BASE, href)
            if url not in seen:
                seen.add(url)
                links.append(url)

    return links


def parse_article(html: str, url: str) -> dict | None:
    soup = BeautifulSoup(html, "lxml")

    # Title
    h1 = soup.find("h1")
    title = clean(h1.get_text(" ", strip=True)) if h1 else ""
    if not title:
        log.info("  Skip (no title): %s", url)
        return None

    # Category (keep it, but do not filter by it)
    category = detect_category(soup)

    # Date
    published_date = find_date(soup)
    if published_date:
        log.info("  Found date: %s", published_date)

    # Only skip if a date was found and it is clearly not 2026
    if published_date and "2026" not in published_date:
        log.info("  Skip (not 2026): %s", url)
        return None

    # Find best content root
    root = (
        soup.find("main")
        or soup.find("article")
        or soup.find(attrs={"class": re.compile(r"(content|body|article|prose|markdown)", re.I)})
        or soup.body
        or soup
    )

    # Remove noise
    for noise in root.select(
        "nav, footer, script, style, noscript, header, "
        ".breadcrumb, .share, .social, .feedback, .contact, .masthead"
    ):
        noise.decompose()

    # Structured extraction
    blocks = []
    seen = set()

    for el in root.find_all(["h2", "h3", "h4", "p", "li"]):
        txt = clean(el.get_text(" ", strip=True))

        if len(txt) < 20:
            continue
        if txt in seen:
            continue
        if txt == title or txt == category or txt == published_date:
            continue

        seen.add(txt)

        if el.name in {"h2", "h3", "h4"}:
            blocks.append(f"### {txt}")
        else:
            blocks.append(txt)

    content = "\n\n".join(blocks)

    # Fallback extraction
    if not content.strip():
        raw_text = root.get_text("\n", strip=True)
        lines = []
        seen = set()

        for line in raw_text.splitlines():
            line = clean(line)

            if (
                len(line) < 20
                or line in seen
                or line.startswith("Skip to main content")
                or line.startswith("Back to top")
                or line.startswith("©")
                or line == title
                or line == category
                or line == published_date
                or "Government officials will never ask you" in line
                or "ScamShield" in line
                or line in {
                    "Home", "Newsroom", "Resources", "About us",
                    "Contact", "Feedback", "Ministry of Health"
                }
            ):
                continue

            seen.add(line)
            lines.append(line)

        content = "\n\n".join(lines)

    if not content.strip():
        log.info("  Skip (empty content): %s", url)
        return None

    return {
        "source": "MOH",
        "title": title,
        "url": url,
        "published_date": published_date,
        "category": category,
        "content": content,
    }

def scrape_with_requests(max_articles: int) -> list[dict]:
    results = []
    seen_urls = set()

    with requests.Session() as s:
        s.headers.update(HEADERS)

        for page_num in range(1, 10):  # try pages 1 to 9
            list_url = (
                "https://www.moh.gov.sg/newsroom/"
                "?filters=%5B%7B%22id%22%3A%22year%22%2C%22items%22%3A%5B%7B%22id%22%3A%222026%22%7D%5D%7D%5D"
                f"&page={page_num}"
            )

            log.info("Fetching listing page %d...", page_num)

            try:
                html = get_html(list_url, s)
            except requests.RequestException as e:
                log.error("Listing page %d failed: %s", page_num, e)
                continue

            links = collect_links(html)
            log.info("Found %d links on page %d", len(links), page_num)

            if not links:
                break

            for url in links:
                if url in seen_urls:
                    continue
                seen_urls.add(url)

                try:
                    article_html = get_html(url, s)
                    article = parse_article(article_html, url)

                    if article:
                        results.append(article)
                        log.info("  ✓ %s", article["title"][:80])

                    if len(results) >= max_articles:
                        return results

                    time.sleep(SLEEP)

                except Exception as e:
                    log.error("  X %s", e)

    return results

def main() -> None:
    results = scrape_with_requests(MAX_ARTICLES)

    if not results:
        log.error("No articles collected.")
        return

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    log.info("Saved %d articles -> %s", len(results), OUTPUT_FILE)


if __name__ == "__main__":
    main()