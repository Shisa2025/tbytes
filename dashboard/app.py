# Streamlit application for dashboard

import pandas as pd
import streamlit as st
from pathlib import Path

CSV_PATH = Path(__file__).parent.parent / "data" / "query_logs.csv"

st.set_page_config(page_title="TBytes Fact-Check Dashboard", layout="wide")
st.title("TBytes Fact-Check Dashboard")

# --- Load data ---
@st.cache_data(ttl=10)
def load_data() -> pd.DataFrame:
    if not CSV_PATH.exists():
        return pd.DataFrame()
    df = pd.read_csv(CSV_PATH, parse_dates=["timestamp"])
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

# --- Charts ---
left, right = st.columns(2)

with left:
    st.subheader("Verdict Distribution")
    if "verdict" in df.columns:
        verdict_counts = df["verdict"].value_counts().reset_index()
        verdict_counts.columns = ["Verdict", "Count"]
        st.bar_chart(verdict_counts.set_index("Verdict"))

with right:
    st.subheader("Queries by Media Type")
    if "media_type" in df.columns:
        media_counts = df["media_type"].value_counts().reset_index()
        media_counts.columns = ["Media Type", "Count"]
        st.bar_chart(media_counts.set_index("Media Type"))

# --- Queries over time ---
st.subheader("Queries Over Time")
if "timestamp" in df.columns:
    df["date"] = df["timestamp"].dt.date
    daily = df.groupby("date").size().reset_index(name="Count")
    st.bar_chart(daily.set_index("date"))

# --- Raw log table ---
with st.expander("Raw Query Logs"):
    st.dataframe(df.sort_values("timestamp", ascending=False), use_container_width=True)
