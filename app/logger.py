import clickhouse_connect
from .config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD, CH_DATABASE

def log_query(language: str, query: str, verdict: str):
    """
    Coder 1's handshake with Coder 4: Logs every interaction to the cloud.
    """
    try:
        client = clickhouse_connect.get_client(
            host=CH_HOST, 
            port=CH_PORT, 
            username=CH_USER, 
            password=CH_PASSWORD, 
            database=CH_DATABASE,
            secure=True  # Required for ClickHouse Cloud
        )
        
        # Create table if it doesn't exist
        client.command("""
            CREATE TABLE IF NOT EXISTS query_logs (
                timestamp DateTime DEFAULT now(),
                language String,
                query String,
                verdict String
            ) ENGINE = MergeTree() ORDER BY timestamp
        """)

        # Insert data row
        client.insert('query_logs', [[language, query, verdict]], 
                      column_names=['language', 'query', 'verdict'])
    except Exception as e:
        print(f"Failed to log to ClickHouse: {e}")