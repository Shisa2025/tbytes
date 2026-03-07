# Handles Images and Videos, checks for AI related content as well (EXTENSION)

import os
import tempfile
import logging
from pathlib import Path

logger = logging.getLogger(__name__)
try:
    import whisper
    logger.info("Loading Whisper model into memory... (This takes a moment)")
    # Cache the model globally
    WHISPER_MODEL = whisper.load_model("base") 
except ImportError:
    WHISPER_MODEL = None
    logger.warning("whisper not installed. Run: pip install openai-whisper")

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
    """Use globally loaded OpenAI Whisper to transcribe audio or video file."""
    if not WHISPER_MODEL:
        raise ImportError("Whisper model is not loaded.")
        
    try:
        result = WHISPER_MODEL.transcribe(file_path)
        return result["text"].strip()
    except Exception as e:
        logger.error(f"Error transcribing audio/video: {e}")
        raise


_FRAME_OCR_IGNORE = {
    "Dashboard", "GitHub", "Gemini", "Hosting Accounts",
}

_TESSERACT_CONFIG = "--oem 3 --psm 6"


def extract_text_from_video_frames(file_path: str, interval_sec: float = 3.0) -> str:
    """Sample frames from a video every interval_sec seconds and OCR each frame."""
    try:
        import cv2
        import numpy as np
        import pytesseract
        from PIL import Image
    except ImportError as e:
        logger.error(f"Missing dependency for frame OCR: {e}")
        raise

    cap = cv2.VideoCapture(file_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    frame_interval = max(1, int(fps * interval_sec))

    seen_lines: set[str] = set()
    texts: list[str] = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % frame_interval == 0:
            h, w = frame.shape[:2]

            # Crop out menu bars, sidebars, status bars — keep centre content
            cropped = frame[
                int(h * 0.08):int(h * 0.90),
                int(w * 0.18):int(w * 0.95),
            ]

            # Bilateral filter: denoise while preserving text edges
            gray = cv2.cvtColor(cropped, cv2.COLOR_BGR2GRAY)
            denoised = cv2.bilateralFilter(gray, 9, 75, 75)

            # Larger block size (31) reduces speckle noise between characters
            processed = cv2.adaptiveThreshold(
                denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 2
            )

            # Morphological opening: remove isolated noise dots
            kernel = np.ones((2, 2), np.uint8)
            processed = cv2.morphologyEx(processed, cv2.MORPH_OPEN, kernel)

            img = Image.fromarray(processed)
            ocr_text = pytesseract.image_to_string(img, config=_TESSERACT_CONFIG).strip()

            for line in ocr_text.splitlines():
                line = " ".join(line.split()).strip()

                if len(line) < 8:
                    continue
                if any(kw in line for kw in _FRAME_OCR_IGNORE):
                    continue
                symbol_count = sum(1 for ch in line if not ch.isalnum() and not ch.isspace())
                if symbol_count / len(line) > 0.30:
                    continue

                if line not in seen_lines:
                    seen_lines.add(line)
                    texts.append(line)

        frame_idx += 1

    cap.release()
    return "\n".join(texts)


def extract_text_from_video(file_path: str) -> str:
    """Extract both audio transcription and on-screen text from a video."""
    parts: list[str] = []

    # Audio transcription
    try:
        audio_text = extract_text_from_audio_video(file_path)
        if audio_text:
            parts.append("=== Audio Transcription ===\n" + audio_text)
        else:
            parts.append("=== Audio Transcription ===\n(no speech detected)")
    except Exception as e:
        parts.append(f"=== Audio Transcription ===\nERROR: {e}")

    # Frame OCR
    try:
        frame_text = extract_text_from_video_frames(file_path)
        if frame_text:
            parts.append("=== On-Screen Text (OCR) ===\n" + frame_text)
        else:
            parts.append("=== On-Screen Text (OCR) ===\n(no text detected)")
    except Exception as e:
        parts.append(f"=== On-Screen Text (OCR) ===\nERROR: {e}")

    return "\n\n".join(parts)


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


def process_media(file_path: str) -> str:
    """
    Main entry point. Accepts a saved file path from Coder 1.
    Returns extracted/transcribed text, then deletes the temp file.
    """
    path_obj = Path(file_path)
    if not path_obj.exists():
        logger.error(f"File not found: {file_path}")
        return ""
        
    ext = path_obj.suffix.lower()
    filename = path_obj.name

    try:
        if ext in IMAGE_EXTENSIONS:
            logger.info(f"Processing image: {filename}")
            text = extract_text_from_image(file_path)
        elif ext in AUDIO_EXTENSIONS:
            logger.info(f"Transcribing audio: {filename}")
            text = extract_text_from_audio_video(file_path)
        elif ext in VIDEO_EXTENSIONS:
            logger.info(f"Processing video: {filename}")
            text = extract_text_from_video(file_path)
        else:
            raise ValueError(f"Unsupported file type: {ext}")
    finally:
        # Clean up the file Coder 1 downloaded so your hard drive doesn't fill up
        delete_temp_file(file_path)

    if not text:
        return ""

    return text


def _launch_gui():
    """Drag-and-drop GUI for testing media extraction."""
    try:
        from tkinterdnd2 import TkinterDnD, DND_FILES
        root = TkinterDnD.Tk()
        dnd_available = True
    except ImportError:
        import tkinter as tk
        root = tk.Tk()
        dnd_available = False

    import tkinter as tk
    from tkinter import filedialog, scrolledtext

    root.title("Media Processor Test")
    root.geometry("700x520")
    root.resizable(True, True)

    # Drop zone
    drop_label = tk.Label(
        root,
        text="drag an image / audio / video here\n(or click to browse)",
        bg="#2b2b2b", fg="#aaaaaa",
        font=("Helvetica", 14),
        relief="groove", bd=2,
        cursor="hand2",
    )
    drop_label.pack(fill="x", padx=20, pady=(20, 6), ipady=30)

    # Status bar
    status_var = tk.StringVar(value="Waiting for file…")
    status_label = tk.Label(root, textvariable=status_var, fg="#888888", font=("Helvetica", 10))
    status_label.pack(anchor="w", padx=22)

    # Output area
    output = scrolledtext.ScrolledText(root, wrap="word", font=("Courier", 11),
                                       bg="#1e1e1e", fg="#d4d4d4",
                                       insertbackground="white", state="disabled")
    output.pack(fill="both", expand=True, padx=20, pady=(6, 20))

    def show_output(text: str):
        output.config(state="normal")
        output.delete("1.0", "end")
        output.insert("end", text)
        output.config(state="disabled")

    def process_path(file_path: str):
        file_path = file_path.strip().strip("{}")  # Windows DnD wraps paths in {}
        if not Path(file_path).exists():
            status_var.set("File not found.")
            show_output(f"Path not found:\n{file_path}")
            return

        ext = Path(file_path).suffix.lower()
        status_var.set(f"Processing: {Path(file_path).name} …")
        root.update_idletasks()

        try:
            if ext in IMAGE_EXTENSIONS:
                result = extract_text_from_image(file_path)
            elif ext in AUDIO_EXTENSIONS:
                result = extract_text_from_audio_video(file_path)
            elif ext in VIDEO_EXTENSIONS:
                result = extract_text_from_video(file_path)
            else:
                result = f"Unsupported file type: {ext}"
            status_var.set(f"Done — {len(result)} characters extracted")
            show_output(result if result else "(no text extracted)")
        except Exception as e:
            status_var.set("Error during processing")
            show_output(f"ERROR:\n{e}")

    def on_drop(event):
        process_path(event.data)

    def on_browse(*_):
        file_path = filedialog.askopenfilename(
            title="Select a file",
            filetypes=[
                ("All supported", "*.jpg *.jpeg *.png *.bmp *.tiff *.webp "
                 "*.mp3 *.wav *.ogg *.m4a *.flac *.mp4 *.mov *.avi *.mkv *.webm"),
                ("Images", "*.jpg *.jpeg *.png *.bmp *.tiff *.webp"),
                ("Audio", "*.mp3 *.wav *.ogg *.m4a *.flac"),
                ("Video", "*.mp4 *.mov *.avi *.mkv *.webm"),
            ],
        )
        if file_path:
            process_path(file_path)

    drop_label.bind("<Button-1>", on_browse)

    if dnd_available:
        drop_label.drop_target_register(DND_FILES)
        drop_label.dnd_bind("<<Drop>>", on_drop)
    else:
        drop_label.config(text="click to browse for an image / audio / video\n(install tkinterdnd2 for drag-and-drop)")

    root.mainloop()


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    if "--gui" in sys.argv:
        _launch_gui()
        sys.exit(0)

    # --- Test save_temp_file & delete_temp_file ---
    print("\n=== Test: save_temp_file / delete_temp_file ===")
    dummy_bytes = b"hello test"
    path = save_temp_file(dummy_bytes, "test_dummy.txt")
    assert Path(path).exists(), "File should exist after save"
    print(f"  Saved to: {path}")
    delete_temp_file(path)
    assert not Path(path).exists(), "File should be gone after delete"
    print("  Deleted successfully.")

    # --- Test process_media with unsupported extension ---
    print("\n=== Test: process_media with unsupported extension ===")
    try:
        process_media(b"data", "test.xyz")
        print("  ERROR: should have raised ValueError")
        sys.exit(1)
    except ValueError as e:
        print(f"  Correctly raised ValueError: {e}")

    # --- Test extract_text_from_image (requires pytesseract + Pillow) ---
    print("\n=== Test: extract_text_from_image ===")
    try:
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (300, 60), color="white")
        draw = ImageDraw.Draw(img)
        draw.text((10, 15), "TBytes test 123", fill="black")
        img_path = str(TEMP_MEDIA_DIR / "_test_image.png")
        img.save(img_path)

        result = extract_text_from_image(img_path)
        delete_temp_file(img_path)
        print(f"  Extracted text: {repr(result)}")
        assert "123" in result or len(result) > 0, "Expected some text from image"
        print("  PASSED")
    except ImportError as e:
        print(f"  SKIPPED (missing dependency): {e}")
    except Exception as e:
        print(f"  FAILED: {e}")

    # --- Test extract_text_from_audio_video (requires whisper) ---
    print("\n=== Test: extract_text_from_audio_video ===")
    import importlib.util
    if importlib.util.find_spec("whisper") is not None:
        print("  Whisper available but skipping real transcription in unit test.")
        print("  SKIPPED (no test audio file provided)")
    else:
        print("  SKIPPED (whisper not installed)")

    print("\nAll tests completed.")
