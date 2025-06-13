import io
import base64
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from openai_api import transcribe_audio, generate_gpt_reply, generate_tts

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # for dev; restrict in prod
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/transcribe/")
async def endpoint_transcribe(file: UploadFile = File(...)):
    try:
        return await transcribe_audio(file)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

@app.post("/chat-text/")
async def endpoint_chat_text(payload: dict):
    user_text = payload.get("text", "").strip()
    if not user_text:
        return JSONResponse({"error": "No text provided"}, status_code=400)
    history = payload.get("history", [])
    try:
        reply_text = await generate_gpt_reply(user_text, history)
    except Exception as e:
        return JSONResponse({"error": f"OpenAI error: {e}"}, status_code=500)
    return {"reply": reply_text}

@app.post("/chat-voice/")
async def endpoint_chat_voice(payload: dict):
    # Expects payload: {"text": "<exact GPT reply>", "voice": "nova"}
    reply_text = payload.get("text", "").strip()
    if not reply_text:
        return JSONResponse({"error": "No text provided for TTS"}, status_code=400)
    voice = payload.get("voice", "nova")
    try:
        audio_bytes = await generate_tts(reply_text, voice)
    except Exception as e:
        return JSONResponse({"error": f"OpenAI error: {e}"}, status_code=500)
    return StreamingResponse(io.BytesIO(audio_bytes), media_type="audio/mpeg")

@app.post("/chat/")
async def endpoint_chat(payload: dict):
    """
    Combined: GPT + TTS in one call.
    Expects: {"text": "...", "history": [...], "voice": "nova"}
    Returns: {"reply": "...", "audio_base64": "..."}
    """
    user_text = payload.get("text", "").strip()
    if not user_text:
        return JSONResponse({"error": "No text provided"}, status_code=400)
    history = payload.get("history", [])
    voice = payload.get("voice", "nova")
    try:
        reply_text = await generate_gpt_reply(user_text, history)
        audio_bytes = await generate_tts(reply_text, voice)
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
    except Exception as e:
        return JSONResponse({"error": f"OpenAI error: {e}"}, status_code=500)
    return {"reply": reply_text, "audio_base64": audio_b64}
