# Handles Images and Videos, checks for AI related content as well (EXTENSION)
import os
import logging
from pathlib import Path
import base64
import torch
import whisper
from openai import OpenAI

# CONFIGURATION
ACTIVE_MEDIA_ENGINE = "local"
THRESHOLD_MB = 15.0  # Files larger than this are routed to OpenAI automatically
logger = logging.getLogger(__name__)
openai_client = OpenAI()

# STARTUP GPU CHECK
device = "cuda" if torch.cuda.is_available() else "cpu"

if device == "cuda":
    print(f"STARTUP: Found {torch.cuda.get_device_name(0)}!")
    print("STARTUP: Loading Whisper 'medium' into GPU VRAM now...")
else:
    print("STARTUP: CUDA NOT FOUND. Loading to CPU.")

# Load Whisper model globally
WHISPER_MODEL = whisper.load_model("medium", device=device)
print(f"STARTUP: Whisper Medium is ONLINE (Hardware: {device.upper()})")

# DIRECTORIES
TEMP_MEDIA_DIR = Path(__file__).parent.parent / "temp_media"
TEMP_MEDIA_DIR.mkdir(exist_ok=True)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".flac"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

# --- HELPER FUNCTIONS ---
def _ocr_local(file_path: str) -> str:
    logger.info("Running Local Tesseract OCR...")
    import pytesseract
    from PIL import Image
    img = Image.open(file_path)
    return pytesseract.image_to_string(img).strip()

def _ocr_openai(file_path: str) -> str:
    logger.info("Running OpenAI Vision (High Quality)...")
    with open(file_path, "rb") as image_file:
        base64_image = base64.b64encode(image_file.read()).decode('utf-8')
    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": [
            {"type": "text", "text": "Extract all text exactly. Reply 'NO_TEXT' if none."},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
        ]}],
        timeout=15
    )
    res = response.choices[0].message.content.strip()
    return res if res != "NO_TEXT" else ""

def _transcribe_local(file_path: str) -> str:
    logger.info("Running Local Whisper (with Multilingual Prompt)...")
    result = WHISPER_MODEL.transcribe(
        file_path, 
        initial_prompt="The following is a news claim or report in Singapore."
    )
    return result["text"].strip()

def _transcribe_openai(file_path: str) -> str:
    logger.info("Running OpenAI Cloud Whisper...")
    with open(file_path, "rb") as audio_file:
        transcription = openai_client.audio.transcriptions.create(
            model="whisper-1", 
            file=audio_file,
            timeout=30
        )
    return transcription.text.strip()

# --- MAIN PROCESSORS ---
def extract_text_from_image(file_path: str) -> str:
    """Toggles between Local Tesseract and OpenAI Vision."""
    if ACTIVE_MEDIA_ENGINE == "local":
        try: return _ocr_local(file_path)
        except Exception: return _ocr_openai(file_path)
    else:
        try: return _ocr_openai(file_path)
        except Exception: return _ocr_local(file_path)

def extract_text_from_audio_video(file_path: str, engine: str = None) -> str:
    """Uses Local or OpenAI based on routing decision."""
    engine = engine or ACTIVE_MEDIA_ENGINE

    if engine == "local":
        try: return _transcribe_local(file_path)
        except Exception: return _transcribe_openai(file_path)
    else:
        return _transcribe_openai(file_path)

def extract_text_from_video_frames(file_path: str, interval_sec: float = 3.0) -> str:
    """Samples frames and performs OCR on each."""
    import cv2
    import numpy as np
    import pytesseract
    from PIL import Image

    cap = cv2.VideoCapture(file_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    frame_interval = max(1, int(fps * interval_sec))

    seen_lines, texts, frame_idx = set(), [], 0

    while True:
        ret, frame = cap.read()
        if not ret: break
        
        # Resize to maintain performance on the RTX 5050
        frame = cv2.resize(frame, (1280, 720))
        
        if frame_idx % frame_interval == 0:
            h, w = frame.shape[:2]
            cropped = frame[int(h * 0.08):int(h * 0.90), int(w * 0.18):int(w * 0.95)]
            gray = cv2.cvtColor(cropped, cv2.COLOR_BGR2GRAY)
            denoised = cv2.bilateralFilter(gray, 9, 75, 75)
            processed = cv2.adaptiveThreshold(denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 2)
            
            img = Image.fromarray(processed)
            ocr_text = pytesseract.image_to_string(img, config="--oem 3 --psm 6").strip()

            for line in ocr_text.splitlines():
                line = " ".join(line.split()).strip()
                # FILTER: Removes gibberish and artifacts
                alphanumeric_pct = sum(1 for ch in line if ch.isalnum()) / len(line) if line else 0
                if len(line) < 10 or alphanumeric_pct < 0.7: continue
                if line not in seen_lines:
                    seen_lines.add(line)
                    texts.append(line)
        frame_idx += 1
    cap.release()
    return "\n".join(texts)

def process_media(file_path: str) -> str:
    path_obj = Path(file_path)
    if not path_obj.exists(): return ""
    
    file_size_mb = path_obj.stat().st_size / (1024 * 1024)
    ext = path_obj.suffix.lower()
    
    # HYBRID ROUTING DECISION
    current_engine = "openai" if file_size_mb > THRESHOLD_MB else "local"
    
    try:
        if ext in IMAGE_EXTENSIONS:
            text = extract_text_from_image(file_path)
        elif ext in AUDIO_EXTENSIONS:
            text = extract_text_from_audio_video(file_path, engine=current_engine)
        elif ext in VIDEO_EXTENSIONS:
            if current_engine == "openai":
                logger.info(f"Routing large video ({file_size_mb:.1f}MB) to OpenAI Cloud...")
                text = f"=== Cloud Audio Transcription ===\n" + extract_text_from_audio_video(file_path, engine="openai")
            else:
                logger.info(f"Processing small claim ({file_size_mb:.1f}MB) on local GPU...")
                text = f"=== Local Audio Transcription ===\n" + extract_text_from_audio_video(file_path, engine="local")
                text += "\n\n=== On-Screen Text (OCR) ===\n" + extract_text_from_video_frames(file_path)
        else:
            raise ValueError(f"Unsupported extension: {ext}")
    finally:
        delete_temp_file(file_path)
    return text

def delete_temp_file(file_path: str):
    try: os.remove(file_path)
    except FileNotFoundError: pass