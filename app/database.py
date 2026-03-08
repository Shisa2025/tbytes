# Connects to ClickHouse to search for context
import re
import clickhouse_connect
from sentence_transformers import SentenceTransformer

from .config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD


class EvidenceQueryError(RuntimeError):
    """Raised when trusted evidence retrieval cannot be completed."""


TABLE_NAME = "trusted_info"
MAX_COSINE_DISTANCE = 0.55
MIN_KEYWORD_OVERLAP = 0.15
ANCHOR_STOPWORDS = {
    "singapore", "news", "claim", "claims", "true", "false", "verify",
    "verified", "unverified", "misleading", "rumour", "rumor", "article",
    "official", "update", "updates", "about", "what", "where", "when",
    "have", "does", "is", "are", "many",
}

model = SentenceTransformer(
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)

client = clickhouse_connect.get_client(
    host=CH_HOST,
    port=CH_PORT,
    username=CH_USER,
    password=CH_PASSWORD,
    secure=True,
)

def _tokenize(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-zA-Z0-9]+", (text or "").lower()) if len(w) >= 3}


def _keyword_overlap_ratio(query: str, candidate: str) -> float:
    query_terms = _tokenize(query)
    if not query_terms:
        return 0.0
    candidate_terms = _tokenize(candidate)
    if not candidate_terms:
        return 0.0
    overlap = len(query_terms.intersection(candidate_terms))
    return overlap / len(query_terms)


def _extract_anchor_terms(query: str) -> set[str]:
    """
    Query anchors are high-signal tokens (brand/place/entity-like terms) that
    should be present in relevant evidence to avoid semantic drift.
    """
    tokens = _tokenize(query)
    return {t for t in tokens if len(t) >= 5 and t not in ANCHOR_STOPWORDS}


def search_trusted_evidence(
    user_query: str,
    limit: int = 5,
    max_distance: float = MAX_COSINE_DISTANCE,
    min_keyword_overlap: float = MIN_KEYWORD_OVERLAP,
):
    """
    Hybrid retrieval:
    1. Vector search to fetch candidate chunks.
    2. Keyword overlap scoring for lexical relevance.
    3. Keep chunks that pass semantic or lexical thresholds.
    """
    try:
        query_vector = model.encode(user_query).tolist()

        result = client.query(f"""
            SELECT
                content,
                source,
                title,
                url,
                published_date,
                category,
                cosineDistance(embedding, {query_vector}) AS score
            FROM trusted_info
            ORDER BY score ASC
            LIMIT 60
        """)

        anchor_terms = _extract_anchor_terms(user_query)
        ranked = []
        for row in result.result_rows:
            content, source, title, url, published_date, category, distance = row
            candidate_text = f"{title} {content}".lower()
            lexical_score = _keyword_overlap_ratio(user_query, candidate_text)
            distance = float(distance)
            semantic_match = distance <= max_distance
            lexical_match = lexical_score >= min_keyword_overlap

            if not (semantic_match or lexical_match):
                continue
            # Anchor terms are only enforced for weak/lexical-only matches.
            # Strong semantic matches should not be dropped due wording mismatch.
            if anchor_terms and not any(term in candidate_text for term in anchor_terms) and not semantic_match:
                continue

            ranked.append({
                "content": content,
                "source": source,
                "title": title,
                "url": url,
                "published_date": published_date,
                "category": category,
                "distance": distance,
                "lexical_score": lexical_score,
            })

        # Prefer strong semantic matches first, then lexical matches as tie-breaker.
        ranked.sort(key=lambda r: (r["distance"], -r["lexical_score"]))
        return ranked[:limit]

    except Exception as e:
        # Bubble up retrieval failures so caller can report a real query error.
        message = f"ClickHouse Connection Blocked or Failed: {e}"
        print(message)
        raise EvidenceQueryError(message) from e


def search_trusted_context(
    user_query: str,
    limit: int = 5,
    max_distance: float = MAX_COSINE_DISTANCE,
):
    """
    Compatibility wrapper returning only concatenated content.
    """
    evidence = search_trusted_evidence(
        user_query=user_query,
        limit=limit,
        max_distance=max_distance,
    )
    return "\n\n".join(item["content"] for item in evidence)
