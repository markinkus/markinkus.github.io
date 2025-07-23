import React, { useState, useEffect, useRef } from "react";
import {
  FrameMsg,
  StdLua,
  TxPlainText,
  TxCaptureSettings,
  TxSprite,
  RxPhoto,
} from "frame-msg";
import markinoFrameApp from "../lua/markino_frame_app.lua?raw";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import html2canvas from "html2canvas";

const GEMINI_API_KEY = "AIzaSyCUspjopyRDqf8iR-ftL7UsPyaYfAt1p_M";

/* ─────────────────────────── Helpers ─────────────────────────── */
const blobUrl = (bytes: ArrayBuffer | Uint8Array, mime = "image/jpeg") =>
  URL.createObjectURL(new Blob([bytes], { type: mime }));

async function fetchGemini(prompt: string, base64Image?: string): Promise<string> {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    GEMINI_API_KEY;
  const parts: any[] = [];
  if (base64Image) {
    const data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    parts.push({ inline_data: { mime_type: "image/jpeg", data } });
  }
  parts.push({ text: prompt });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!res.ok) {
    throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.candidates[0].content.parts[0].text as string;
}

export default function App() {
  /* ─────────────── UI state ─────────────── */
  const [frame, setFrame] = useState<FrameMsg | null>(null);
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null); // originale
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null); // quantizzato PNG
  const [showMedia, setShowMedia] = useState(false);
  const [status, setStatus] = useState("Pronto!");
  const [logs, setLogs] = useState<string[]>([]);
  const [heading, setHeading] = useState(0);
  const [mapLoading, setMapLoading] = useState(false);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const autoUpdateRef = useRef<NodeJS.Timeout | null>(null);

  const poiList = [
    { name: "Bar", lat: 40.8367, lng: 16.5931 },
    { name: "Casa", lat: 40.8362, lng: 16.5925 },
  ];

  const addLog = (m: string) => setLogs((l) => [...l.slice(-19), m]);

  /* ─────────────── Compass listener ─────────────── */
  useEffect(() => {
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.absolute && e.alpha != null) setHeading(e.alpha);
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, []);

  useEffect(() => {
    const geoId = navigator.geolocation.watchPosition((p) => {
      setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
    });
    return () => navigator.geolocation.clearWatch(geoId);
  }, []);
  useEffect(() => {
    if (mapRef.current && !leafletMap.current) {
      leafletMap.current = L.map(mapRef.current, {
        center: [40.8362, 16.5936],
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        crossOrigin: true,
      }).addTo(leafletMap.current);
    }
    if (leafletMap.current && pos) {
      leafletMap.current.setView([pos.lat, pos.lng]);
    }
  }, [pos]);
  /* ─────────────── Connect & init ─────────────── */
  const handleConnect = async () => {
    setStatus("Connessione in corso…");
    addLog("▶ handleConnect");
    try {
      const f = new FrameMsg();
      await f.connect();
      addLog("✔ connected");

      f.attachPrintResponseHandler((m) => addLog("[Frame] " + m));

      await f.uploadStdLuaLibs([
        StdLua.DataMin,
        StdLua.PlainTextMin,
        StdLua.CameraMin,
        StdLua.SpriteMin,
      ]);
      addLog("✔ libs loaded");

      await f.uploadFrameApp(markinoFrameApp);
      addLog("✔ Lua script uploaded");
      await f.startFrameApp();

      setFrame(f);
      setStatus("Occhiali pronti!");
    } catch (e: any) {
      addLog("✖ connect: " + e.message);
      setStatus("Errore connect: " + e.message);
    }
  };

  /* ─────────────── Capture photo (unchanged) ─────────────── */
  const handleCapture = async () => {
    if (!frame) return setStatus("Connetti prima gli occhiali!");
    setStatus("Cattura foto…");
    addLog("▶ handleCapture");
    try {
      const rx = new RxPhoto({});
      const q = await rx.attach(frame);
      await frame.sendMessage(0x0d, new TxCaptureSettings(720).pack());
      const jpeg = await q.get();
      rx.detach(frame);
      const url = blobUrl(jpeg);
      setPhotoUrl(url);
      setSpriteUrl(null);
      setShowMedia(false);
      setStatus("Foto catturata (nascosta)");
    } catch (e: any) {
      addLog("✖ capture: " + e.message);
      setStatus("Errore capture: " + e.message);
    }
  };

  /* ─────────────── Pollinations → Sprite ─────────────── */
  const handleGenerateImage = async () => {
    if (!frame) return setStatus("Connetti prima gli occhiali!");
    setStatus("Generazione immagine…");
    addLog("▶ handleGenerateImage");
    try {
      const pollUrl =
        `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt || "abstract art")}`;
      const resp = await fetch(pollUrl);
      const imgBytes = await resp.arrayBuffer();

      // preview originale
      const origUrl = blobUrl(imgBytes);
      setPhotoUrl(origUrl);
      setShowMedia(true);

      const sprite = await TxSprite.fromImageBytes(imgBytes, 20_000);
      // toPngBytes non è tipizzato nelle declarations → cast any
      const pngBytes: Uint8Array | undefined = (sprite as any).toPngBytes?.();
      if (pngBytes) setSpriteUrl(blobUrl(pngBytes, "image/png"));

      await frame.sendMessage(0x20, sprite.pack());
      addLog("✔ sprite inviato agli occhiali");
      setStatus("Immagine Pollinations mostrata!");
    } catch (e: any) {
      addLog("✖ generateImage: " + e.message);
      setStatus("Errore generazione immagine: " + e.message);
    }
  };

  /* ─────────────── Gemini prompt (unchanged) ─────────────── */
  const handleSend = async () => {
    setStatus("Preparazione richiesta a Gemini…");
    addLog("▶ handleSend");
    try {
      let base64Image: string | undefined;
      if (photoUrl) {
        const resp = await fetch(photoUrl);
        const b = await resp.blob();
        base64Image = await new Promise<string>((res) => {
          const rd = new FileReader();
          rd.onloadend = () => res(rd.result as string);
          rd.readAsDataURL(b);
        });
      }
      const reply = await fetchGemini(prompt, base64Image);
      setResponse(reply);
      addLog("✔ Gemini reply");
      if (frame) {
        await frame.sendMessage(0x0a, new TxPlainText(reply).pack());
        setStatus("Risposta mostrata sugli occhiali!");
      }
    } catch (e: any) {
      addLog("✖ handleSend: " + e.message);
      setStatus("Errore Gemini: " + e.message);
    }
  };

  /* ─────────────── Clear & Disconnect ─────────────── */
  const handleClear = async () => {
    if (!frame) return;
    await frame.sendMessage(0x0a, new TxPlainText("").pack());
    setStatus("Schermo pulito");
  };
  const handleDisconnect = async () => {
    if (!frame) return;
    try {
      await frame.stopFrameApp();
      await frame.disconnect();
      setFrame(null);
      setStatus("Disconnesso");
    } catch (e: any) {
      setStatus("Errore disconnect: " + e.message);
    }
  };
  /* ─────────────── MiniMap ─────────────── */
  const sendMapToFrame = async () => {
    if (!frame) return setStatus("Connetti prima gli occhiali!");
    if (!mapRef.current) return setStatus("Mappa non trovata");

    setStatus("Generazione snapshot mappa…");
    addLog("▶ sendMapToFrame");

    try {
      console.log("mapRef current size:", mapRef.current?.offsetWidth, mapRef.current?.offsetHeight);
      const canvas = await html2canvas(mapRef.current, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        logging: true
      });

      // sicurezza: aspetta 100ms per garantire rendering
      await new Promise((res) => setTimeout(res, 100));

      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("toBlob fallito: canvas è nullo"));
        }, "image/jpeg", 0.9);
      });

      const sprite = await TxSprite.fromImageBytes(
        await blob.arrayBuffer(),
        25000
      );

      await frame.sendMessage(0x20, sprite.pack());
      addLog("✔ snapshot mappa inviata");
      setStatus("Mappa mostrata sugli occhiali!");
    } catch (e: any) {
      addLog("✖ map error: " + e.message);
      setStatus("Errore mappa: " + e.message);
    }
  };


  const startAutoUpdate = () => {
    if (autoUpdateRef.current) return;
    autoUpdateRef.current = setInterval(sendMapToFrame, 5000);
    addLog("▶ Auto-update ON");
  };

  const stopAutoUpdate = () => {
    if (autoUpdateRef.current) {
      clearInterval(autoUpdateRef.current);
      autoUpdateRef.current = null;
      addLog("■ Auto-update OFF");
    }
  };


  const btn = (st: any, dis = false) => ({ ...st, ...(dis ? styles.btnDisabled : {}) });

  return (
    <div style={styles.container}>
      <h1 style={styles.header}>Gemini • Pollinations → Frame</h1>

      <div style={styles.controls}>
        <button onClick={handleConnect} style={btn(styles.btnSecondary, !!frame)}>Connetti & Carica</button>
        <button onClick={handleCapture} disabled={!frame} style={btn(styles.btnPrimary, !frame)}>📸 Cattura Foto</button>
        <button onClick={() => setShowMedia((v) => !v)} disabled={!photoUrl} style={btn(styles.btnSecondary, !photoUrl)}>
          {showMedia ? "Nascondi Media" : "Mostra Media"}
        </button>
        <button onClick={handleClear} disabled={!frame} style={btn(styles.btnSecondary, !frame)}>Pulisci Schermo</button>
        <div style={{ marginBottom: 8 }}>
          <button onClick={handleConnect}>🔌 Connetti</button>
          <button onClick={sendMapToFrame} disabled={!frame}>🗺️ Mostra Mappa</button>
          <button onClick={startAutoUpdate}>▶ Auto</button>
          <button onClick={stopAutoUpdate}>■ Stop</button>
        </div>
        <div
          id="map"
          ref={mapRef}
          style={{
            width: 240,
            height: 240,
            position: "absolute",
            top: "-10000px",
            left: "-10000px",
            opacity: 0,
            pointerEvents: "none",
            zIndex: -999,
          }}
        ></div>

        <button onClick={handleDisconnect} disabled={!frame} style={btn(styles.btnSecondary, !frame)}>Disconnetti</button>
        <button onClick={handleGenerateImage} disabled={!frame || !prompt} style={btn(styles.btnPrimary, !frame || !prompt)}>🎨 Genera Immagine</button>
      </div>

      {showMedia && photoUrl && (
        <div style={styles.imageWrapper}>
          <h4>Originale Pollinations</h4>
          <img src={photoUrl} alt="original" style={styles.image} />
        </div>
      )}
      {showMedia && spriteUrl && (
        <div style={styles.imageWrapper}>
          <h4>Sprite Quantizzato</h4>
          <img src={spriteUrl} alt="sprite" style={styles.image} />
        </div>
      )}

      <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Prompt…" style={styles.textarea} />
      <button onClick={handleSend} disabled={!frame && !prompt} style={btn(styles.sendButton, !frame && !prompt)}>Invia a Gemini & Frame</button>

      <div style={styles.status}><b>Stato:</b> {status}</div>
      <pre style={styles.logs}>{logs.join("\n")}</pre>
      <div style={styles.response}>
        <b>Risposta Gemini:</b>
        <pre style={styles.responsePre}>{response}</pre>
      </div>
    </div>
  );
}

/* ─────────────── Styles ─────────────── */
const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 650, margin: "0 auto", padding: 16, fontFamily: "'Helvetica Neue', Arial", color: "#1f2937" },
  header: { textAlign: "center", fontSize: 24, marginBottom: 16, color: "#4f46e5" },
  controls: { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 16 },
  btnPrimary: { flex: 1, minWidth: 120, padding: "12px 16px", backgroundColor: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, fontSize: 16, cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,.1)" },
  btnSecondary: { flex: 1, minWidth: 120, padding: "12px 16px", backgroundColor: "#10b981", color: "#fff", border: "none", borderRadius: 8, fontSize: 16, cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,.1)" },
  btnDisabled: { opacity: 0.6, cursor: "not-allowed" },
  imageWrapper: { marginTop: 12, textAlign: "center" },
  image: { width: "100%", borderRadius: 8, boxShadow: "0 2px 6px rgba(0,0,0,.1)" },
  textarea: { width: "100%", padding: 12, fontSize: 16, borderRadius: 8, border: "1px solid #d1d5db", resize: "vertical", fontFamily: "inherit", marginBottom: 12 },
  sendButton: { width: "100%", padding: "12px 0", backgroundColor: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, fontSize: 18, cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,.1)", marginBottom: 16 },
  status: { textAlign: "center", color: "#6b7280", minHeight: 24, marginBottom: 8 },
  logs: { backgroundColor: "#f3f4f6", padding: 12, borderRadius: 8, fontSize: 14, color: "#374151", maxHeight: 120, overflowY: "auto", marginBottom: 16 },
  response: { fontSize: 16, color: "#1f2937" },
  responsePre: { backgroundColor: "#f3f4f6", padding: 12, borderRadius: 8, border: "1px solid #d1d5db", whiteSpace: "pre-wrap", marginTop: 4 },
};
