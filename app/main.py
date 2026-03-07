# The FastAPI server entry point

from fastapi import FastAPI, Request
from .telegram_bot import handle_telegram_webhook
import uvicorn

app = FastAPI()

@app.post("/webhook")
async def telegram_webhook(request: Request):
    """
    Receives incoming pings from Telegram and passes data to the bot logic.
    """
    data = await request.json()
    await handle_telegram_webhook(data)
    return {"status": "ok"}

if __name__ == "__main__":
    # Runs the server on port 8000 
    uvicorn.run(app, host="0.0.0.0", port=8000)