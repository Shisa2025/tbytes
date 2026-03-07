import os
import httpx
from dotenv import load_dotenv

# Load your environment variables
load_dotenv()

def get_active_ngrok_url() -> str:
    """Queries ngrok's local API to find the active HTTPS tunnel."""
    try:
        # ngrok hosts a local dashboard at 4040 that outputs JSON data
        response = httpx.get("http://127.0.0.1:4040/api/tunnels")
        tunnels = response.json().get("tunnels", [])
        
        for tunnel in tunnels:
            if tunnel["public_url"].startswith("https"):
                return tunnel["public_url"]
        return ""
    except httpx.ConnectError:
        # If the connection fails, ngrok isn't running
        return ""

def main():
    print("\n" + "="*45)
    print("OmniSource Demo & Setup Links")
    print("="*45)
    
    # 1. Grab the Token
    bot_token = os.getenv("TELEGRAM_TOKEN")
    if not bot_token:
        print("Error: TELEGRAM_TOKEN not found in your .env file.")
        return

    # 2. Grab the Tunnel
    ngrok_url = get_active_ngrok_url()
    if not ngrok_url:
        print("Error: I can't find an active ngrok tunnel.")
        print("   Make sure you run './ngrok http 8080' in another terminal first!")
        return
        
    # 3. Build the exact Handshake URL
    webhook_url = f"https://api.telegram.org/bot{bot_token}/setWebhook?url={ngrok_url}/webhook"
    
    # 4. Display the results safely
    print(f"✅ Ngrok URL: {ngrok_url}")
    # We slice the token so we don't accidentally leak the whole thing on a projector
    print(f"✅ Bot Token: {bot_token[:6]}...{bot_token[-4:]}") 
    
    print("\n🔗 WEBHOOK SETUP LINK:")
    print("Just Ctrl+Click (or copy/paste) this link into your browser to connect the bot:")
    print(f"\n{webhook_url}\n")
    print("="*45 + "\n")

if __name__ == "__main__":
    main()