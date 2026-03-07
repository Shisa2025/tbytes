import json
import uuid
from pathlib import Path

import json
import clickhouse_connect
from sentence_transformers import SentenceTransformer

from app.config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD, CH_DATABASE

# Split up
EMBED_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2" # Multilingual for Singlish/Malay/etc.
TABLE_NAME = "trusted_info"
RAW_FILE = Path("data/raw_sources.json")


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 120) -> list[str]:
    """
    Split the long article content into overlapping chunks
    """
    text = (text or "").strip()
    if not text:
        return []
   
    chunks = []
    start = 0
    n = len(text)

    while start < n:
        end = min(start + chunk_size, n)
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        if end >= n:
            break

        start = end - overlap

    return chunks


def get_client():
    return clickhouse_connect.get_client(
        host=CH_HOST,
        port=CH_PORT,
        username=CH_USER,
        password=CH_PASSWORD,
        database=CH_DATABASE,
        secure=True,
    )


def create_table(client):
    client.command(f"""
        CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
            id String,
            source String,
            source_type String,
            title String,
            url String,
            published_date String,
            category String,
            content String,
            embedding Array(Float32)
        )
        ENGINE = MergeTree()
        ORDER BY id
    """)


def build_database():
    if not RAW_FILE.exists():
        raise FileNotFoundError(f"Missing file: {RAW_FILE}")

    # 1. Load embedding model
    model = SentenceTransformer(EMBED_MODEL)

    # 2. Connect to ClickHouse
    client = get_client()

    # 3. Create table
    create_table(client)

    # Optional during development: wipe and rebuild
    client.command(f"TRUNCATE TABLE {TABLE_NAME}")

    # 4. Load merged raw data
    with open(RAW_FILE, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    rows_to_insert = []

    for item in raw_data:
        source = item.get("source", "")
        title = item.get("title", "")
        url = item.get("url", "")
        published_date = item.get("published_date", "")
        category = item.get("category", "")
        content = (item.get("content") or "").strip()

        if not content:
            continue

        chunks = chunk_text(content)

        for chunk in chunks:
            embedding = model.encode(chunk).tolist()
            embedding = [float(x) for x in embedding]

            rows_to_insert.append(
                (
                    str(uuid.uuid4()),
                    source,
                    title,
                    url,
                    published_date,
                    category,
                    chunk,
                    embedding,
                )
            )

    if not rows_to_insert:
        print("No valid rows found to insert.")
        return

    client.insert(
        TABLE_NAME,
        rows_to_insert,
        column_names=[
            "id",
            "source",
            "title",
            "url",
            "published_date",
            "category",
            "content",
            "embedding",
        ],
    )

    print(f"Successfully indexed {len(rows_to_insert)} chunks into ClickHouse.")


if __name__ == "__main__":
    build_database()