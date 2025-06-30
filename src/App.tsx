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
async function fetchGemini(prompt: string): Promise<string> {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
    GEMINI_API_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error("Errore chiamando Gemini: " + res.status);
  const data = await res.json();
  try {
    return data.candidates[0].content.parts[0].text;
  } catch {
    return JSON.stringify(data);
  }
}

export default function App() {
  const [frame, setFrame] = useState<FrameMsg | null>(null);
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("Pronto!");
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (m: string) => setLogs(l => [...l, m]);

  /** 1) Connessione + upload Lua unificato */
  const handleConnect = async () => {
    setStatus("Connessione in corso…");
    addLog("▶ handleConnect");
    try {
      const f = new FrameMsg();
      addLog("• connecting…");
      await f.connect();
      addLog("✔ connected");

      setStatus("Carico librerie…");
      await f.uploadStdLuaLibs([
        StdLua.DataMin,
        StdLua.PlainTextMin,
        StdLua.CameraMin,    // aggiungi camera support
      ]);
      addLog("✔ libs loaded");

      setStatus("Upload app Lua…");
      await f.uploadFrameApp(plainTextFrameApp);
      addLog("✔ Lua script uploaded");

      setStatus("Avvio app Lua…");
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
      // Attacca il ricevitore foto
      const rx = new RxPhoto({});
      const q = await rx.attach(frame);
      addLog("• RxPhoto attached");

      // Manda la richiesta di cattura (msgCode 0x0d)
      await frame.sendMessage(
        0x0d,
        new TxCaptureSettings(720).pack()
      );
      addLog("• capture request sent");

      // Aspetta il JPEG
      const jpeg = await q.get();
      addLog("✔ JPEG received");

      rx.detach(frame);
      addLog("• RxPhoto detached");

      // Crea URL per preview
      const blob = new Blob([jpeg], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      setPhotoUrl(url);

      setStatus("Foto catturata!");
    } catch (e: any) {
      const msg = e.message || String(e);
      addLog("✖ handleCapture error: " + msg);
      setStatus("Errore capture: " + msg);
    }
  };

  /** 3) Invio prompt + risposta sugli occhiali */
  const handleSend = async () => {
    setStatus("Richiesta Gemini…");
    addLog("▶ handleSend");
    try {
      const reply = await fetchGemini(prompt);
      setResponse(reply);
      addLog("✔ Gemini reply: " + reply.slice(0, 30) + "…");

      if (frame) {
        setStatus("Invio testo a Frame…");
        const msg = new TxPlainText(reply);
        await frame.sendMessage(0x0a, msg.pack());
        addLog("✔ sent to Frame");
        setStatus("Testo mostrato sugli occhiali!");
      } else {
        setStatus("Frame non connesso");
      }
    } catch (e: any) {
      const msg = e.message || String(e);
      addLog("✖ handleSend error: " + msg);
      setStatus("Errore send: " + msg);
    }
  };

  /** 4) Pulisci schermo e disconnessione (già li hai) */
  const handleClear = async () => {
    if (!frame) return setStatus("Nessun occhiale");
    setStatus("Pulisco occhiali…");
    addLog("▶ handleClear");
    try {
      await frame.sendMessage(0x0a, new TxPlainText("").pack());
      addLog("✔ clear sent");
      setStatus("Schermo pulito");
    } catch (e: any) {
      const msg = e.message || String(e);
      addLog("✖ handleClear error: " + msg);
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
      const msg = e.message || String(e);
      addLog("✖ handleDisconnect error: " + msg);
      setStatus("Errore disconnect");
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "auto", padding: 24 }}>
      <h1>Gemini + Foto → Frame</h1>

      <button onClick={handleConnect} style={{ marginRight: 8 }}>
        Connetti &amp; Carica Lua
      </button>
      <button
        onClick={handleCapture}
        disabled={!frame}
        style={{ marginRight: 8 }}
      >
        Cattura Foto
      </button>
      <button
        onClick={handleClear}
        disabled={!frame}
        style={{ marginRight: 8 }}
      >
        Pulisci Schermo
      </button>
      <button onClick={handleDisconnect} disabled={!frame}>
        Disconnetti
      </button>

      {photoUrl && (
        <img
          src={photoUrl}
          alt="Preview"
          style={{
            width: "100%",
            marginTop: 12,
            border: "1px solid #ccc",
            borderRadius: 8,
          }}
        />
      )}

      <textarea
        rows={3}
        style={{ width: "100%", marginTop: 12 }}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Scrivi il prompt…"
      />

      <button onClick={handleSend} style={{ marginTop: 12 }}>
        Invia a Gemini &amp; Frame
      </button>

      <div style={{ marginTop: 12, minHeight: 24 }}>
        <b>Stato:</b> {status}
      </div>

      <pre
        style={{
          marginTop: 8,
          padding: 8,
          background: "#f0f0f0",
          maxHeight: 120,
          overflowY: "auto",
          fontSize: "0.8em",
        }}
      >
        {logs.join("\n")}
      </pre>

      <div style={{ marginTop: 24, fontSize: "0.9em", color: "#333" }}>
        <b>Risposta Gemini:</b>
        <pre style={{ whiteSpace: "pre-wrap" }}>{response}</pre>
      </div>
    </div>
  );
}