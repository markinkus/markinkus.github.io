import { useState } from "react";
import { FrameMsg, StdLua, TxPlainText } from "frame-msg";
import plainTextFrameApp from "../lua/plain_text_frame_app.lua?raw";

const GEMINI_API_KEY = "INSERISCI-LA-TUA-GEMINI-API-KEY-QUI";

async function fetchGemini(prompt: string): Promise<string> {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
    GEMINI_API_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok) throw new Error("Errore chiamando Gemini");
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

  async function handleConnect() {
    setStatus("Connessione in corso...");
    const f = new FrameMsg();
    await f.connect();
    await f.uploadStdLuaLibs([StdLua.DataMin, StdLua.PlainTextMin]);
    await f.uploadFrameApp(plainTextFrameApp);
    await f.startFrameApp();
    setFrame(f);
    setStatus("Occhiali connessi e Lua caricata!");
  }

  async function handleSend() {
    setStatus("Invio a Gemini...");
    try {
      const reply = await fetchGemini(prompt);
      setResponse(reply);
      setStatus("Risposta Gemini ricevuta. Invio a Frame...");
      if (frame) {
        const msg = new TxPlainText(reply);
        await frame.sendMessage(0x0a, msg.pack());
        setStatus("Risposta mostrata sugli occhiali!");
      } else {
        setStatus("Errore: non connesso a Frame.");
      }
    } catch (err: any) {
      setStatus("Errore: " + err.message);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "auto", padding: 24 }}>
      <h1>Gemini → Frame</h1>
      <button onClick={handleConnect}>Connetti a Frame & Carica Lua</button>
      <br />
      <textarea
        rows={3}
        style={{ width: "100%" }}
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="Scrivi il prompt per Gemini..."
      />
      <br />
      <button onClick={handleSend} disabled={!frame}>
        Invia Prompt a Gemini & Frame
      </button>
      <div style={{ marginTop: 12, minHeight: 24 }}>Stato: {status}</div>
      <div style={{ marginTop: 24, fontSize: "0.9em", color: "#888" }}>
        <b>Risposta Gemini:</b>
        <div style={{ whiteSpace: "pre-line" }}>{response}</div>
      </div>
    </div>
  );
}
