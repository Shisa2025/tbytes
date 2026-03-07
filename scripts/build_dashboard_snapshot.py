"""
Build pandas analytics snapshot for homepage graphs.
Writes: data/dashboard_analysis_snapshot.json
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "data" / "dashboard_analysis_snapshot.json"
CSV_PATH = ROOT / "data" / "query_logs.csv"


def _load_df() -> pd.DataFrame:
    if CSV_PATH.exists():
        return pd.read_csv(CSV_PATH)

    # Optional ClickHouse load path when CSV is unavailable.
    try:
        import clickhouse_connect
    except Exception as exc:
        raise RuntimeError("query_logs.csv missing and clickhouse-connect unavailable") from exc

    host = os.getenv("CH_HOST", "").strip()
    port = int(os.getenv("CH_PORT", "8443"))
    user = os.getenv("CH_USER", "default")
    password = os.getenv("CH_PASSWORD", "")
    database = os.getenv("CH_DATABASE", "default")

    if not host:
        raise RuntimeError("CH_HOST not set and query_logs.csv missing.")

    client = clickhouse_connect.get_client(
        host=host,
        port=port,
        username=user,
        password=password,
        database=database,
        secure=True,
    )

    rows = client.query(
        """
        SELECT toString(timestamp) AS timestamp, query, verdict, ifNull(language, '') AS language, ifNull(media_type, '') AS media_type
        FROM query_logs
        WHERE parseDateTimeBestEffortOrNull(toString(timestamp)) >= now() - INTERVAL 60 DAY
        ORDER BY parseDateTimeBestEffortOrNull(toString(timestamp)) DESC
        LIMIT 5000
        """
    )
    df = pd.DataFrame(rows.result_rows, columns=rows.column_names)
    return df


def _value_counts(df: pd.DataFrame, column: str, top_n: int = 8):
    if column not in df.columns:
        return []
    series = df[column].fillna("").astype(str).str.strip().replace("", "unknown")
    counts = series.value_counts().head(top_n)
    return [{"label": str(idx), "count": int(val)} for idx, val in counts.items()]


def build_snapshot() -> dict:
    df = _load_df().copy()
    if df.empty:
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_queries": 0,
            "risk_rate": 0,
            "daily_counts": [],
            "verdict_counts": [],
            "language_counts": [],
            "media_counts": [],
        }

    if "timestamp" in df.columns:
        ts = pd.to_datetime(df["timestamp"], errors="coerce")
        df["date"] = ts.dt.date.astype(str)
    else:
        df["date"] = "unknown"

    df["verdict"] = df.get("verdict", "unknown").astype(str).str.lower()

    total = int(len(df))
    risk = int(df["verdict"].isin(["false", "misleading"]).sum())
    risk_rate = int(round((risk / total) * 100)) if total else 0

    daily = (
        df.groupby("date")
        .size()
        .reset_index(name="count")
        .sort_values("date")
        .tail(14)
        .to_dict(orient="records")
    )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_queries": total,
        "risk_rate": risk_rate,
        "daily_counts": [{"date": str(row["date"]), "count": int(row["count"])} for row in daily],
        "verdict_counts": _value_counts(df, "verdict", top_n=6),
        "language_counts": _value_counts(df, "language", top_n=6),
        "media_counts": _value_counts(df, "media_type", top_n=6),
    }


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    snapshot = build_snapshot()
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    print(f"Wrote pandas snapshot to {OUT_PATH}")


if __name__ == "__main__":
    main()
