import json
import uuid
import clickhouse_connect
from sentence_transformers import SentenceTransformer

# connect to ClickHouse
client = clickhouse_connect.get_client(
    host="localhost",
    port=8123,
    database="default"
)

# embedding model
model = SentenceTransformer("intfloat/multilingual-e5-base")

def chunk_text(text, size=700):
    return [text[i:i+size] for i in range(0, len(text), size)]

# load scraped data
with open("data/raw_sources.json") as f:
    docs = json.load(f)

rows = []

for doc in docs:
    for chunk in chunk_text(doc["content"]):
        emb = model.encode(chunk).tolist()

        rows.append([
            str(uuid.uuid4()),
            doc["source"],
            doc["title"],
            doc["url"],
            chunk,
            emb
        ])

client.insert(
    "trusted_sources",
    rows,
    column_names=["id","source","title","url","content","embedding"]
)

print("Data inserted successfully")