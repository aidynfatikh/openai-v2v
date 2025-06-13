import io
import base64
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from openai_api import transcribe_audio, chat_with_gpt

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/transcribe/")
async def endpoint_transcribe(file: UploadFile = File(...)):
    try:
        return await transcribe_audio(file)
    except Exception as e:
        # Return the error message for debugging
        return JSONResponse({"error": str(e)}, status_code=400)

@app.post("/chat-text/")
async def endpoint_chat_text(payload: dict):
    user_text = payload.get("text", "").strip()
    if not user_text:
        return JSONResponse({"error": "No text provided"}, status_code=400)
    history = payload.get("history", [])
    voice = payload.get("voice", "nova")
    try:
        _, reply_text = await chat_with_gpt(user_text, history, voice)
    except Exception as e:
        return JSONResponse({"error": f"OpenAI error: {e}"}, status_code=500)
    return {"reply": reply_text}

@app.post("/chat-voice/")
async def endpoint_chat_voice(payload: dict):
    user_text = payload.get("text", "").strip()
    if not user_text:
        return JSONResponse({"error": "No text provided"}, status_code=400)
    history = payload.get("history", [])
    voice = payload.get("voice", "nova")
    try:
        audio_bytes, _ = await chat_with_gpt(user_text, history, voice)
    except Exception as e:
        return JSONResponse({"error": f"OpenAI error: {e}"}, status_code=500)
    return StreamingResponse(io.BytesIO(audio_bytes), media_type="audio/mpeg")
