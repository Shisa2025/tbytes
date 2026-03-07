from fastapi import FastAPI, Request, BackgroundTasks
from pydantic import BaseModel
import uvicorn

from app.telegram_bot import handle_telegram_webhook
import app.rag_pipeline as rag_pipeline 
import app.media_processor as media_processor
import logging
import sys

app = FastAPI()

# This forces every 'logger.info' in every file to print to your terminal
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

@app.get("/")
def health_check():
    return {
        "status": "OmniSource is Live", 
        "gpu": "RTX 5050 Ready",
        "active_modes": {
            "rag_engine": rag_pipeline.ACTIVE_ENGINE,
            "media_engine": media_processor.ACTIVE_MEDIA_ENGINE
        }
    }

# --- TELEGRAM WEBHOOK ---
@app.post("/webhook")
async def telegram_webhook(request: Request, background_tasks: BackgroundTasks):
    data = await request.json()
    
    # Step 1: Push the heavy Blackwell processing to the background
    background_tasks.add_task(handle_telegram_webhook, data)
    
    # Step 2: Return 200 OK IMMEDIATELY. 
    # Telegram sees this and says "Cool, he got it" and stops the retries.
    return {"status": "ok"}

# --- DASHBOARD ENDPOINTS ---
class EngineToggle(BaseModel):
    engine: str 

@app.get("/api/engine")
def get_current_engine():
    """Dashboard uses this to check which engine is currently active."""
    return {"active_engine": rag_pipeline.ACTIVE_ENGINE}

@app.post("/api/engine")
def set_current_engine(data: EngineToggle):
    """Dashboard uses this to flip the switch."""
    if data.engine in ["groq", "openai"]:
        rag_pipeline.ACTIVE_ENGINE = data.engine
        print(f"DASHBOARD OVERRIDE: Primary engine is now {data.engine.upper()}")
        return {"status": "success", "active_engine": rag_pipeline.ACTIVE_ENGINE}
    return {"status": "error", "message": "Invalid engine. Must be 'groq' or 'openai'"}

# --- NEW MEDIA DASHBOARD ENDPOINTS ---
class MediaEngineToggle(BaseModel):
    engine: str # Expects "local" or "openai"

@app.get("/api/media_engine")
def get_current_media_engine():
    """Dashboard checks which media engine is currently active."""
    return {"active_media_engine": media_processor.ACTIVE_MEDIA_ENGINE}

@app.post("/api/media_engine")
def set_current_media_engine(data: MediaEngineToggle):
    """Dashboard uses this to flip the media processor switch."""
    if data.engine in ["local", "openai"]:
        media_processor.ACTIVE_MEDIA_ENGINE = data.engine
        print(f"DASHBOARD OVERRIDE: Media engine is now {data.engine.upper()}")
        return {"status": "success", "active_media_engine": media_processor.ACTIVE_MEDIA_ENGINE}
    return {"status": "error", "message": "Invalid engine. Must be 'local' or 'openai'"}

# --- GLOBAL MODE ENDPOINT ---
class GlobalMode(BaseModel):
    mode: str # "openai_only" or "hybrid"

@app.post("/api/global_mode")
def set_global_mode(data: GlobalMode):
    """Dashboard button calls this to enforce OpenAI Only or revert to Hybrid."""
    if data.mode == "openai_only":
        rag_pipeline.ACTIVE_ENGINE = "openai"
        media_processor.ACTIVE_MEDIA_ENGINE = "openai"
        print("DASHBOARD OVERRIDE: System set to OpenAI ONLY Mode")
        return {"status": "success", "mode": "openai_only"}
    elif data.mode == "hybrid":
        rag_pipeline.ACTIVE_ENGINE = "groq"
        media_processor.ACTIVE_MEDIA_ENGINE = "local"
        print("DASHBOARD OVERRIDE: System set to HYBRID Mode")
        return {"status": "success", "mode": "hybrid"}
    return {"status": "error", "message": "Invalid mode. Use 'openai_only' or 'hybrid'"}

# --- THE ENGINE STARTER ---
if __name__ == "__main__":
    # This is what actually boots up the server when you run 'python -m app.main'
    uvicorn.run(app, host="127.0.0.1", port=8080)