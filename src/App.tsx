import React, { useState, useEffect, useRef } from "react";
import {
  FrameMsg,
  StdLua,
  TxPlainText,
  TxCaptureSettings,
  TxTextSpriteBlock,
  TxSprite,
  RxPhoto,
} from "frame-msg";
import markinoFrameApp from "../lua/markino_frame_app.lua?raw";
import markinoFrameAppOPT from "../lua/frame_optimized.lua?raw";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import html2canvas from "html2canvas";
import leafletImage from "leaflet-image";

const GEMINI_API_KEY = "AIzaSyCUspjopyRDqf8iR-ftL7UsPyaYfAt1p_M";
const OSRM_URL = "https://router.project-osrm.org";

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
  // ───────── UI state ─────────
  const [frame, setFrame] = useState<FrameMsg | null>(null);
  const [frameOPT, setFrameOPT] = useState<FrameMsg | null>(null);
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [showMedia, setShowMedia] = useState(false);
  const [status, setStatus] = useState("Pronto!");
  const [logs, setLogs] = useState<string[]>([]);
  const [heading, setHeading] = useState(0);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  // per navigazione
  const [destInput, setDestInput] = useState({ lat: "", lng: "" });
  const [dest, setDest] = useState<{ lat: number; lng: number } | null>(null);
  const routeLayer = useRef<L.Polyline | null>(null);
  // aggiungi questo ref
  const poiLayer = useRef<L.LayerGroup | null>(null);

  // mappa Leaflet
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const autoUpdateRef = useRef<NodeJS.Timeout | null>(null);

  const poiList = [
    { name: "Bar", lat: 40.8367, lng: 16.5931 },
    { name: "Casa", lat: 40.8362, lng: 16.5925 },
  ];

  const addLog = (m: string) =>
    setLogs((l) => [...l.slice(-19), `${new Date().toLocaleTimeString()}: ${m}`]);

  // ───────── Compass listener ─────────
  useEffect(() => {
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.absolute && e.alpha != null) setHeading(e.alpha);
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, []);

  // ───────── Geolocation ─────────
  useEffect(() => {
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => { },
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // ───── Leaflet init & update ─────
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    // crea la mappa
    leafletMap.current = L.map(mapRef.current, {
      center: [40.8362, 16.5936],
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
    });

    // base layer
    // L.tileLayer(
    //   "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    //   { subdomains: "abcd", crossOrigin: true, attribution: "" }
    // ).addTo(leafletMap.current);

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
        subdomains: "abcd",
        crossOrigin: true,
        attribution: ""
      }
    ).addTo(leafletMap.current!);



    // qui creo il layer group *solo* per i POI
    poiLayer.current = L.layerGroup().addTo(leafletMap.current);
    poiList.forEach(({ lat, lng, name }) => {
      L.marker([lat, lng])
        .bindPopup(name)
        .addTo(poiLayer.current!);
    });
  }, []);
  useEffect(() => {
    if (!leafletMap.current || !pos) return;

    // 1) rimuovo solo i marker utente (CircleMarker) e la vecchia rotta (Polyline)
    leafletMap.current.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker) {
        leafletMap.current!.removeLayer(layer);
      }
    });
    if (routeLayer.current) {
      leafletMap.current.removeLayer(routeLayer.current);
      routeLayer.current = null;
    }

    // 2) ridisegno il marker utente
    L.circleMarker([pos.lat, pos.lng], {
      radius: 12,         // grandezza
      weight: 3,          // spessore bordo
      color: "#C80000",   // bordo rosso
      fillColor: "#FFD600", // centro giallo
      fillOpacity: 1      // pienamente opaco
    }).addTo(leafletMap.current!);


    // 3) se ho una destinazione, calcolo e disegno la rotta
    if (dest) {
      fetch(
        `${OSRM_URL}/route/v1/driving/` +
        `${pos.lng},${pos.lat};${dest.lng},${dest.lat}` +
        `?overview=full&geometries=geojson`
      )
        .then((r) => r.json())
        .then((js) => {
          const coords = js.routes[0].geometry.coordinates.map(
            ([lng, lat]: [number, number]) => [lat, lng] as [number, number]
          );
          routeLayer.current = L.polyline(coords, {
            color: "#00C8FF",
            weight: 10,
          }).addTo(leafletMap.current!);
        })
        .catch((e) => console.warn("OSRM error", e));
    }
  }, [pos, dest]);

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
  // ───────── Connect & start Frame ─────────
  const handleConnect = async () => {
    setStatus("Connessione in corso…");
    addLog("▶ handleConnect");
    try {
      const f = new FrameMsg();
      await f.connect();
      addLog("✔ connected");
      f.attachPrintResponseHandler((m) => addLog("[Frame] " + m));

      // stampo batt/memoria via REPL prima di partire col mio app.lua
      const battMem = await f.sendLua(
        'print(frame.battery_level() .. " / " .. collectgarbage("count"))',
        { awaitPrint: true }
      );
      addLog(`⚙️ Batt/Mem: ${battMem}`);

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
      await f.sendMessage(
        0x0a,
        new TxPlainText("BullVerge-Frame Connect", 1, 1, /*paletteOffset=*/9).pack()
      );
      await sleep(2000);
      await f.sendMessage(0x0a, new TxPlainText("", 1, 1, 1).pack());

    } catch (e: any) {
      addLog("✖ connect: " + e.message);
      setStatus("Errore connect: " + e.message);
    }
  };
  const handleConnectOPT = async () => {
    setStatus("Connessione in corso…");
    addLog("▶ handleConnect");
    try {
      const f = new FrameMsg();
      await f.connect();
      addLog("✔ connected");
      f.attachPrintResponseHandler((m) => addLog("[Frame] " + m));

      // stampo batt/memoria via REPL prima di partire col mio app.lua
      const battMem = await f.sendLua(
        'print(frame.battery_level() .. " / " .. collectgarbage("count"))',
        { awaitPrint: true }
      );
      addLog(`⚙️ Batt/Mem: ${battMem}`);

      await f.uploadStdLuaLibs([
        StdLua.DataMin,
        StdLua.PlainTextMin,
        StdLua.CameraMin,
        StdLua.SpriteMin,
        StdLua.TextSpriteBlockMin,
        StdLua.ImageSpriteBlockMin,
      ]);
      addLog("✔ libs loaded");
      await f.uploadFrameApp(markinoFrameAppOPT);
      addLog("✔ Lua script uploaded");
      await f.startFrameApp();
      setFrameOPT(f);
      setStatus("Occhiali pronti!");
      await f.sendMessage(
        0x0a,
        new TxPlainText("BullVerge-Frame OPT", 1, 1, /*paletteOffset=*/7).pack()
      );
      await sleep(2000);
      await f.sendMessage(0x0a, new TxPlainText("", 1, 1, 1).pack());

    } catch (e: any) {
      addLog("✖ connect: " + e.message);
      setStatus("Errore connect: " + e.message);
    }
  };
  // ───────── Snapshot Mappa ─────────
  const sendMapToFrame = async () => {
    if (!frame || !mapRef.current) {
      setStatus("Errore: init mappa o frame");
      return;
    }
    setStatus("📸 Snap mappa…");
    addLog("▶ sendMapToFrame");

    try {
      // catturo TUTTO quello che vedi nella <div ref={mapRef}>
      const canvas = await html2canvas(mapRef.current!, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#111827",  // match dark theme
        scale: 2                      // più risoluzione
      });

      // trasformo in blob → arrayBuffer → TxSprite
      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob(b => b ? res(b) : rej("toBlob fallito"), "image/jpeg", 0.9)
      );
      const arr = await blob.arrayBuffer();
      const sprite = await TxSprite.fromImageBytes(arr, 36000);

      await frame.sendMessage(0x20, sprite.pack());
      addLog("✔ mappa inviata");
      setStatus("Mappa mostrata!");
    } catch (e: any) {
      addLog("✖ map error: " + e);
      setStatus("Errore mappa");
    }
  };

  // ───────── Auto‐update ogni 5s ─────────
  const startAutoUpdate = () => {
    if (autoUpdateRef.current) return;
    autoUpdateRef.current = setInterval(sendMapToFrame, 5000);
    addLog("▶ Auto‐update ON");
  };
  const stopAutoUpdate = () => {
    if (autoUpdateRef.current) {
      clearInterval(autoUpdateRef.current);
      autoUpdateRef.current = null;
      addLog("■ Auto‐update OFF");
    }
  };

  // ───────── Setta destinazione ─────────
  const handleSetDest = () => {
    const lat = parseFloat(destInput.lat);
    const lng = parseFloat(destInput.lng);
    if (!isNaN(lat) && !isNaN(lng)) {
      setDest({ lat, lng });
      addLog(`▶ destinazione settata: ${lat.toFixed(5)},${lng.toFixed(5)}`);
    }
    setDestInput({ lat: "", lng: "" });
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

      const sprite = await TxSprite.fromImageBytes(imgBytes, 36000);
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

  const handleDashboard = async () => {
    if (!frame) return setStatus("Connetti prima");
    addLog("▶ showDashboard");

    // prepara i dati
    const now = new Date();
    const dateStr = now.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
    const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    let weatherStr = "n/d";
    if (pos) {
      const coordinates = `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
      weatherStr = `Coord: ${coordinates},\n`;
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lng}&current_weather=true`
        );
        const { current_weather: cw } = await res.json();
        weatherStr += `${cw.temperature}°C, vento ${cw.windspeed} km/h`;
      } catch { }
    }

    // calcola la distanza in km (se hai già `dest`)
    let distStr = "–";
    if (dest && pos) {
      const R = 6371e3;
      const φ1 = pos.lat * Math.PI / 180, φ2 = dest.lat * Math.PI / 180;
      const Δφ = (dest.lat - pos.lat) * Math.PI / 180;
      const Δλ = (dest.lng - pos.lng) * Math.PI / 180;
      const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
      const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      distStr = `${(d / 1000).toFixed(1)} km`;
    }

    // componi la dashboard
    // const dash = [
    //   `Mark - BullVerge: `,
    //   `${dateStr}|`,
    //   `${timeStr}|`,
    //   `${weatherStr}|`,
    //   `${distStr}`
    // ].join("\n");

    const dash = [
      `Mark-BullVerge: ${dateStr}, ${timeStr}, ${weatherStr}, ${distStr}`
    ].join("\n");

    // invia TUTTO in un solo TxPlainText, paletteOffset=1 (bianco)
    await frame.sendMessage(
      0x0a,
      new TxPlainText(dash, /* x= */1, /* y= */1, /* paletteOffset= */3).pack()
    );
    setStatus("Dashboard inviata");
  };

  const handleDashboardOPT = async () => {
    if (!frame) return setStatus("Connetti prima");
    addLog("▶ showDashboard");

    // prepara i dati
    const now = new Date();
    const dateStr = now.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
    const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    let weatherStr = "n/d";
    if (pos) {
      const coordinates = `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
      weatherStr = `Coord: ${coordinates},\n`;
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lng}&current_weather=true`
        );
        const { current_weather: cw } = await res.json();
        weatherStr += `${cw.temperature}°C, vento ${cw.windspeed} km/h`;
      } catch { }
    }

    // calcola la distanza in km (se hai già `dest`)
    let distStr = "–";
    if (dest && pos) {
      const R = 6371e3;
      const φ1 = pos.lat * Math.PI / 180, φ2 = dest.lat * Math.PI / 180;
      const Δφ = (dest.lat - pos.lat) * Math.PI / 180;
      const Δλ = (dest.lng - pos.lng) * Math.PI / 180;
      const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
      const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      distStr = `${(d / 1000).toFixed(1)} km`;
    }

    // componi il multilinea
    const dash = [
      `Mark - BullVerge: `,
      `${dateStr},`,
      `${timeStr},`,
      `${weatherStr},`,
      `${distStr}`
    ].join("\n");
    const tsb = new TxTextSpriteBlock({
      width: 500,
      fontSize: 28,
      maxDisplayRows: 5,
      text: dash
    });

    // invia prima header poi tutte le slice
    await frame.sendMessage(0x22, tsb.pack());

    for (const slice of tsb.sprites) {
      await frame.sendMessage(0x22, slice.pack());
    }
    setStatus("Dashboard inviata");
  };

  const btn = (st: any, dis = false) => ({ ...st, ...(dis ? styles.btnDisabled : {}) });

  return (
    <div style={styles.container}>
      <h1 style={styles.header}>Markino Solutions → Frame</h1>

      <div style={styles.controls}>
        <button onClick={handleConnect} style={btn(styles.btnSecondary, !!frame)}>🔌Connetti & Carica</button>
        <button onClick={handleConnectOPT} style={btn(styles.btnSecondary, !!frameOPT)}>🔌Connetti & Carica OPT</button>
        <button onClick={handleDashboard} disabled={!frame} style={btn(styles.btnSecondary, !frame)}>📊 Dashboard</button>
        <button onClick={handleDashboardOPT} disabled={!frameOPT} style={btn(styles.btnSecondary, !frameOPT)}>📊 Dashboard OPT</button>
        <button onClick={handleCapture} disabled={!frame} style={btn(styles.btnPrimary, !frame)}>📸 Cattura Foto</button>
        <button onClick={() => setShowMedia((v) => !v)} disabled={!photoUrl} style={btn(styles.btnSecondary, !photoUrl)}>
          {showMedia ? "Nascondi Media" : "Mostra Media"}
        </button>
        <button onClick={handleClear} disabled={!frame} style={btn(styles.btnSecondary, !frame)}>🧹 Pulisci Schermo</button>
        <div style={{ marginBottom: 8 }}>
          <button onClick={sendMapToFrame} disabled={!frame}>🗺️ Mostra Mappa</button>
          <button onClick={startAutoUpdate}>▶ Auto</button>
          <button onClick={stopAutoUpdate}>■ Stop</button>
        </div>

        <div style={{ marginBottom: 16, textAlign: "center" }}>
          <input
            style={styles.input}
            type="text"
            placeholder="lat"
            value={destInput.lat}
            onChange={(e) => setDestInput({ ...destInput, lat: e.target.value })}
          />
          <input
            style={styles.input}
            type="text"
            placeholder="lng"
            value={destInput.lng}
            onChange={(e) => setDestInput({ ...destInput, lng: e.target.value })}
          />
          <button onClick={handleSetDest} style={btn(styles.btnPrimary, !frame)} disabled={!frame}>
            📍 Avvia Navigazione
          </button>
        </div>

        <button onClick={handleDisconnect} disabled={!frame} style={btn(styles.btnSecondary, !frame)}>🔌Disconnetti</button>
        <button onClick={handleDisconnect} disabled={!frameOPT} style={btn(styles.btnSecondary, !frameOPT)}>🔌Disconnetti OPT</button>
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
      <div
        ref={mapRef}
        style={{
          width: "100%",
          height: 300,
          borderRadius: 8,
          overflow: "hidden",
          marginBottom: 16,
          boxShadow: "0 2px 6px rgba(0,0,0,.5)",
        }}
      />
    </div>
  );
}

/* ─────────────── Styles ─────────────── */
const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 650,
    margin: "0 auto",
    padding: 16,
    backgroundColor: "#111827",
    color: "#f3f4f6",
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
  },
  imageWrapper: {
    marginTop: 12,
    textAlign: "center",
    width: "100%",
    maxWidth: 300,      // mai più larga di 300px (regola a piacere)
    maxHeight: 300,     // mai più alta di 300px
    overflow: "hidden", // taglia l’eccesso
  },
  image: {
    width: "100%",      // scala sempre alla larghezza del wrapper
    height: "auto",     // conserva le proporzioni
    maxHeight: "100%",  // non superare l’altezza del wrapper
    objectFit: "contain", // “contieni” l’immagine dentro il box senza distorsioni
  },
  header: { textAlign: "center", fontSize: 24, marginBottom: 16, color: "#60a5fa" },
  controls: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    marginBottom: 16,
  },
  btnPrimary: {
    padding: "10px 14px",
    backgroundColor: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    flex: 1,
    minWidth: 120,
  },
  btnSecondary: {
    padding: "10px 14px",
    backgroundColor: "#059669",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    flex: 1,
    minWidth: 120,
  },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },
  map: { width: "100%", height: 300, borderRadius: 6, marginBottom: 16 },
  status: { textAlign: "center", marginBottom: 8, color: "#9ca3af" },
  logs: {
    backgroundColor: "#1f2937",
    padding: 12,
    borderRadius: 6,
    fontSize: 14,
    color: "#d1d5db",
    maxHeight: 120,
    overflowY: "auto",
    marginBottom: 16,
  },
  input: {
    width: 100,
    marginRight: 8,
    padding: 6,
    borderRadius: 4,
    border: "1px solid #374151",
    backgroundColor: "#1f2937",
    color: "#f3f4f6",
  },
};