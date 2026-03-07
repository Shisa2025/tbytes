# Handles Images and Videos, checks for AI related content as well (EXTENSION)

import os
import tempfile
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

TEMP_MEDIA_DIR = Path(__file__).parent.parent / "temp_media"
TEMP_MEDIA_DIR.mkdir(exist_ok=True)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".flac"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


def extract_text_from_image(file_path: str) -> str:
    """Use pytesseract OCR to extract text from an image file."""
    try:
        import pytesseract
        from PIL import Image

        img = Image.open(file_path)
        text = pytesseract.image_to_string(img)
        return text.strip()
    except ImportError:
        logger.error("pytesseract or Pillow not installed.")
        raise
    except Exception as e:
        logger.error(f"Error extracting text from image: {e}")
        raise


def extract_text_from_audio_video(file_path: str) -> str:
    """Use OpenAI Whisper to transcribe audio or video file."""
    try:
        import whisper

        model = whisper.load_model("base")
        result = model.transcribe(file_path)
        return result["text"].strip()
    except ImportError:
        logger.error("whisper not installed. Run: pip install openai-whisper")
        raise
    except Exception as e:
        logger.error(f"Error transcribing audio/video: {e}")
        raise


def save_temp_file(file_bytes: bytes, filename: str) -> str:
    """Save incoming file bytes to temp_media/ and return the path."""
    dest = TEMP_MEDIA_DIR / filename
    with open(dest, "wb") as f:
        f.write(file_bytes)
    logger.info(f"Saved temp file: {dest}")
    return str(dest)


def delete_temp_file(file_path: str):
    """Delete a temp file after processing."""
    try:
        os.remove(file_path)
        logger.info(f"Deleted temp file: {file_path}")
    except FileNotFoundError:
        pass


def process_media(file_bytes: bytes, filename: str) -> str:
    """
    Main entry point. Accepts raw file bytes and filename.
    Returns extracted/transcribed text, then deletes the temp file.
    """
    file_path = save_temp_file(file_bytes, filename)
    ext = Path(filename).suffix.lower()

    try:
        if ext in IMAGE_EXTENSIONS:
            logger.info(f"Processing image: {filename}")
            text = extract_text_from_image(file_path)
        elif ext in AUDIO_EXTENSIONS or ext in VIDEO_EXTENSIONS:
            logger.info(f"Transcribing audio/video: {filename}")
            text = extract_text_from_audio_video(file_path)
        else:
            raise ValueError(f"Unsupported file type: {ext}")
    finally:
        delete_temp_file(file_path)

    if not text:
        logger.warning(f"No text extracted from {filename}")
        return ""

    logger.info(f"Extracted {len(text)} characters from {filename}")
    return text
