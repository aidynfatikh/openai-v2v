import os
import tempfile
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from fastapi import UploadFile

load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("OPENAI_API_KEY not set in environment")

client = OpenAI(api_key=api_key)
SYSTEM_PROMPT = "You are a helpful assistant. Respond concisely in under 100 words."

async def transcribe_audio(file: UploadFile):
    """
    Transcribe uploaded audio via Whisper.
    Writes to a temp file with correct suffix so Whisper recognizes format.
    Returns: {"transcript": str}
    """
    contents = await file.read()
    suffix = Path(file.filename).suffix or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(contents)
        tmp.flush()
        tmp_path = tmp.name
    try:
        with open(tmp_path, "rb") as f:
            resp = client.audio.transcriptions.create(
                model="whisper-1",
                file=f
            )
    finally:
        try:
            os.remove(tmp_path)
        except:
            pass
    return {"transcript": resp.text}

async def generate_gpt_reply(user_input: str, history: list[dict]) -> str:
    """
    Call GPT (gpt-3.5-turbo-0125) with history + user_input.
    Returns reply text.
    """
    if not isinstance(history, list):
        history = []
    trimmed = history[-4:] if len(history) > 4 else history
    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + trimmed + [
        {"role": "user", "content": user_input[:500]}
    ]
    resp = client.chat.completions.create(
        model="gpt-3.5-turbo-0125",
        messages=messages,
        temperature=0.0,
        max_tokens=150
    )
    return resp.choices[0].message.content.strip()

async def generate_tts(reply_text: str, voice: str = "nova") -> bytes:
    """
    Generate TTS for given reply_text.
    Returns raw mp3 bytes.
    """
    speech_resp = client.audio.speech.create(
        model="tts-1",
        voice=voice,
        input=reply_text[:400],
        response_format="mp3"
    )
    return speech_resp.read()
