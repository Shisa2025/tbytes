# Handles API keys and environment variables
import os
from dotenv import load_dotenv

# Load variables from the .env file in the root directory
load_dotenv()

# Essential API Keys
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# Configuration Constants
RATE_LIMIT_PER_MIN = 5
MAX_FILE_SIZE_MB = 10

# ClickHouse Connection Details
CH_HOST = os.getenv("CH_HOST")
CH_PORT = int(os.getenv("CH_PORT", 8443))
CH_USER = os.getenv("CH_USER", "default")
CH_PASSWORD = os.getenv("CH_PASSWORD", "")
CH_DATABASE = os.getenv("CH_DATABASE", "default")

if not TELEGRAM_TOKEN or not GROQ_API_KEY:
    print("WARNING: Missing API Keys!")