import React, { useState, useRef, useEffect } from "react";

const BACKEND_URL = "http://localhost:8000"; // adjust if needed

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SILENCE_THRESHOLD = 0.01; // adjust: RMS below this is “silence”
const SILENCE_DURATION = 1500; // ms of continuous silence before stopping

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

  // Cleanup audio context when component unmounts or recording stops
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

  // Analyze audio for silence
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
      // compute RMS
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sumSquares += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      const now = performance.now();
      if (rms > SILENCE_THRESHOLD) {
        lastSoundTimeRef.current = now;
      } else {
        // if silence duration exceeded, stop recording
        if (now - lastSoundTimeRef.current > SILENCE_DURATION) {
          stopRecording(); // automatic stop
          return;
        }
      }
      // schedule next check
      silenceTimerRef.current = window.setTimeout(checkSilence, 200);
    };

    checkSilence();
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    cleanupAudioContext();
    setIsRecording(false);
  };

  const handleAsk = () => {
    const userMsg = text.trim();
    if (!userMsg) return;
    askWithMessage(userMsg);
  };

  const askWithMessage = async (userMsg: string) => {
    if (!userMsg.trim()) return;

    setError(null);
    // Append user message to history
    const newHistory = [...history, { role: "user" as "user", content: userMsg }];
    setHistory(newHistory);
    setText(""); // clear input

    // 1. Get text reply
    setIsThinkingText(true);
    let replyText: string;
    try {
      const resText = await fetch(`${BACKEND_URL}/chat-text/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: userMsg,
          history: newHistory,
          voice: "nova"
        })
      });
      if (!resText.ok) {
        const err = await resText.text();
        throw new Error(err || `Status ${resText.status}`);
      }
      const dataText = await resText.json();
      replyText = dataText.reply;
      // Append assistant reply to history
      setHistory(prev => [...prev, { role: "assistant", content: replyText }]);
    } catch (e: any) {
      console.error("chat-text error:", e);
      setError("Error fetching text response");
      setIsThinkingText(false);
      return;
    }
    setIsThinkingText(false);

    // 2. Get voice reply
    setIsThinkingVoice(true);
    try {
      const resVoice = await fetch(`${BACKEND_URL}/chat-voice/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: userMsg,
          history: newHistory,
          voice: "nova"
        })
      });
      if (!resVoice.ok) {
        const err = await resVoice.text();
        throw new Error(err || `Status ${resVoice.status}`);
      }
      const blob = await resVoice.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.onended = () => {
        setIsThinkingVoice(false);
      };
      audio.play();
    } catch (e: any) {
      console.error("chat-voice error:", e);
      setError("Error fetching voice response");
      setIsThinkingVoice(false);
    }
  };

  const handleRecordToggle = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      setError(null);
      setIsRecording(true);
      chunksRef.current = [];
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Start silence detection
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
          // assemble blob
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          // send to /transcribe/
          const formData = new FormData();
          formData.append("file", blob, "voice.webm");
          try {
            const res = await fetch(`${BACKEND_URL}/transcribe/`, {
              method: "POST",
              body: formData
            });
            if (!res.ok) {
              const err = await res.text();
              throw new Error(err || `Status ${res.status}`);
            }
            const data = await res.json();
            if (data.transcript) {
              const transcript: string = data.transcript;
              setText(transcript);
              // Auto-send the transcript:
              await askWithMessage(transcript);
            } else {
              throw new Error("No transcript in response");
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

  // Cleanup if component unmounts while recording
  useEffect(() => {
    return () => {
      if (isRecording) {
        stopRecording();
      }
    };
  }, [isRecording]);

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
          onClick={handleAsk}
          disabled={isThinkingText || isThinkingVoice || !text.trim() || isRecording}
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
          {isThinkingText
            ? "🤖 AI is generating text..."
            : "🔊 Generating voice..."}
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
