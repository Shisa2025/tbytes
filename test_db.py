import clickhouse_connect
import os
from dotenv import load_dotenv

load_dotenv()

print(f"Connecting to: {os.getenv('CH_HOST')} ...")
try:
    client = clickhouse_connect.get_client(
        host=os.getenv("CH_HOST"),
        port=8443,
        username=os.getenv("CH_USER", "default"),
        password=os.getenv("CH_PASSWORD"),
        secure=True
    )
    print("✅ SUCCESS! The database door is open!")
except Exception as e:
    print(f"❌ STILL BLOCKED: {e}")