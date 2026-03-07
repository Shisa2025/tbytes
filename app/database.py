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

    query_vector = model.encode(user_query).tolist()

    result = client.query(
        f"""
        SELECT source, title, url, content,
               cosineDistance(embedding, %(query_vector)s) AS score
        FROM {TABLE_NAME}
        ORDER BY score ASC
        LIMIT {limit}
        """,
        parameters={"query_vector": query_vector},
    )

    return result.result_rows



def search_trusted_context(user_query: str, limit: int = 3):
    """
    Performs a Vector Search in ClickHouse using Cosine Distance.
    """
    client = clickhouse_connect.get_client(
        host=CH_HOST, port=CH_PORT, username=CH_USER, password=CH_PASSWORD, secure=True
    )
    
    # Generate embedding for the query
    query_vector = model.encode(user_query).tolist()

    # Search using ClickHouse cosineDistance function
    result = client.query(f"""
        SELECT text, source_url, cosineDistance(embedding, {query_vector}) AS score
        FROM trusted_info
        ORDER BY score ASC
        LIMIT {limit}
    """)

    # Combine the top results into a single context string for the LLM
    context_chunks = [row[0] for row in result.result_rows]
    return "\n\n".join(context_chunks)