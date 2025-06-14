import React, { useState, useRef, useEffect } from "react";

const BACKEND_URL = import.meta.env.VITE_API_URL;
console.log("Backend URL:", BACKEND_URL);

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SILENCE_THRESHOLD = 0.01; // RMS threshold for silence
const SILENCE_DURATION = 1500; // ms of continuous silence to auto-stop

const Chat: React.FC = () => {
  const [text, setText] = useState("");
  const [history, setHistory] = useState<Message[]>([]);
  const [isThinkingText, setIsThinkingText] = useState(false);
  const [isThinkingVoice, setIsThinkingVoice] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const lastSoundTimeRef = useRef<number>(0);

  // Cleanup audio context
  const cleanupAudioContext = () => {
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  // Silence detection
  const startSilenceDetection = (stream: MediaStream) => {
    const audioCtx = new AudioContext();
    audioContextRef.current = audioCtx;
    const sourceNode = audioCtx.createMediaStreamSource(stream);
    sourceNodeRef.current = sourceNode;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;
    sourceNode.connect(analyser);

    const dataArray = new Float32Array(analyser.fftSize);
    lastSoundTimeRef.current = performance.now();

    const checkSilence = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getFloatTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sumSquares += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      const now = performance.now();
      if (rms > SILENCE_THRESHOLD) {
        lastSoundTimeRef.current = now;
      } else {
        if (now - lastSoundTimeRef.current > SILENCE_DURATION) {
          stopRecording();
          return;
        }
      }
      silenceTimerRef.current = window.setTimeout(checkSilence, 200);
    };

    checkSilence();
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    cleanupAudioContext();
    setIsRecording(false);
  };

  // Core single-call chat: calls /chat/ endpoint
  const askWithMessage = async (userMsg: string) => {
    if (!userMsg.trim()) return;
    setError(null);
    // append user
    setHistory((prev) => [...prev, { role: "user", content: userMsg }]);
    setText("");

    // call combined endpoint
    setIsThinkingText(true);
    setIsThinkingVoice(false);
    try {
      const res = await fetch(`${BACKEND_URL}/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: userMsg,
          history: history.concat({ role: "user", content: userMsg }),
          voice: "nova",
        }),
      });
      if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(errTxt || `Status ${res.status}`);
      }
      const data = await res.json();
      const replyText: string = data.reply;
      const audioBase64: string = data.audio_base64;

      setHistory((prev) => [
        ...prev,
        { role: "assistant", content: replyText },
      ]);
      setIsThinkingText(false);

      if (audioBase64) {
        setIsThinkingVoice(true);
        const audioBlob = new Blob(
          [Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0))],
          { type: "audio/mpeg" }
        );
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.onended = () => setIsThinkingVoice(false);
        audio.play();
      }
    } catch (e: any) {
      console.error("chat error:", e);
      setError("Error during chat");
      setIsThinkingText(false);
      setIsThinkingVoice(false);
    }
  };

  const handleAskClick = () => {
    const msg = text.trim();
    if (!msg) return;
    askWithMessage(msg);
  };

  const handleRecordToggle = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      setError(null);
      setIsRecording(true);
      chunksRef.current = [];
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        startSilenceDetection(stream);

        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        mediaRecorder.onstop = async () => {
          cleanupAudioContext();
          setIsRecording(false);
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const formData = new FormData();
          formData.append("file", blob, "voice.webm");
          try {
            const res = await fetch(`${BACKEND_URL}/transcribe/`, {
              method: "POST",
              body: formData,
            });
            if (!res.ok) {
              const err = await res.text();
              throw new Error(err || `Status ${res.status}`);
            }
            const data = await res.json();
            if (data.transcript) {
              const transcript: string = data.transcript;
              setText(transcript);
              await askWithMessage(transcript);
            } else {
              throw new Error("No transcript");
            }
          } catch (e: any) {
            console.error("Transcription error:", e);
            setError("Error transcribing audio");
          }
        };

        mediaRecorder.start();
      } catch (e: any) {
        console.error("getUserMedia error:", e);
        setError("Cannot access microphone");
        setIsRecording(false);
        cleanupAudioContext();
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isRecording) stopRecording();
    };
  }, [isRecording]);

  useEffect(() => {
    console.log("Current BACKEND_URL:", BACKEND_URL);
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.historyBox}>
        {history.map((m, idx) => (
          <div
            key={idx}
            style={{
              ...styles.message,
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              backgroundColor: m.role === "user" ? "#d1fae5" : "#e5e7eb",
            }}
          >
            <strong>{m.role === "user" ? "You" : "AI"}:</strong> {m.content}
          </div>
        ))}
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <textarea
        placeholder="Type your message or use the mic..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        style={styles.textarea}
        disabled={isThinkingText || isThinkingVoice || isRecording}
      />

      <div style={styles.controlsRow}>
        <button
          onClick={handleRecordToggle}
          style={{
            ...styles.button,
            backgroundColor: isRecording ? "#ef4444" : "#10b981",
          }}
        >
          {isRecording ? "⏹ Stop Recording" : "🎤 Record"}
        </button>

        <button
          onClick={handleAskClick}
          disabled={
            isThinkingText || isThinkingVoice || !text.trim() || isRecording
          }
          style={{
            ...styles.button,
            backgroundColor:
              isThinkingText || isThinkingVoice ? "#a5b4fc" : "#4f46e5",
            cursor:
              isThinkingText || isThinkingVoice ? "not-allowed" : "pointer",
          }}
        >
          {isThinkingText
            ? "Thinking..."
            : isThinkingVoice
            ? "Speaking..."
            : "Ask & Speak"}
        </button>
      </div>

      {(isThinkingText || isThinkingVoice) && (
        <div style={styles.spinner}>
          {isThinkingText ? "🤖 Generating text..." : "🔊 Generating voice..."}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    width: "100%",
    maxWidth: "600px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.75rem",
    backgroundColor: "#ffffff",
    padding: "1rem",
    borderRadius: "12px",
    boxShadow: "0 6px 20px rgba(0,0,0,0.05)",
  },
  historyBox: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.5rem",
    maxHeight: "300px",
    overflowY: "auto" as const,
    padding: "0.5rem",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    backgroundColor: "#fafafa",
  },
  message: {
    padding: "0.5rem 0.75rem",
    borderRadius: "12px",
    maxWidth: "80%",
    wordBreak: "break-word" as const,
  },
  textarea: {
    width: "100%",
    fontSize: "1rem",
    padding: "0.75rem",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    resize: "none" as const,
  },
  controlsRow: {
    display: "flex",
    gap: "0.5rem",
    justifyContent: "flex-end",
  },
  button: {
    padding: "0.6rem 1rem",
    fontSize: "1rem",
    color: "#fff",
    borderRadius: "8px",
    border: "none",
  },
  spinner: {
    textAlign: "center" as const,
    fontSize: "1rem",
    color: "#6b7280",
  },
  error: {
    color: "red",
    fontSize: "0.9rem",
  },
};

export default Chat;
