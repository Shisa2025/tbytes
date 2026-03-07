# Handles API keys and environment variables
import os
from dotenv import load_dotenv

# Load variables from the .env file [cite: 96, 109]
load_dotenv()

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not TELEGRAM_TOKEN or not GROQ_API_KEY:
    raise ValueError("Missing API Keys in .env file! [cite: 84]")