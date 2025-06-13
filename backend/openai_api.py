import os
import io
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
    # Read all bytes
    contents = await file.read()
    # Determine suffix from original filename, default to .webm if missing
    suffix = Path(file.filename).suffix or ".webm"
    # Write to a NamedTemporaryFile so OpenAI SDK can inspect extension
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
    except Exception as e:
        # Clean up temp file, then propagate error
        os.remove(tmp_path)
        raise RuntimeError(f"Whisper transcription failed: {e}")
    # Cleanup
    os.remove(tmp_path)
    return {"transcript": resp.text}

async def chat_with_gpt(user_input: str, history: list[dict], voice: str = "nova"):
    """
    Call GPT with history + user_input, then TTS the reply.
    Returns: (audio_bytes: bytes, reply_text: str)
    """
    if not isinstance(history, list):
        history = []
    trimmed = history[-4:] if len(history) > 4 else history
    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + trimmed + [
        {"role": "user", "content": user_input[:500]}
    ]

    # ChatCompletion
    chat_resp = client.chat.completions.create(
        model="gpt-3.5-turbo-0125",
        messages=messages,
        temperature=0.7,
        max_tokens=150
    )
    reply_text = chat_resp.choices[0].message.content.strip()

    # TTS
    speech_resp = client.audio.speech.create(
        model="tts-1",
        voice=voice,
        input=reply_text[:400],
        response_format="mp3"
    )
    audio_bytes = speech_resp.read()
    return audio_bytes, reply_text
