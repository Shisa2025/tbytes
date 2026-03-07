# Streamlit application for dashboard

import altair as alt
import pandas as pd
import streamlit as st
from pathlib import Path
from langdetect import detect, LangDetectException
import pycountry

CSV_PATH = Path(__file__).parent.parent / "data" / "query_logs.csv"

st.set_page_config(page_title="TBytes Fact-Check Dashboard", layout="wide")
st.title("TBytes Fact-Check Dashboard")

def detect_language(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        return "Unknown"
    try:
        code = detect(text)
        lang = pycountry.languages.get(alpha_2=code)
        return lang.name if lang else code
    except LangDetectException:
        return "Unknown"

# --- Load data ---
@st.cache_data(ttl=10)
def load_data() -> pd.DataFrame:
    if not CSV_PATH.exists():
        return pd.DataFrame()
    df = pd.read_csv(CSV_PATH, parse_dates=["timestamp"])
    if "language" not in df.columns:
        query_col = "query" if "query" in df.columns else df.columns[2]
        df["language"] = df[query_col].apply(detect_language)
    return df

df = load_data()

if df.empty:
    st.warning("No data yet. query_logs.csv is empty or missing.")
    st.stop()

# --- Sidebar filters ---
st.sidebar.header("Filters")
media_types = ["All"] + sorted(df["media_type"].dropna().unique().tolist())
selected_media = st.sidebar.selectbox("Media Type", media_types)

if selected_media != "All":
    df = df[df["media_type"] == selected_media]

# --- KPI row ---
col1, col2, col3, col4 = st.columns(4)
col1.metric("Total Queries", len(df))
if "verdict" in df.columns:
    verdicts = df["verdict"].value_counts()
    col2.metric("True", verdicts.get("true", 0))
    col3.metric("False", verdicts.get("false", 0))
    col4.metric("Misleading", verdicts.get("misleading", 0))

st.divider()

# --- Charts (full width) ---
def hbar(data, x_col, y_col, row_height=40, label_limit=200):
    n = len(data)
    height = max(n * row_height, 80)
    return (
        alt.Chart(data)
        .mark_bar(size=row_height * 0.6)
        .encode(
            x=alt.X(f"{x_col}:Q", title=x_col),
            y=alt.Y(f"{y_col}:N", sort="-x", title=None,
                    axis=alt.Axis(labelLimit=label_limit, labelFontSize=13)),
            color=alt.Color(f"{y_col}:N", legend=None),
            tooltip=[y_col, x_col],
        )
        .properties(height=height)
    )

st.subheader("Verdict Distribution")
if "verdict" in df.columns:
    verdict_counts = df["verdict"].value_counts().reset_index()
    verdict_counts.columns = ["Verdict", "Count"]
    st.altair_chart(hbar(verdict_counts, "Count", "Verdict"), use_container_width=True)
else:
    st.info("No verdict data.")

st.subheader("Language Distribution")
lang_counts = df["language"].value_counts().reset_index()
lang_counts.columns = ["Language", "Count"]
st.altair_chart(hbar(lang_counts, "Count", "Language", row_height=45, label_limit=300), use_container_width=True)

st.subheader("Media Type Distribution")
if "media_type" in df.columns:
    media_counts = df["media_type"].value_counts().reset_index()
    media_counts.columns = ["Media Type", "Count"]
    st.altair_chart(hbar(media_counts, "Count", "Media Type"), use_container_width=True)
else:
    st.info("No media_type data.")

st.subheader("Daily Query Volume")
if "timestamp" in df.columns:
    df["date"] = pd.to_datetime(df["timestamp"], errors="coerce").dt.date.astype(str)
    daily = df.groupby("date").size().reset_index(name="Count")
    st.altair_chart(hbar(daily, "Count", "date"), use_container_width=True)
else:
    st.info("No timestamp data.")

# --- Raw log table ---
with st.expander("Raw Query Logs"):
    st.dataframe(df.sort_values("timestamp", ascending=False), use_container_width=True)
