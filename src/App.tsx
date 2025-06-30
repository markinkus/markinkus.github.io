import React, { useState } from "react";
import {
  FrameMsg,
  StdLua,
  TxPlainText,
  TxCaptureSettings,
  RxPhoto
} from "frame-msg";
import plainTextFrameApp from "../lua/plain_text_frame_app.lua?raw";

const GEMINI_API_KEY = "AIzaSyCUspjopyRDqf8iR-ftL7UsPyaYfAt1p_M";

// 1) Estendi fetchGemini per supportare inlineData
async function fetchGemini(
  prompt: string,
  base64Image?: string
): Promise<string> {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    GEMINI_API_KEY;

  const parts: any[] = [];
  if (base64Image) {
    const data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data
      }
    });
  }
  parts.push({ text: prompt });

  const body = { contents: [{ parts }] };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Errore chiamando Gemini: ${res.status} – ${errText}`);
  }
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

export default function App() {
  const [frame, setFrame] = useState<FrameMsg | null>(null);
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const [status, setStatus] = useState("Pronto!");
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (m: string) =>
    setLogs((l) => [...l.slice(-19), m]);

  /** 1) Connessione + upload Lua unificato */
  const handleConnect = async () => {
    setStatus("Connessione in corso…");
    addLog("▶ handleConnect");
    try {
      const f = new FrameMsg();
      await f.connect();
      addLog("✔ connected");

      await f.uploadStdLuaLibs([
        StdLua.DataMin,
        StdLua.PlainTextMin,
        StdLua.CameraMin
      ]);
      addLog("✔ libs loaded");

      await f.uploadFrameApp(plainTextFrameApp);
      addLog("✔ Lua script uploaded");

      await f.startFrameApp();
      addLog("✔ app Lua running");

      setFrame(f);
      setStatus("Occhiali pronti!");
    } catch (e: any) {
      const msg = e.message || String(e);
      addLog("✖ handleConnect error: " + msg);
      setStatus("Errore connect: " + msg);
    }
  };

  /** 2) Cattura foto e preview */
  const handleCapture = async () => {
    if (!frame) {
      setStatus("Connetti prima gli occhiali!");
      return;
    }
    setStatus("Cattura foto…");
    addLog("▶ handleCapture");
    try {
      const rx = new RxPhoto({});
      const q = await rx.attach(frame);
      addLog("• RxPhoto attached");

      await frame.sendMessage(0x0d, new TxCaptureSettings(720).pack());
      addLog("• capture request sent");

      const jpeg = await q.get();
      addLog("✔ JPEG received");

      rx.detach(frame);
      addLog("• RxPhoto detached");

      const blob = new Blob([jpeg], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      setPhotoUrl(url);

      // Nascondi la preview fino a quando l'utente non preme Mostra Media
      setShowPhoto(false);
      setStatus("Foto catturata! (nascosta)");
    } catch (e: any) {
      const msg = e.message || String(e);
      addLog("✖ handleCapture error: " + msg);
      setStatus("Errore capture: " + msg);
    }
  };

  /** 3) Invio prompt + risposta sugli occhiali */
  const handleSend = async () => {
    setStatus("Preparazione richiesta a Gemini…");
    addLog("▶ handleSend");
    try {
      let base64Image: string | undefined;
      if (photoUrl) {
        addLog("• Preparo inlineData immagine");
        const resp = await fetch(photoUrl);
        const blob = await resp.blob();
        base64Image = await new Promise<string>((res) => {
          const reader = new FileReader();
          reader.onloadend = () => res(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }

      setStatus("Chiamata a Gemini (testo+immagine) …");
      const reply = await fetchGemini(prompt, base64Image);
      setResponse(reply);
      addLog("✔ Gemini reply ricevuta");

      if (frame) {
        setStatus("Invio testo a Frame…");
        await frame.sendMessage(0x0a, new TxPlainText(reply).pack());
        addLog("✔ testo inviato agli occhiali");
        setStatus("Risposta mostrata sugli occhiali!");
      }
    } catch (e: any) {
      const m = e.message || String(e);
      addLog("✖ handleSend error: " + m);
      setStatus("Errore send: " + m);
    }
  };

  /** 4) Pulisci schermo e disconnessione */
  const handleClear = async () => {
    if (!frame) return setStatus("Nessun occhiale");
    setStatus("Pulisco occhiali…");
    addLog("▶ handleClear");
    try {
      await frame.sendMessage(0x0a, new TxPlainText("").pack());
      addLog("✔ clear sent");
      setStatus("Schermo pulito");
    } catch (e: any) {
      const m = e.message || String(e);
      addLog("✖ handleClear error: " + m);
      setStatus("Errore clear");
    }
  };
  const handleDisconnect = async () => {
    if (!frame) return setStatus("Nessun occhiale");
    setStatus("Disconnessione…");
    addLog("▶ handleDisconnect");
    try {
      await frame.disconnect();
      addLog("✔ disconnected");
      setFrame(null);
      setStatus("Occhiali disconnessi");
    } catch (e: any) {
      const m = e.message || String(e);
      addLog("✖ handleDisconnect error: " + m);
      setStatus("Errore disconnect");
    }
  };
  
 // STYLE OBJECTS
  const styles = {
    container: {
      maxWidth: 600,
      margin: "0 auto",
      padding: 16,
      fontFamily: "'Helvetica Neue', Arial, sans-serif",
      color: "#1f2937",
    },
    header: {
      textAlign: "center" as const,
      fontSize: 24,
      marginBottom: 16,
      color: "#4f46e5",
    },
    controls: {
      display: "flex",
      flexWrap: "wrap" as const,
      gap: 8,
      justifyContent: "center" as const,
      marginBottom: 16,
    },
    btnPrimary: {
      flex: 1,
      minWidth: 120,
      padding: "12px 16px",
      backgroundColor: "#4f46e5",
      color: "#fff",
      border: "none",
      borderRadius: 8,
      fontSize: 16,
      cursor: "pointer",
      boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
    },
    btnSecondary: {
      flex: 1,
      minWidth: 120,
      padding: "12px 16px",
      backgroundColor: "#10b981",
      color: "#fff",
      border: "none",
      borderRadius: 8,
      fontSize: 16,
      cursor: "pointer",
      boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
    },
    btnDisabled: {
      opacity: 0.6,
      cursor: "not-allowed",
    },
    imageWrapper: {
      marginTop: 12,
      textAlign: "center" as const,
    },
    image: {
      width: "100%",
      borderRadius: 8,
      boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
    },
    textarea: {
      width: "100%",
      padding: 12,
      fontSize: 16,
      borderRadius: 8,
      border: "1px solid #d1d5db",
      resize: "vertical" as const,
      fontFamily: "inherit",
      marginBottom: 12,
    },
    sendButton: {
      width: "100%",
      padding: "12px 0",
      backgroundColor: "#4f46e5",
      color: "#fff",
      border: "none",
      borderRadius: 8,
      fontSize: 18,
      cursor: "pointer",
      boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
      marginBottom: 16,
    },
    status: {
      textAlign: "center" as const,
      color: "#6b7280",
      minHeight: 24,
      marginBottom: 8,
    },
    logs: {
      backgroundColor: "#f3f4f6",
      padding: 12,
      borderRadius: 8,
      fontSize: 14,
      color: "#374151",
      maxHeight: 120,
      overflowY: "auto" as const,
      marginBottom: 16,
    },
    response: {
      fontSize: 16,
      color: "#1f2937",
    },
    responsePre: {
      backgroundColor: "#f3f4f6",
      padding: 12,
      borderRadius: 8,
      border: "1px solid #d1d5db",
      whiteSpace: "pre-wrap" as const,
      marginTop: 4,
    },
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.header}>Gemini + Foto → Frame</h1>

      <div style={styles.controls}>
        <button
          onClick={handleConnect}
          style={{
            ...styles.btnSecondary,
            ...(frame ? {} : styles.btnDisabled),
          }}
          disabled={!true}
        >
          Connetti & Carica
        </button>

        <button
          onClick={handleCapture}
          disabled={!frame}
          style={{
            ...styles.btnPrimary,
            ...(frame ? {} : styles.btnDisabled),
          }}
        >
          📸 Cattura Foto
        </button>

        <button
          onClick={() => setShowPhoto((v) => !v)}
          disabled={!photoUrl}
          style={{
            ...styles.btnSecondary,
            ...(photoUrl ? {} : styles.btnDisabled),
          }}
        >
          {showPhoto ? "Nascondi Media" : "Mostra Media"}
        </button>

        <button
          onClick={handleClear}
          disabled={!frame}
          style={{
            ...styles.btnSecondary,
            ...(frame ? {} : styles.btnDisabled),
          }}
        >
          Pulisci Schermo
        </button>

        <button
          onClick={handleDisconnect}
          disabled={!frame}
          style={{
            ...styles.btnSecondary,
            ...(frame ? {} : styles.btnDisabled),
          }}
        >
          Disconnetti
        </button>
      </div>

      {photoUrl && showPhoto && (
        <div style={styles.imageWrapper}>
          <img src={photoUrl} alt="Preview" style={styles.image} />
        </div>
      )}

      <textarea
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Scrivi il prompt…"
        style={styles.textarea}
      />

      <button
        onClick={handleSend}
        disabled={!frame && !prompt}
        style={{
          ...styles.sendButton,
          ...((frame || prompt) ? {} : styles.btnDisabled),
        }}
      >
        Invia a Gemini &amp; Frame
      </button>

      <div style={styles.status}>
        <b>Stato:</b> {status}
      </div>

      <pre style={styles.logs}>{logs.join("\n")}</pre>

      <div style={styles.response}>
        <b>Risposta Gemini:</b>
        <pre style={styles.responsePre}>{response}</pre>
      </div>
    </div>
  );
}