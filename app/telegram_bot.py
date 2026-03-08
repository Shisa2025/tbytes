import asyncio
import httpx
import logging
import os
from typing import Optional

from .config import TELEGRAM_TOKEN
from .logger import log_query
from .media_processor import process_media
from .rag_pipeline import verify_claim
from .text_utils import detect_language_tag

logger = logging.getLogger(__name__)

TELE_API_URL = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"
FILE_API_URL = f"https://api.telegram.org/file/bot{TELEGRAM_TOKEN}"

DEBUG_MODE = True
_CHAT_LOCKS: dict[int, asyncio.Lock] = {}

# Ensure a temporary folder exists for downloads
os.makedirs("temp_media", exist_ok=True)


def _extract_verdict_tag(verdict_text: str) -> str:
    v = (verdict_text or "").lower()
    if "misleading" in v:
        return "misleading"
    if "false" in v:
        return "false"
    if "true" in v:
        return "true"
    if "unverified" in v:
        return "unverified"
    return "unknown"


def _get_chat_lock(chat_id: int) -> asyncio.Lock:
    lock = _CHAT_LOCKS.get(chat_id)
    if lock is None:
        lock = asyncio.Lock()
        _CHAT_LOCKS[chat_id] = lock
    return lock


async def _extract_content_from_message(message: dict, chat_id: int) -> str:
    """Helper to extract text or process media from a Telegram message."""
    # 1. TEXT
    if "text" in message:
        return str(message["text"])

    # 1b. MEDIA CAPTION (prefer explicit user caption over OCR/transcription noise)
    if "caption" in message and str(message["caption"]).strip():
        return str(message["caption"]).strip()

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
            await send_message(chat_id, "Video detected. Processing now...")
        file_path = await download_telegram_file(file_id, "video.mp4")
        return process_media(file_path)

    return ""


async def handle_telegram_webhook(data: dict):
    if "message" not in data:
        return

    message = data["message"]
    chat_id = message["chat"]["id"]
    message_id = message.get("message_id")

    # Process one message at a time per chat to avoid out-of-order replies.
    async with _get_chat_lock(chat_id):
        try:
            user_text = await _extract_content_from_message(message, chat_id)
        except Exception as e:
            logger.error(f"Media Processing Error: {e}")
            await send_message(chat_id, "Error processing your message.", reply_to_message_id=message_id)
            return

        if not user_text and "text" not in message:
            await send_message(
                chat_id,
                "Sorry, I can only process text, images, voice notes, and videos.",
                reply_to_message_id=message_id,
            )
            return

        if user_text:
            if DEBUG_MODE:
                print(f"MESSAGE_ID={message_id} SUCCESSFULLY RETRIEVED: {user_text}")

            verdict_text = verify_claim(user_text)
            log_query(detect_language_tag(user_text), user_text, _extract_verdict_tag(verdict_text))
            await send_message(chat_id, verdict_text, reply_to_message_id=message_id)


async def download_telegram_file(file_id: str, extension: str) -> str:
    """Downloads a file from Telegram's servers to the local temp_media folder."""
    async with httpx.AsyncClient() as client:
        get_file_url = f"{TELE_API_URL}/getFile?file_id={file_id}"
        response = await client.get(get_file_url)
        file_path_info = response.json()["result"]["file_path"]

        download_url = f"{FILE_API_URL}/{file_path_info}"
        file_data = await client.get(download_url)

        local_path = f"temp_media/{file_id}_{extension}"
        with open(local_path, "wb") as f:
            f.write(file_data.content)

        return local_path


async def send_message(chat_id: int, text: str, reply_to_message_id: Optional[int] = None):
    """Send message to user on Telegram."""
    url = f"{TELE_API_URL}/sendMessage"
    payload = {"chat_id": chat_id, "text": text}
    if reply_to_message_id is not None:
        payload["reply_to_message_id"] = reply_to_message_id
        payload["allow_sending_without_reply"] = True

    async with httpx.AsyncClient() as client:
        await client.post(url, json=payload)
