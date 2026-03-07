"""
Merge multiple scraped JSON files into one raw_sources.json file
"""

import json
from pathlib import Path

# Input files
INPUT_FILES = [
    Path("data/moh_newsroom.json"),
    Path("data/rss_sources.json"),
    Path("data/sfa_newsroom.json"),
    Path("data/spf_scams_recent.json"),
]

# Output file
OUTPUT_FILE = Path("data/raw_sources.json")


def load_json(file_path: Path):
    """Load JSON safely and return list"""
    if not file_path.exists():
        print(f"⚠️ Skipping missing file: {file_path}")
        return []

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

        if isinstance(data, list):
            return data
        elif isinstance(data, dict):
            return [data]
        else:
            return []


def merge_sources():
    """Merge all source files"""
    merged = []

    for file in INPUT_FILES:
        items = load_json(file)
        print(f"Loaded {len(items)} items from {file.name}")
        merged.extend(items)

    # Save merged file
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Merged {len(merged)} total articles into {OUTPUT_FILE}")


if __name__ == "__main__":
    merge_sources()