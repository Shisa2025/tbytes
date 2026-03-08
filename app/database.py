# Connects to ClickHouse to search for context
import clickhouse_connect
from sentence_transformers import SentenceTransformer

from .config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD


TABLE_NAME = "trusted_info"
MAX_COSINE_DISTANCE = 0.45

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

def search_trusted_context(
    user_query: str,
    limit: int = 3,
    max_distance: float = MAX_COSINE_DISTANCE,
):
    """
    Performs a Vector Search in ClickHouse using Cosine Distance.
    """
    try:
        query_vector = model.encode(user_query).tolist()

        result = client.query(f"""
            SELECT content, source, cosineDistance(embedding, {query_vector}) AS score
            FROM trusted_info
            ORDER BY score ASC
            LIMIT {limit}
        """)

        # Keep only semantically relevant chunks; low-quality top-k matches should
        # be treated as "no trusted context" so the OpenAI fallback can run.
        relevant_rows = [row for row in result.result_rows if float(row[2]) <= max_distance]
        context_chunks = [row[0] for row in relevant_rows]
        return "\n\n".join(context_chunks)
        
    except Exception as e:
        # If the venue Wi-Fi blocks the port, catch it safely so the bot doesn't crash!
        print(f"ClickHouse Connection Blocked or Failed: {e}")
        return "" # Returns empty so your RAG pipeline gracefully uses OpenAI fallback
