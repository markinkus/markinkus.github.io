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
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import html2canvas from "html2canvas";
import leafletImage from "leaflet-image";

const DEFAULT_GEMINI_API_KEY =
  import.meta.env.VITE_GEMINI_API_KEY?.trim() || "";
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL?.trim() || "gemini-2.5-flash";
const OSRM_URL = "https://router.project-osrm.org";
const DEFAULT_CENTER = { lat: 40.8362, lng: 16.5936 };
const ROUTE_DEBOUNCE_MS = 700;

type LatLngPoint = { lat: number; lng: number };
type GpsStatus = "checking" | "watching" | "unavailable" | "denied" | "error";
type RouteSummary = {
  distanceMeters: number;
  durationSeconds: number;
};

const blobUrl = (bytes: ArrayBuffer | Uint8Array, mime = "image/jpeg") =>
  URL.createObjectURL(new Blob([bytes], { type: mime }));

const formatCoord = (value: number) => value.toFixed(5);

const formatDistance = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;

const formatDuration = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes} min`;
};

const parseCoordinate = (value: string) => {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const isValidLatLng = (point: LatLngPoint) =>
  point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180;

async function fetchGemini(
  prompt: string,
  apiKey: string,
  base64Image?: string,
): Promise<string> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error("Inserisci una Gemini API key.");
  }

  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_MODEL,
    )}:generateContent`,
  );
  url.searchParams.set("key", cleanKey);

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
  const [geminiApiKey, setGeminiApiKey] = useState(DEFAULT_GEMINI_API_KEY);
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [showMedia, setShowMedia] = useState(false);
  const [status, setStatus] = useState("Pronto!");
  const [logs, setLogs] = useState<string[]>([]);
  const [heading, setHeading] = useState(0);
  const [pos, setPos] = useState<LatLngPoint | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("checking");
  const [gpsError, setGpsError] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [followGps, setFollowGps] = useState(true);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [destInput, setDestInput] = useState({ lat: "", lng: "" });
  const [dest, setDest] = useState<LatLngPoint | null>(null);
  const routeLayer = useRef<L.Polyline | null>(null);
  const userMarkerLayer = useRef<L.CircleMarker | null>(null);
  const accuracyLayer = useRef<L.Circle | null>(null);
  const poiLayer = useRef<L.LayerGroup | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const autoUpdateRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const lastRouteKeyRef = useRef<string | null>(null);

  const poiList = [
    { name: "Bar", lat: 40.8367, lng: 16.5931 },
    { name: "Casa", lat: 40.8362, lng: 16.5925 },
  ];

  const addLog = (m: string) =>
    setLogs((l) => [...l.slice(-19), `${new Date().toLocaleTimeString()}: ${m}`]);

  const destinationFromInput = (): LatLngPoint | null => {
    const lat = parseCoordinate(destInput.lat);
    const lng = parseCoordinate(destInput.lng);
    if (lat === null || lng === null) return null;
    const point = { lat, lng };
    return isValidLatLng(point) ? point : null;
  };

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
    if (!("geolocation" in navigator)) {
      setGpsStatus("unavailable");
      setGpsError("GPS non disponibile in questo browser.");
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGpsStatus("watching");
        setGpsError("");
        setAccuracy(Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null);
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (error) => {
        setGpsStatus(error.code === error.PERMISSION_DENIED ? "denied" : "error");
        setGpsError(error.message || "Impossibile leggere la posizione GPS.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2500,
        timeout: 15000,
      }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // ───── Leaflet init & update ─────
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    const map = L.map(mapRef.current, {
      center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
      zoom: 16,
      zoomControl: true,
      attributionControl: false,
      preferCanvas: true,
    });
    leafletMap.current = map;

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      {
        subdomains: "abcd",
        crossOrigin: "anonymous",
        attribution: "",
      }
    ).addTo(map);

    poiLayer.current = L.layerGroup().addTo(map);
    poiList.forEach(({ lat, lng, name }) => {
      L.circleMarker([lat, lng], {
        radius: 7,
        color: "#0f766e",
        fillColor: "#14b8a6",
        fillOpacity: 0.9,
        weight: 2,
      })
        .bindTooltip(name)
        .addTo(poiLayer.current!);
    });

    map.on("click", (event: L.LeafletMouseEvent) => {
      const point = { lat: event.latlng.lat, lng: event.latlng.lng };
      setDest(point);
      setDestInput({
        lat: formatCoord(point.lat),
        lng: formatCoord(point.lng),
      });
      setFollowGps(false);
      setStatus("Destinazione impostata dalla mappa.");
    });

    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      routeAbortRef.current?.abort();
      map.remove();
      leafletMap.current = null;
      poiLayer.current = null;
      routeLayer.current = null;
      userMarkerLayer.current = null;
      accuracyLayer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!leafletMap.current || !pos) return;

    const map = leafletMap.current;
    const latLng = L.latLng(pos.lat, pos.lng);

    if (!accuracyLayer.current) {
      accuracyLayer.current = L.circle(latLng, {
        radius: accuracy ?? 0,
        color: "#2563eb",
        fillColor: "#60a5fa",
        fillOpacity: 0.12,
        weight: 1,
      }).addTo(map);
    } else {
      accuracyLayer.current.setLatLng(latLng);
      accuracyLayer.current.setRadius(accuracy ?? 0);
    }

    if (!userMarkerLayer.current) {
      userMarkerLayer.current = L.circleMarker(latLng, {
        radius: 12,
        weight: 3,
        color: "#C80000",
        fillColor: "#FFD600",
        fillOpacity: 1,
      }).addTo(map);
    } else {
      userMarkerLayer.current.setLatLng(latLng);
    }

    if (followGps) {
      map.setView(latLng, Math.max(map.getZoom(), 16), { animate: false });
    }
  }, [accuracy, followGps, pos]);

  useEffect(() => {
    const map = leafletMap.current;

    if (!map || !pos || !dest) {
      routeAbortRef.current?.abort();
      lastRouteKeyRef.current = null;

      if (routeLayer.current && map) {
        routeLayer.current.removeFrom(map);
        routeLayer.current = null;
      }

      setRouteSummary(null);
      setIsRouting(false);
      return;
    }

    const routeKey = [
      pos.lat.toFixed(4),
      pos.lng.toFixed(4),
      dest.lat.toFixed(5),
      dest.lng.toFixed(5),
    ].join(",");

    if (lastRouteKeyRef.current === routeKey && routeLayer.current) {
      setIsRouting(false);
      return;
    }

    routeAbortRef.current?.abort();

    if (routeLayer.current) {
      routeLayer.current.removeFrom(map);
      routeLayer.current = null;
    }

    setRouteSummary(null);
    lastRouteKeyRef.current = routeKey;

    const controller = new AbortController();
    routeAbortRef.current = controller;
    setIsRouting(true);

    const url =
      `${OSRM_URL}/route/v1/driving/` +
      `${pos.lng},${pos.lat};${dest.lng},${dest.lat}` +
      `?overview=full&geometries=geojson&steps=false`;

    const routeTimer = window.setTimeout(() => {
      fetch(url, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`OSRM HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((payload) => {
          if (controller.signal.aborted) return;

          const route = payload.routes?.[0];
          const coordinates = route?.geometry?.coordinates;

          if (!route || !Array.isArray(coordinates) || coordinates.length === 0) {
            throw new Error("Nessuna rotta trovata.");
          }

          const latLngs = coordinates.map(
            ([lng, lat]: [number, number]) => [lat, lng] as [number, number],
          );

          routeLayer.current = L.polyline(latLngs, {
            color: "#00C8FF",
            weight: 8,
            opacity: 0.9,
          }).addTo(map);

          setRouteSummary({
            distanceMeters: route.distance,
            durationSeconds: route.duration,
          });

          map.fitBounds(routeLayer.current.getBounds().pad(0.18), {
            animate: false,
          });
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          lastRouteKeyRef.current = null;
          console.warn("OSRM error", error);
          setStatus("Errore rotta GPS: " + (error?.message || String(error)));
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsRouting(false);
            routeAbortRef.current = null;
          }
        });
    }, ROUTE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(routeTimer);
      controller.abort();
    };
  }, [dest, pos]);

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  const mapToCanvas = async () => {
    if (!mapRef.current || !leafletMap.current) {
      throw new Error("Mappa non inizializzata.");
    }

    leafletMap.current.invalidateSize();
    await sleep(250);

    try {
      return await new Promise<HTMLCanvasElement>((resolve, reject) => {
        leafletImage(leafletMap.current!, (err, canvas) => {
          if (err) reject(err);
          else resolve(canvas);
        });
      });
    } catch (error) {
      console.warn("leaflet-image fallback", error);
      return html2canvas(mapRef.current, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#f8fafc",
        scale: 2,
      });
    }
  };

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
        StdLua.ImageSpriteBlockMin,
        StdLua.TextSpriteBlockMin,
      ]);
      addLog("✔ libs loaded");
      await f.uploadFrameApp(markinoFrameApp);
      addLog("✔ Lua script uploaded");
      await f.startFrameApp();
      setFrame(f);
      setStatus("Occhiali pronti!");
      await f.sendMessage(
        0x0a,
        new TxPlainText({
          text: "BullVerge-Frame Connect",
          x: 1,
          y: 1,
          paletteOffset: 9,
        }).pack()
      );
      await sleep(2000);
      await f.sendMessage(0x0a, new TxPlainText({ text: "", x: 1, y: 1, paletteOffset: 1 }).pack());

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
      const canvas = await mapToCanvas();

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
    if (!frame) {
      setStatus("Connetti prima il Frame per usare Auto mappa.");
      return;
    }
    if (autoUpdateRef.current) return;
    void sendMapToFrame();
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

  useEffect(() => stopAutoUpdate, []);

  // ───────── Setta destinazione ─────────
  const handleSetDest = () => {
    const point = destinationFromInput();
    if (!point) {
      setStatus("Coordinate destinazione non valide.");
      return;
    }
    setDest(point);
    setFollowGps(false);
    addLog(`▶ destinazione settata: ${formatCoord(point.lat)},${formatCoord(point.lng)}`);
  };

  const centerOnGps = () => {
    if (!pos || !leafletMap.current) {
      setStatus("GPS non ancora disponibile.");
      return;
    }

    setFollowGps(true);
    leafletMap.current.setView([pos.lat, pos.lng], Math.max(leafletMap.current.getZoom(), 16), {
      animate: false,
    });
  };

  const clearRoute = () => {
    routeAbortRef.current?.abort();
    if (routeLayer.current && leafletMap.current) {
      routeLayer.current.removeFrom(leafletMap.current);
      routeLayer.current = null;
    }
    setDest(null);
    setDestInput({ lat: "", lng: "" });
    setRouteSummary(null);
    setStatus("Rotta cancellata.");
  };

  /* ─────────────── Capture photo (unchanged) ─────────────── */
  const handleCapture = async () => {
    if (!frame) return setStatus("Connetti prima gli occhiali!");
    setStatus("Cattura foto…");
    addLog("▶ handleCapture");
    try {
      const rx = new RxPhoto({});
      const q = await rx.attach(frame);
      await frame.sendMessage(0x0d, new TxCaptureSettings({ resolution: 720 }).pack());
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
      const pngBytes = sprite.toPngBytes();
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
      const reply = await fetchGemini(prompt, geminiApiKey, base64Image);
      setResponse(reply);
      addLog("✔ Gemini reply");
      if (frame) {
        await frame.sendMessage(0x0a, new TxPlainText({ text: reply }).pack());
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
    addLog("▶ clearFrame");
    await frame.sendMessage(0x0a, new TxPlainText({ text: "" }).pack());
    setStatus("Schermo pulito");
  };

  const handleDisconnect = async () => {
    if (!frame) return;
    try {
      addLog("▶ disconnectFrame");
      stopAutoUpdate();
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

    // componi il multilinea
    const dash = [
      `Mark - BullVerge: `,
      `${dateStr},`,
      `${timeStr},`,
      `${weatherStr},`,
      `${distStr}`
    ].join("\n");
    const tsb = new TxTextSpriteBlock({
      width: 600,
      fontSize: 30,
      maxDisplayRows: 7,
      text: dash,
    });

    // invia prima header poi tutte le slice
    await frame.sendMessage(0x22, tsb.pack());

    for (const slice of tsb.sprites) {
      await frame.sendMessage(0x22, slice.pack());
    }
    setStatus("Dashboard inviata");
  };

  const btn = (st: any, dis = false) => ({ ...st, ...(dis ? styles.btnDisabled : {}) });
  const destinationPoint = destinationFromInput();
  const gpsLabel =
    gpsStatus === "watching" && pos
      ? `${formatCoord(pos.lat)}, ${formatCoord(pos.lng)}`
      : gpsStatus === "checking"
        ? "Ricerca GPS..."
        : gpsError || "GPS non disponibile";
  const routeLabel = (() => {
    if (routeSummary) {
      return `${formatDistance(routeSummary.distanceMeters)} / ${formatDuration(routeSummary.durationSeconds)}`;
    }
    if (isRouting) return "Calcolo rotta...";
    if (dest && !pos) return "In attesa GPS";
    if (dest) return "Rotta non disponibile";
    return "Nessuna destinazione";
  })();
  const destLabel = dest
    ? `${formatCoord(dest.lat)}, ${formatCoord(dest.lng)}`
    : "Click sulla mappa o inserisci coordinate";

  return (
    <div style={styles.container}>
      <h1 style={styles.header}>Markino Solutions → Frame</h1>

      <div style={styles.controls}>
        <button onClick={handleConnect} style={btn(styles.btnSecondary, !!frame)}>Connetti e carica</button>
        <button onClick={handleDashboard} disabled={!frame} style={btn(styles.btnSecondary, !frame)}>Dashboard</button>
        <button onClick={handleCapture} disabled={!frame} style={btn(styles.btnPrimary, !frame)}>Cattura foto</button>
        <button onClick={() => setShowMedia((v) => !v)} disabled={!photoUrl} style={btn(styles.btnSecondary, !photoUrl)}>
          {showMedia ? "Nascondi Media" : "Mostra Media"}
        </button>
        <button onClick={handleClear} disabled={!frame} style={btn(styles.btnSecondary, !frame)}>Pulisci schermo</button>
        <div style={{ marginBottom: 8 }}>
          <button onClick={sendMapToFrame} disabled={!frame} style={btn(styles.btnSmall, !frame)}>Invia mappa</button>
          <button onClick={startAutoUpdate} disabled={!frame} style={btn(styles.btnSmall, !frame)}>Auto</button>
          <button onClick={stopAutoUpdate} style={styles.btnSmall}>Stop</button>
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
          <button onClick={handleSetDest} style={btn(styles.btnPrimary, !destinationPoint)} disabled={!destinationPoint}>
            Avvia navigazione
          </button>
        </div>

        <button onClick={handleDisconnect} disabled={!frame} style={btn(styles.btnSecondary, !frame)}>Disconnetti</button>
        <button onClick={handleGenerateImage} disabled={!frame || !prompt} style={btn(styles.btnPrimary, !frame || !prompt)}>Genera immagine</button>
      </div>

      <section style={styles.mapPanel}>
        <div style={styles.mapStats}>
          <div style={styles.statBox}>
            <span style={styles.statLabel}>GPS</span>
            <strong style={styles.statValue}>{gpsLabel}</strong>
          </div>
          <div style={styles.statBox}>
            <span style={styles.statLabel}>Accuratezza</span>
            <strong style={styles.statValue}>
              {accuracy !== null ? `${Math.round(accuracy)} m` : "n/d"}
            </strong>
          </div>
          <div style={styles.statBox}>
            <span style={styles.statLabel}>Destinazione</span>
            <strong style={styles.statValue}>{destLabel}</strong>
          </div>
          <div style={styles.statBox}>
            <span style={styles.statLabel}>Rotta</span>
            <strong style={styles.statValue}>{routeLabel}</strong>
          </div>
          <div style={styles.statBox}>
            <span style={styles.statLabel}>Bussola</span>
            <strong style={styles.statValue}>{Math.round(heading)}°</strong>
          </div>
        </div>
        <div style={styles.mapActions}>
          <button onClick={centerOnGps} disabled={!pos} style={btn(styles.btnSmall, !pos)}>Centra GPS</button>
          <button onClick={() => setFollowGps((value) => !value)} style={styles.btnSmall}>
            Follow GPS: {followGps ? "on" : "off"}
          </button>
          <button onClick={clearRoute} disabled={!dest} style={btn(styles.btnSmall, !dest)}>Cancella rotta</button>
        </div>
        <div ref={mapRef} style={styles.mapView} />
        {gpsError && <div style={styles.inlineError}>{gpsError}</div>}
      </section>

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

      <input
        type="password"
        value={geminiApiKey}
        onChange={(e) => setGeminiApiKey(e.target.value)}
        placeholder="Gemini API key"
        style={styles.fullInput}
      />
      <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Prompt…" style={styles.textarea} />
      <button onClick={handleSend} disabled={!prompt || !geminiApiKey.trim()} style={btn(styles.sendButton, (!prompt || !geminiApiKey.trim()))}>Invia a Gemini & Frame</button>

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
  btnSmall: {
    padding: "8px 10px",
    backgroundColor: "#1f2937",
    color: "#f3f4f6",
    border: "1px solid #374151",
    borderRadius: 6,
    cursor: "pointer",
    marginRight: 6,
    marginBottom: 6,
  },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },
  mapPanel: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#0f172a",
    border: "1px solid #1f2937",
  },
  mapStats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 8,
    marginBottom: 10,
  },
  statBox: {
    minWidth: 0,
    padding: 10,
    borderRadius: 6,
    backgroundColor: "#1f2937",
  },
  statLabel: {
    display: "block",
    marginBottom: 4,
    color: "#9ca3af",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  statValue: {
    display: "block",
    color: "#f9fafb",
    fontSize: 14,
    overflowWrap: "anywhere",
  },
  mapActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    marginBottom: 10,
  },
  mapView: {
    width: "100%",
    height: 360,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#e5e7eb",
    boxShadow: "0 2px 6px rgba(0,0,0,.35)",
  },
  inlineError: {
    marginTop: 8,
    color: "#fecaca",
    fontSize: 13,
  },
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
  fullInput: {
    width: "100%",
    marginBottom: 8,
    padding: 10,
    borderRadius: 6,
    border: "1px solid #374151",
    backgroundColor: "#1f2937",
    color: "#f3f4f6",
  },
  textarea: {
    width: "100%",
    minHeight: 96,
    marginBottom: 8,
    padding: 10,
    borderRadius: 6,
    border: "1px solid #374151",
    backgroundColor: "#f9fafb",
    color: "#111827",
    resize: "vertical",
  },
  sendButton: {
    display: "block",
    width: "100%",
    marginBottom: 12,
    padding: "10px 14px",
    backgroundColor: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 700,
  },
  response: {
    marginBottom: 16,
    color: "#f3f4f6",
  },
  responsePre: {
    minHeight: 64,
    marginTop: 8,
    padding: 12,
    borderRadius: 6,
    backgroundColor: "#1f2937",
    color: "#d1d5db",
    overflowX: "auto",
    whiteSpace: "pre-wrap",
  },
};
