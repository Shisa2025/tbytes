# Connects to ClickHouse to search for context
import re
import clickhouse_connect
from sentence_transformers import SentenceTransformer

from .config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD


TABLE_NAME = "trusted_info"
MAX_COSINE_DISTANCE = 0.45
MIN_KEYWORD_OVERLAP = 0.25

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


def search_trusted_evidence(
    user_query: str,
    limit: int = 3,
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
            LIMIT 30
        """)

        ranked = []
        for row in result.result_rows:
            content, source, title, url, published_date, category, distance = row
            lexical_score = _keyword_overlap_ratio(user_query, f"{title} {content}")
            distance = float(distance)

            if distance > max_distance and lexical_score < min_keyword_overlap:
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
        # If the venue Wi-Fi blocks the port, catch it safely so the bot doesn't crash!
        print(f"ClickHouse Connection Blocked or Failed: {e}")
        return []


def search_trusted_context(
    user_query: str,
    limit: int = 3,
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
