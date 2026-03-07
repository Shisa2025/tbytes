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

async def handle_telegram_webhook(data: dict):
    if "message" not in data: 
        return
    
    message = data["message"]
    chat_id = message["chat"]["id"]
    user_text = ""
    MAX_BYTES = 20 * 1024 * 1024 

    # --- 1. TEXT ---
    if "text" in message:
        user_text = message["text"]

    # --- 2. PHOTOS ---
    elif "photo" in message:
        photo_obj = message["photo"][-1]
        file_id = photo_obj["file_id"]
        file_path = await download_telegram_file(file_id, "image.jpg")
        user_text = process_media(file_path)

    # --- 3. VOICE / AUDIO ---
    elif "voice" in message or "audio" in message:
        media_key = "voice" if "voice" in message else "audio"
        file_id = message[media_key]["file_id"]
        ext = "ogg" if media_key == "voice" else "mp3"
        file_path = await download_telegram_file(file_id, f"audio.{ext}")
        user_text = process_media(file_path)

    # --- 4. VIDEOS (The Fix is here) ---
    elif "video" in message or "video_note" in message or "document" in message:
        file_id = None
        
        # Check if it's a standard video
        if "video" in message:
            file_id = message["video"]["file_id"]
        # Check if it's a "round" video message
        elif "video_note" in message:
            file_id = message["video_note"]["file_id"]
        # Check if it's a file that happens to be a video (the 8MB catch)
        elif "document" in message:
            mime = message["document"].get("mime_type", "")
            if "video" in mime:
                file_id = message["document"]["file_id"]

        if file_id:
            if DEBUG_MODE:
                await send_message(chat_id, "📹 Video detected! Breaking it down on the RTX 5050...")
            
            file_path = await download_telegram_file(file_id, "video.mp4")
            try:
                user_text = process_media(file_path)
            except Exception as e:
                logger.error(f"Video Processing Error: {e}")
                await send_message(chat_id, "⚠️ Blackwell GPU error during video analysis.")
                return
        else:
            # If it's a document but NOT a video (like a PDF), ignore it
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