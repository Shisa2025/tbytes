# was using this to merge the initial scraped moh and sfa data to get raw_sources.json under data
import json
from pathlib import Path

DATA_DIR = Path("data")
OUTPUT_FILE = DATA_DIR / "raw_sources.json"

FILES = [
    DATA_DIR / "moh_newsroom_2026.json",
    DATA_DIR / "sfa_newsroom_2026.json"
]

def merge_sources():
    combined = []

    for file in FILES:
        if not file.exists():
            print(f"Skipping missing file: {file}")
            continue

        with open(file, "r", encoding="utf-8") as f:
            data = json.load(f)
            combined.extend(data)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(combined, f, indent=2, ensure_ascii=False)

    print(f"Merged {len(combined)} articles into {OUTPUT_FILE}")


if __name__ == "__main__":
    merge_sources()