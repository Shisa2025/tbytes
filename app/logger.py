import clickhouse_connect
from .config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD, CH_DATABASE

def log_query(language: str, query: str, verdict: str):
    """
    Inserts query data directly into ClickHouse for the real-time dashboard.
    """
    client = clickhouse_connect.get_client(
        host=CH_HOST, port=CH_PORT, username=CH_USER, password=CH_PASSWORD, database=CH_DATABASE
    )
    
    # Ensure the logging table exists
    client.command("""
        CREATE TABLE IF NOT EXISTS query_logs (
            timestamp DateTime DEFAULT now(),
            language String,
            query String,
            verdict String
        ) ENGINE = MergeTree()
        ORDER BY timestamp
    """)

    # Insert the record
    data = [[language, query, verdict]]
    client.insert('query_logs', data, column_names=['language', 'query', 'verdict'])