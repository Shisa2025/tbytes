import json
import clickhouse_connect
from sentence_transformers import SentenceTransformer
from app.config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD, CH_DATABASE

def build_database():
    # 1. Load your embedding model (Multilingual for Singlish/Malay/etc.)
    model = SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
    
    # 2. Connect to ClickHouse Cloud
    client = clickhouse_connect.get_client(
        host=CH_HOST, port=CH_PORT, username=CH_USER, password=CH_PASSWORD, secure=True
    )

    # 3. Create the table with a Vector column
    client.command(f"""
        CREATE TABLE IF NOT EXISTS {CH_DATABASE}.trusted_info (
            source String,
            url String,
            published_date String,
            category String,
            content String
        ) ENGINE = MergeTree() ORDER BY id
    """)

    # 4. Process and Insert Data
    with open('data/raw_sources.json', 'r') as f:
        raw_data = json.load(f)

    data_to_insert = []
    for i, item in enumerate(raw_data):
        vector = model.encode(item['text']).tolist()
        data_to_insert.append((i, item['text'], item['url'], vector))

    client.insert('trusted_info', data_to_insert, column_names=['id', 'text', 'source_url', 'embedding'])
    print(f"Successfully indexed {len(data_to_insert)} documents to ClickHouse Cloud.")

if __name__ == "__main__":
    build_database()