# Connects to ClickHouse to search for context
import clickhouse_connect
from sentence_transformers import SentenceTransformer

from .config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD


TABLE_NAME = "trusted_info"

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

def search_trusted_context(user_query: str, limit: int = 3):
    """
    Performs a Vector Search in ClickHouse using Cosine Distance.
    """
    try:
        client = clickhouse_connect.get_client(
            host=CH_HOST, port=CH_PORT, username=CH_USER, password=CH_PASSWORD, secure=True
        )
        
        query_vector = model.encode(user_query).tolist()

        result = client.query(f"""
            SELECT content, source, cosineDistance(embedding, {query_vector}) AS score
            FROM trusted_info
            ORDER BY score ASC
            LIMIT {limit}
        """)

        context_chunks = [row[0] for row in result.result_rows]
        return "\n\n".join(context_chunks)
        
    except Exception as e:
        # If the venue Wi-Fi blocks the port, catch it safely so the bot doesn't crash!
        print(f"ClickHouse Connection Blocked or Failed: {e}")
        return "" # Returns empty so your RAG pipeline gracefully uses OpenAI fallback