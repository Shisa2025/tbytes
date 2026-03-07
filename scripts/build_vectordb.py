# Converts raw data into embeddings and saves to ClickHouse
# This should:

# read raw_sources.json

# chunk content into paragraphs / 500–800 chars

# generate embeddings

# insert into ClickHouse

for doc in docs:
    for chunk in chunk_text(doc["content"]):
        emb = embed(chunk)
        insert_row({
            "id": uuid4(),
            "source": doc["source"],
            "title": doc["title"],
            "url": doc["url"],
            "content": chunk,
            "embedding": emb
        })
