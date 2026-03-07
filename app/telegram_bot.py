import httpx
import os

from sympy import false
from .config import TELEGRAM_TOKEN
from .rag_pipeline import verify_claim
from .logger import log_query
# Assuming Coder 3 has a function like this ready:
# from .media_processor import process_media 

TELE_API_URL = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
FILE_API_URL = f"https://api.telegram.org/file/bot{TELEGRAM_TOKEN}"

DEBUG=True

# Ensure a temporary folder exists for downloads
os.makedirs("temp_media", exist_ok=True)

async def handle_telegram_webhook(data: dict):
    """
    Retrieve the telegram webhook, process it and send message to user

    Args:
        data (dict): telegram data
    """
    if "message" not in data: 
        return
    
    message = data["message"]
    chat_id = message["chat"]["id"]
    user_text = ""
    MAX_BYTES = 20 * 1024 * 1024 #20MB limit

    # 1. Handle standard text messages
    if "text" in message:
        user_text = message["text"]

    # 2. Handle Images (Telegram sends photos as an array of sizes, grab the largest)
    elif "photo" in message:
        photo_obj = message["photo"][-1] # Get the highest resolution version
        # Check if photo file size is of acceptable size, inform user otherwise
        if photo_obj.get("file_size", 0) > MAX_BYTES:
            await send_message(chat_id, "📸 That image is too large! Please send something under 20MB.")
            return
        
        # Retrieve file ID of photo image for download and processing
        file_id = photo_obj["file_id"]
        file_path = await download_telegram_file(file_id, "image.jpg")
        # TO BE REPLACED WITH CODER 3's media output
        user_text = f"Simulated OCR extraction for {file_path}"

    # 3. Handle Voice Notes
    elif "voice" in message:
        # Get the voice object
        voice_obj = message["voice"]
        # Check the voice message file size, inform user if voice note is too big
        if voice_obj.get("file_size", 0) > MAX_BYTES:
            await send_message(chat_id, "🎤 That voice note is too long! Please keep it under 20MB.")
            return
        
        #Retrieve file ID for download and processing
        file_id = voice_obj["file_id"]
        file_path = await download_telegram_file(file_id, "audio.ogg")
        # TO BE REPLACED WITH CODER 3's media output
        user_text = f"Simulated Whisper transcription for {file_path}"

    # If we successfully got text (either directly or via extraction)
    if user_text:
        if not DEBUG:
            verdict_text = verify_claim(user_text)
            log_query("Unknown", user_text, verdict_text)
            await send_message(chat_id, verdict_text)
        else:
            # -- DEBUG MODE to test bot --
            print(f"✅ SUCCESSFULLY RETRIEVED: {user_text}")
            # Send a dummy reply to prove the bot can talk back
            mock_verdict = f"Received your data! Length: {len(user_text)} characters."
            await send_message(chat_id, mock_verdict)
    #Inform user that the bot cannot process the file that was sent
    else:
        await send_message(chat_id, "Sorry, I can only process text, images, and voice notes.")

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