import React, { useState } from "react";
import { FrameMsg, StdLua, TxPlainText } from "frame-msg";
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
  const [status, setStatus] = useState("Pronto!");
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => setLogs((l) => [...l, msg]);

  const handleConnect = async () => {
    setStatus("Connessione in corso…");
    addLog("▶ handleConnect start");
    try {
      addLog("• new FrameMsg()");
      const f = new FrameMsg();

      addLog("• connecting…");
      await f.connect();
      addLog("✔ connected");
      setStatus("Frame connesso, carico librerie…");

      addLog("• uploadStdLuaLibs");
      await f.uploadStdLuaLibs([StdLua.DataMin, StdLua.PlainTextMin]);
      addLog("✔ libs loaded");
      setStatus("Lib caricate, invio app Lua…");

      addLog("• uploadFrameApp");
      await f.uploadFrameApp(plainTextFrameApp);
      addLog("✔ Lua uploaded");
      setStatus("App Lua inviata, avvio…");

      addLog("• startFrameApp");
      await f.startFrameApp();
      addLog("✔ app running");
      setFrame(f);
      setStatus("Occhiali connessi e Lua caricata!");
    } catch (err: any) {
      const m = err?.message || String(err);
      addLog("✖ ERRORE connect: " + m);
      setStatus("Errore: " + m);
    }
  };

  const handleSend = async () => {
    setStatus("Richiesta a Gemini…");
    addLog("▶ handleSend start");
    try {
      const reply = await fetchGemini(prompt);
      setResponse(reply);
      addLog("✔ Gemini: " + reply.slice(0, 30) + "…");
      if (frame) {
        setStatus("Invio a Frame…");
        addLog("• sendMessage");
        const msg = new TxPlainText(reply);
        await frame.sendMessage(0x0a, msg.pack());
        addLog("✔ sent to Frame");
        setStatus("Risposta mostrata sugli occhiali!");
      } else {
        setStatus("Frame non connesso — risposta solo schermo");
      }
    } catch (err: any) {
      const m = err?.message || String(err);
      addLog("✖ ERRORE send: " + m);
      setStatus("Errore: " + m);
    }
  };

  const handleClear = async () => {
    if (!frame) {
      setStatus("Frame non connesso: niente da pulire");
      return;
    }
    setStatus("Pulizia schermo occhiali…");
    addLog("▶ handleClear start");
    try {
      const msg = new TxPlainText("");
      await frame.sendMessage(0x0a, msg.pack());
      addLog("✔ schermo pulito");
      setStatus("Schermo occhiali pulito!");
    } catch (err: any) {
      const m = err?.message || String(err);
      addLog("✖ ERRORE clear: " + m);
      setStatus("Errore clear: " + m);
    }
  };

  const handleDisconnect = async () => {
    if (!frame) {
      setStatus("Nessun frame da disconnettere");
      return;
    }
    setStatus("Disconnessione in corso…");
    addLog("▶ handleDisconnect start");
    try {
      await frame.disconnect();
      addLog("✔ disconnected");
      setFrame(null);
      setStatus("Occhiali disconnessi");
    } catch (err: any) {
      const m = err?.message || String(err);
      addLog("✖ ERRORE disconnect: " + m);
      setStatus("Errore disconnect: " + m);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: "auto", padding: 24 }}>
      <h1>Gemini → Frame</h1>

      <button onClick={handleConnect} style={{ marginRight: 8 }}>
        Connetti a Frame &amp; Carica Lua
      </button>
      <button onClick={handleClear} disabled={!frame} style={{ marginRight: 8 }}>
        Pulisci Schermo Occhiali
      </button>
      <button onClick={handleDisconnect} disabled={!frame}>
        Disconnetti Occhiali
      </button>

      <br />
      <textarea
        rows={3}
        style={{ width: "100%", marginTop: 12 }}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Scrivi qui il prompt per Gemini..."
      />
      <br />
      <button onClick={handleSend} style={{ marginTop: 12 }}>
        Invia Prompt a Gemini &amp; Frame
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