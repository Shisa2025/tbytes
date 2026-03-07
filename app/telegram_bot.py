# Parses incoming messages and sends replies
import httpx
from .config import TELEGRAM_TOKEN
from .rag_pipeline import verify_claim
from .logger import log_query   # Coder 4's data source

# Telegram API URL
TELE_API_URL = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"

async def handle_telegram_webhook(data: dict):
    """
    Parses incoming messages and sends the AI-generated reply.
    """
    # 1. Extract the message and chat ID 
    if "message" not in data:
        return
    
    chat_id = data["message"]["chat"]["id"]
    user_text = data.message.get("text", "")

    if not user_text:
        # If it's not text (e.g., image), Coder 3's media_processor would go here [cite: 168, 169]
        return

    # 2. Get the verdict from Coder 2's pipeline [cite: 165, 166]
    try:
        verdict = verify_claim(user_text)
    except Exception as e:
        verdict = "Sorry, I'm having trouble connecting to my brain right now."
        print(f"Error in RAG Pipeline: {e}")

    # 3. Send the response back to the user 
    await send_message(chat_id, verdict)

async def send_message(chat_id: int, text: str):
    """
    Sends a POST request to Telegram to deliver the message.
    """
    url = f"{TELE_API_URL}/sendMessage"
    payload = {"chat_id": chat_id, "text": text}
    
    async with httpx.AsyncClient() as client:
        await client.post(url, json=payload)