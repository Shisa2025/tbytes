import httpx
import os

from sympy import false
from .config import TELEGRAM_TOKEN
from .rag_pipeline import verify_claim
from .logger import log_query
import logging
from .media_processor import process_media

# This creates the 'logger' variable the rest of your code is looking for
logger = logging.getLogger(__name__)
# Assuming Coder 3 has a function like this ready:
# from .media_processor import process_media 

TELE_API_URL = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
FILE_API_URL = f"https://api.telegram.org/file/bot{TELEGRAM_TOKEN}"

DEBUG_MODE=True

# Ensure a temporary folder exists for downloads
os.makedirs("temp_media", exist_ok=True)

async def _extract_content_from_message(message: dict, chat_id: int) -> str:
    """Helper to extract text or process media from a Telegram message."""
    # 1. TEXT
    if "text" in message:
        return message["text"]

    # 2. PHOTOS
    if "photo" in message:
        photo_obj = message["photo"][-1]
        file_path = await download_telegram_file(photo_obj["file_id"], "image.jpg")
        return process_media(file_path)

    # 3. VOICE / AUDIO
    if "voice" in message or "audio" in message:
        media_key = "voice" if "voice" in message else "audio"
        ext = "ogg" if media_key == "voice" else "mp3"
        file_path = await download_telegram_file(message[media_key]["file_id"], f"audio.{ext}")
        return process_media(file_path)

    # 4. VIDEOS
    file_id = None
    if "video" in message:
        file_id = message["video"]["file_id"]
    elif "video_note" in message:
        file_id = message["video_note"]["file_id"]
    elif "document" in message and "video" in message["document"].get("mime_type", ""):
        file_id = message["document"]["file_id"]

    if file_id:
        if DEBUG_MODE:
            await send_message(chat_id, "📹 Video detected! Breaking it down on the RTX 5050...")
        file_path = await download_telegram_file(file_id, "video.mp4")
        return process_media(file_path)

    return ""

async def handle_telegram_webhook(data: dict):
    if "message" not in data: 
        return
    
    message = data["message"]
    chat_id = message["chat"]["id"]

    try:
        user_text = await _extract_content_from_message(message, chat_id)
    except Exception as e:
        logger.error(f"Media Processing Error: {e}")
        await send_message(chat_id, "⚠️ Error processing your message.")
        return

    if not user_text and "text" not in message:
        # If we couldn't extract text and it wasn't a text message, it's likely an unsupported format
        await send_message(chat_id, "Sorry, I can only process text, images, voice notes, and videos.")
        return

    # --- 5. FINAL VERIFICATION ---
    if user_text:
        if DEBUG_MODE:
            print(f"SUCCESSFULLY RETRIEVED: {user_text}")
        
        verdict_text = verify_claim(user_text)
        await send_message(chat_id, verdict_text)
        
        
async def download_telegram_file(file_id: str, extension: str) -> str:
    """
    Downloads a file from Telegram's servers to the local temp_media folder.
    """
    async with httpx.AsyncClient() as client:
        # Step 1: Ask Telegram for the file path using the ID
        get_file_url = f"{TELE_API_URL}/getFile?file_id={file_id}"
        response = await client.get(get_file_url)
        file_path_info = response.json()["result"]["file_path"]

        # Step 2: Download the actual bytes
        download_url = f"{FILE_API_URL}/{file_path_info}"
        file_data = await client.get(download_url)
        
        # Step 3: Save it locally
        local_path = f"temp_media/{file_id}_{extension}"
        with open(local_path, "wb") as f:
            f.write(file_data.content)
            
        return local_path

async def send_message(chat_id: int, text: str):
    """
    Send message to user on telegram

    Args:
        chat_id (int): user chat id
        text (str): verdict to send user
    """
    url = f"{TELE_API_URL}/sendMessage"
    async with httpx.AsyncClient() as client:
        await client.post(url, json={"chat_id": chat_id, "text": text})