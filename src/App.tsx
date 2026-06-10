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
import type { JpegQuality } from "frame-msg";
import markinoFrameApp from "../lua/markino_frame_app.lua?raw";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import html2canvas from "html2canvas";
import leafletImage from "leaflet-image";

const DEFAULT_GEMINI_API_KEY =
  import.meta.env.VITE_GEMINI_API_KEY?.trim() || "";
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL?.trim() || "gemini-2.5-flash";
const DEFAULT_POLLINATIONS_API_KEY =
  import.meta.env.VITE_POLLINATIONS_API_KEY?.trim() ||
  import.meta.env.VITE_POLLINATIONS_KEY?.trim() ||
  "";
const POLLINATIONS_MODEL = import.meta.env.VITE_POLLINATIONS_MODEL?.trim() || "sana";
const OSRM_URL = "https://router.project-osrm.org";
const DEFAULT_CENTER = { lat: 40.8362, lng: 16.5936 };
const ROUTE_DEBOUNCE_MS = 700;

type LatLngPoint = { lat: number; lng: number };
type GpsStatus = "checking" | "watching" | "unavailable" | "denied" | "error";
type RouteSummary = {
  distanceMeters: number;
  durationSeconds: number;
};
type RouteStepInfo = {
  instruction: string;
  shortInstruction: string;
  distanceMeters: number;
  durationSeconds: number;
  location: LatLngPoint;
  roadName: string;
};
type MapOrientationMode = "north" | "route";
type ToolTab = "map" | "frame" | "camera" | "ai" | "logs";
type FramePaletteColor = {
  index: number;
  label: string;
  hex: string;
};
type CaptureQualityOption = {
  label: string;
  value: number;
  api: JpegQuality;
};

const FRAME_PALETTE: FramePaletteColor[] = [
  { index: 1, label: "White", hex: "#f8fafc" },
  { index: 2, label: "Grey", hex: "#94a3b8" },
  { index: 3, label: "Red", hex: "#ef4444" },
  { index: 4, label: "Pink", hex: "#ec4899" },
  { index: 5, label: "Dark brown", hex: "#7c2d12" },
  { index: 6, label: "Brown", hex: "#a16207" },
  { index: 7, label: "Orange", hex: "#f97316" },
  { index: 8, label: "Yellow", hex: "#eab308" },
  { index: 9, label: "Dark green", hex: "#166534" },
  { index: 10, label: "Green", hex: "#16a34a" },
  { index: 11, label: "Light green", hex: "#86efac" },
  { index: 12, label: "Night blue", hex: "#1e3a8a" },
  { index: 13, label: "Sea blue", hex: "#0f766e" },
  { index: 14, label: "Sky blue", hex: "#38bdf8" },
  { index: 15, label: "Cloud blue", hex: "#bae6fd" },
];
const QUICK_TEXTS = [":)", ":D", "<3", "OK", "SOS", "!", "?", "XD", ":P", "GO"];
const CAPTURE_QUALITIES: CaptureQualityOption[] = [
  { label: "Low", value: 1, api: "LOW" },
  { label: "Medium", value: 2, api: "MEDIUM" },
  { label: "High", value: 3, api: "HIGH" },
  { label: "Very high", value: 4, api: "VERY_HIGH" },
];

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

const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

const bearingDegrees = (from: LatLngPoint, to: LatLngPoint) => {
  const phi1 = from.lat * Math.PI / 180;
  const phi2 = to.lat * Math.PI / 180;
  const lambda1 = from.lng * Math.PI / 180;
  const lambda2 = to.lng * Math.PI / 180;
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2)
    - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return normalizeDegrees(Math.atan2(y, x) * 180 / Math.PI);
};

const haversineMeters = (from: LatLngPoint, to: LatLngPoint) => {
  const earthRadius = 6371e3;
  const phi1 = from.lat * Math.PI / 180;
  const phi2 = to.lat * Math.PI / 180;
  const deltaPhi = (to.lat - from.lat) * Math.PI / 180;
  const deltaLambda = (to.lng - from.lng) * Math.PI / 180;
  const a = Math.sin(deltaPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const routeLookAheadPoint = (
  current: LatLngPoint | null,
  path: LatLngPoint[],
  fallback: LatLngPoint | null,
  lookAheadMeters = 70,
) => {
  if (!current || path.length === 0) return fallback;

  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  path.forEach((point, index) => {
    const distance = haversineMeters(current, point);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  let walked = 0;
  for (let i = closestIndex; i < path.length - 1; i += 1) {
    walked += haversineMeters(path[i], path[i + 1]);
    if (walked >= lookAheadMeters) return path[i + 1];
  }

  return path[path.length - 1] ?? fallback;
};

const applyMapRotation = (map: L.Map, bearing: number) => {
  const mapPane = map.getPane("mapPane");
  if (!mapPane) return;

  const rotation = normalizeDegrees(bearing);
  const size = map.getSize();
  const panePosition = L.DomUtil.getPosition(mapPane) ?? L.point(0, 0);
  const originX = size.x / 2 - panePosition.x;
  const originY = size.y / 2 - panePosition.y;
  const cleanTransform = (mapPane.style.transform || "")
    .replace(/\s?rotate\([^)]*\)/g, "")
    .trim();

  mapPane.style.transformOrigin = `${originX}px ${originY}px`;
  mapPane.style.transition = rotation ? "transform 180ms linear" : "";
  mapPane.style.transform = rotation
    ? `${cleanTransform} rotate(${-rotation}deg)`.trim()
    : cleanTransform;
};

const userMarkerIcon = (heading: number, mapBearing: number) =>
  L.divIcon({
    className: "markino-user-marker",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `
      <div style="
        width:44px;height:44px;display:grid;place-items:center;position:relative;
        transform:rotate(${normalizeDegrees(heading)}deg);
      ">
        <div style="
          width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;
          border-bottom:26px solid #0f766e;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));
          transform:translateY(-3px);
        "></div>
        <div style="
          position:absolute;width:16px;height:16px;border-radius:999px;background:#f8fafc;
          border:4px solid #0f766e;box-shadow:0 0 0 5px rgba(15,118,110,.2);
          transform:rotate(${-normalizeDegrees(mapBearing)}deg);
        "></div>
      </div>
    `,
  });

const destinationMarkerIcon = (mapBearing: number) =>
  L.divIcon({
    className: "markino-destination-marker",
    iconSize: [38, 48],
    iconAnchor: [19, 43],
    html: `
      <div style="
        width:38px;height:48px;display:grid;place-items:start center;position:relative;
        transform:rotate(${normalizeDegrees(mapBearing)}deg);
      ">
        <div style="
          width:30px;height:30px;border-radius:18px 18px 18px 4px;background:#dc2626;
          transform:rotate(-45deg);border:4px solid #fff;box-shadow:0 4px 10px rgba(0,0,0,.32);
        "></div>
        <div style="
          position:absolute;top:10px;width:10px;height:10px;border-radius:999px;background:#fff;
        "></div>
      </div>
    `,
  });

const removeLayer = (layer: L.Layer | null, map: L.Map) => {
  if (layer) layer.removeFrom(map);
};

const modifierLabel = (modifier?: string) => {
  switch (modifier) {
    case "left": return "a sinistra";
    case "right": return "a destra";
    case "slight left": return "leggermente a sinistra";
    case "slight right": return "leggermente a destra";
    case "sharp left": return "secco a sinistra";
    case "sharp right": return "secco a destra";
    case "straight": return "dritto";
    case "uturn": return "inversione";
    default: return "";
  }
};

const buildInstruction = (step: any, index: number) => {
  const maneuver = step.maneuver || {};
  const road = step.name ? ` su ${step.name}` : "";
  const modifier = modifierLabel(maneuver.modifier);
  const exit = maneuver.exit ? `, uscita ${maneuver.exit}` : "";

  switch (maneuver.type) {
    case "depart":
      return `Parti${road || " da qui"}`;
    case "arrive":
      return "Sei arrivato a destinazione";
    case "turn":
      return `Gira ${modifier || "qui"}${road}`;
    case "new name":
      return `Continua${road}`;
    case "continue":
      return `Prosegui ${modifier || "dritto"}${road}`;
    case "merge":
      return `Immettiti ${modifier || ""}${road}`.trim();
    case "on ramp":
      return `Prendi la rampa ${modifier || ""}${road}`.trim();
    case "off ramp":
      return `Esci dalla rampa ${modifier || ""}${road}`.trim();
    case "fork":
      return `Tieni ${modifier || "la direzione"}${road}`;
    case "end of road":
      return `Fine strada, gira ${modifier || "qui"}${road}`;
    case "roundabout":
    case "rotary":
      return `Entra nella rotonda${exit}${road}`;
    case "exit roundabout":
    case "exit rotary":
      return `Esci dalla rotonda${road}`;
    case "notification":
      return `Attenzione${road || ` step ${index + 1}`}`;
    default:
      return `${modifier ? `${modifier} ` : "Prosegui"}${road || `step ${index + 1}`}`.trim();
  }
};

const normalizeRouteSteps = (route: any): RouteStepInfo[] => {
  const steps = route?.legs?.flatMap((leg: any) => leg.steps || []) || [];
  return steps
    .map((step: any, index: number) => {
      const location = step.maneuver?.location;
      if (!Array.isArray(location) || location.length < 2) return null;
      const instruction = buildInstruction(step, index);
      return {
        instruction,
        shortInstruction: `${instruction} (${formatDistance(step.distance || 0)})`,
        distanceMeters: step.distance || 0,
        durationSeconds: step.duration || 0,
        location: { lng: location[0], lat: location[1] },
        roadName: step.name || "",
      } satisfies RouteStepInfo;
    })
    .filter(Boolean) as RouteStepInfo[];
};

const responseTextPreview = async (response: Response) => {
  const text = await response.text().catch(() => "");
  if (!text) return response.statusText || "risposta vuota";

  try {
    const parsed = JSON.parse(text);
    return String(parsed.error || parsed.message || JSON.stringify(parsed)).slice(0, 280);
  } catch {
    return text.slice(0, 280);
  }
};

const pollinationsImageUrl = (prompt: string, apiKey: string) => {
  const url = new URL(
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.trim() || "abstract art")}`,
  );
  url.searchParams.set("model", POLLINATIONS_MODEL);
  url.searchParams.set("width", "640");
  url.searchParams.set("height", "640");
  url.searchParams.set("referrer", "markinkus.github.io");

  const cleanKey = apiKey.trim();
  if (cleanKey) {
    url.searchParams.set("key", cleanKey);
  }

  return url.toString();
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number, message: string) =>
  Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);

const isLikelyJpeg = (bytes: Uint8Array) =>
  bytes.length > 4 &&
  bytes[0] === 0xff &&
  bytes[1] === 0xd8 &&
  bytes[bytes.length - 2] === 0xff &&
  bytes[bytes.length - 1] === 0xd9;

const getViewportWidth = () => {
  if (typeof window === "undefined") return 1180;
  return Math.round(window.visualViewport?.width || window.innerWidth || 1180);
};

const useViewportWidth = () => {
  const [viewportWidth, setViewportWidth] = useState(getViewportWidth);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => setViewportWidth(getViewportWidth()));
    };

    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  return viewportWidth;
};

const buildResponsiveStyles = (viewportWidth: number): Record<string, React.CSSProperties> => {
  const isMobile = viewportWidth <= 760;
  const isTiny = viewportWidth <= 430;

  if (!isMobile) return styles;

  return {
    ...styles,
    shell: {
      ...styles.shell,
      minWidth: 0,
      padding: isTiny ? 8 : 12,
      overflowX: "hidden",
    },
    topBar: {
      ...styles.topBar,
      gap: 10,
      flexWrap: "nowrap",
      margin: "0 auto 10px",
    },
    brandGroup: {
      ...styles.brandGroup,
      minWidth: 0,
      gap: 10,
      flex: "1 1 auto",
    },
    logoMark: {
      ...styles.logoMark,
      width: isTiny ? 36 : 40,
      height: isTiny ? 36 : 40,
      flex: "0 0 auto",
      fontSize: 13,
    },
    header: {
      ...styles.header,
      maxWidth: "100%",
      fontSize: isTiny ? 18 : 21,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    subHeader: {
      ...styles.subHeader,
      marginTop: 2,
      fontSize: 11,
    },
    connectionPill: {
      ...styles.connectionPill,
      minWidth: 0,
      flex: "0 0 auto",
      padding: "7px 9px",
      fontSize: 12,
    },
    tabBar: {
      ...styles.tabBar,
      margin: "0 -2px 10px",
      position: "sticky",
      top: 0,
      zIndex: 50,
      border: "1px solid #d7d0c2",
      boxShadow: "0 4px 14px rgba(58, 48, 34, .12)",
      scrollbarWidth: "none",
    },
    tabButton: {
      ...styles.tabButton,
      minWidth: isTiny ? 70 : 82,
      flex: "0 0 auto",
      padding: isTiny ? "9px 10px" : "10px 12px",
      fontSize: 13,
    },
    appLayout: {
      ...styles.appLayout,
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: 10,
    },
    workspace: {
      ...styles.workspace,
      order: 2,
    },
    sidePanel: {
      ...styles.sidePanel,
      order: 1,
      position: "static",
      top: "auto",
      gap: 10,
    },
    sideBlock: {
      ...styles.sideBlock,
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      padding: 10,
      boxShadow: "0 4px 16px rgba(47, 42, 69, .16)",
    },
    sideTitle: {
      ...styles.sideTitle,
      gridColumn: "1 / -1",
    },
    panel: {
      ...styles.panel,
      padding: isTiny ? 10 : 12,
      boxShadow: "0 4px 18px rgba(58, 48, 34, .10)",
    },
    sectionHead: {
      ...styles.sectionHead,
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: 10,
      marginBottom: 12,
    },
    sectionTitle: {
      ...styles.sectionTitle,
      fontSize: isTiny ? 19 : 20,
    },
    sectionMeta: {
      ...styles.sectionMeta,
      fontSize: 12,
      overflowWrap: "anywhere",
    },
    metricGrid: {
      ...styles.metricGrid,
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: 7,
      marginBottom: 10,
    },
    metricBox: {
      ...styles.metricBox,
      padding: isTiny ? 8 : 9,
    },
    metricLabel: {
      ...styles.metricLabel,
      fontSize: 10,
    },
    metricValue: {
      ...styles.metricValue,
      fontSize: isTiny ? 12 : 13,
      lineHeight: 1.25,
    },
    inlineControls: {
      ...styles.inlineControls,
      display: "grid",
      gridTemplateColumns: isTiny ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
      alignItems: "stretch",
      gap: 7,
      marginBottom: 10,
    },
    compactField: {
      ...styles.compactField,
      width: "100%",
      minWidth: 0,
      boxSizing: "border-box",
    },
    primaryButton: {
      ...styles.primaryButton,
      width: "100%",
      padding: "10px 12px",
      whiteSpace: "normal",
      lineHeight: 1.15,
    },
    secondaryButton: {
      ...styles.secondaryButton,
      width: "100%",
      padding: "10px 12px",
      whiteSpace: "normal",
      lineHeight: 1.15,
    },
    ghostButton: {
      ...styles.ghostButton,
      width: "100%",
      padding: "10px 12px",
      whiteSpace: "normal",
      lineHeight: 1.15,
    },
    dangerButton: {
      ...styles.dangerButton,
      width: "100%",
      padding: "10px 12px",
      whiteSpace: "normal",
      lineHeight: 1.15,
    },
    navCard: {
      ...styles.navCard,
      marginBottom: 10,
      padding: 10,
    },
    navInstruction: {
      ...styles.navInstruction,
      fontSize: isTiny ? 17 : 18,
    },
    directionsList: {
      ...styles.directionsList,
      maxHeight: isTiny ? 190 : 220,
      marginBottom: 10,
    },
    directionItem: {
      ...styles.directionItem,
      gridTemplateColumns: isTiny ? "28px minmax(0, 1fr)" : "30px minmax(0, 1fr) auto",
      minHeight: 42,
      padding: "8px",
      gap: 7,
    },
    directionIndex: {
      ...styles.directionIndex,
      width: 24,
      height: 24,
    },
    directionText: {
      ...styles.directionText,
      fontSize: 13,
      lineHeight: 1.25,
    },
    directionDistance: {
      ...styles.directionDistance,
      display: isTiny ? "none" : "block",
    },
    mapView: {
      ...styles.mapView,
      minHeight: isTiny ? 300 : 330,
      height: "46svh",
      maxHeight: 520,
    },
    mapHud: {
      ...styles.mapHud,
      left: 8,
      right: 8,
      top: 8,
      padding: isTiny ? 9 : 10,
    },
    mapHudInstruction: {
      ...styles.mapHudInstruction,
      fontSize: isTiny ? 14 : 15,
    },
    formGrid: {
      ...styles.formGrid,
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: 9,
    },
    quickGrid: {
      ...styles.quickGrid,
      gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
      gap: 7,
    },
    quickButton: {
      ...styles.quickButton,
      minHeight: 40,
    },
    paletteGrid: {
      ...styles.paletteGrid,
      gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
      gap: 7,
    },
    mediaGrid: {
      ...styles.mediaGrid,
      gridTemplateColumns: "minmax(0, 1fr)",
      gap: 10,
    },
    uploadStrip: {
      ...styles.uploadStrip,
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      padding: 10,
    },
    previewBox: {
      ...styles.previewBox,
      minHeight: 210,
      padding: 9,
    },
    previewImage: {
      ...styles.previewImage,
      maxHeight: "48svh",
    },
    emptyPreview: {
      ...styles.emptyPreview,
      minHeight: 170,
    },
    logs: {
      ...styles.logs,
      minHeight: 180,
      maxHeight: "52svh",
      fontSize: 12,
    },
    statusBox: {
      ...styles.statusBox,
      gridColumn: "1 / -1",
      fontSize: 12,
    },
    responsePre: {
      ...styles.responsePre,
      fontSize: 12,
      overflowX: "hidden",
      wordBreak: "break-word",
    },
  };
};

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
  const viewportWidth = useViewportWidth();
  const [frame, setFrame] = useState<FrameMsg | null>(null);
  const [geminiApiKey, setGeminiApiKey] = useState(DEFAULT_GEMINI_API_KEY);
  const [pollinationsApiKey, setPollinationsApiKey] = useState(DEFAULT_POLLINATIONS_API_KEY);
  const [activeTab, setActiveTab] = useState<ToolTab>("map");
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [frameText, setFrameText] = useState("Ciao dal web app");
  const [textColor, setTextColor] = useState(1);
  const [textX, setTextX] = useState(24);
  const [textY, setTextY] = useState(40);
  const [textSpacing, setTextSpacing] = useState(4);
  const [captureResolution, setCaptureResolution] = useState(512);
  const [captureQualityIndex, setCaptureQualityIndex] = useState(2);
  const [capturePan, setCapturePan] = useState(0);
  const [captureUpright, setCaptureUpright] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
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
  const [routeSteps, setRouteSteps] = useState<RouteStepInfo[]>([]);
  const [routePath, setRoutePath] = useState<LatLngPoint[]>([]);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isRouting, setIsRouting] = useState(false);
  const [mapOrientation, setMapOrientation] = useState<MapOrientationMode>("route");
  const [mapBearing, setMapBearing] = useState(0);
  const [destInput, setDestInput] = useState({ lat: "", lng: "" });
  const [dest, setDest] = useState<LatLngPoint | null>(null);
  const routeOutlineLayer = useRef<L.Polyline | null>(null);
  const routeLayer = useRef<L.Polyline | null>(null);
  const routeRenderer = useRef<L.Renderer | null>(null);
  const userMarkerLayer = useRef<L.Marker | null>(null);
  const accuracyLayer = useRef<L.Circle | null>(null);
  const destinationMarkerLayer = useRef<L.Marker | null>(null);
  const activeStepMarkerLayer = useRef<L.CircleMarker | null>(null);
  const poiLayer = useRef<L.LayerGroup | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapShellRef = useRef<HTMLDivElement>(null);
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
      zoomControl: false,
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
    L.control.zoom({ position: "bottomright" }).addTo(map);
    map.createPane("routePane");
    const pane = map.getPane("routePane");
    if (pane) {
      pane.style.zIndex = "520";
      pane.style.pointerEvents = "none";
    }
    routeRenderer.current = L.svg({ pane: "routePane" }).addTo(map);

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
      routeOutlineLayer.current = null;
      routeLayer.current = null;
      routeRenderer.current = null;
      userMarkerLayer.current = null;
      accuracyLayer.current = null;
      destinationMarkerLayer.current = null;
      activeStepMarkerLayer.current = null;
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
      userMarkerLayer.current = L.marker(latLng, {
        icon: userMarkerIcon(heading, mapBearing),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1200,
      }).addTo(map);
    } else {
      userMarkerLayer.current.setLatLng(latLng);
      userMarkerLayer.current.setIcon(userMarkerIcon(heading, mapBearing));
    }
    userMarkerLayer.current.setZIndexOffset(1200);

    if (followGps) {
      map.setView(latLng, Math.max(map.getZoom(), 16), { animate: false });
    }
  }, [accuracy, followGps, heading, mapBearing, pos]);

  useEffect(() => {
    if (activeTab !== "map" || !leafletMap.current) return;
    window.setTimeout(() => leafletMap.current?.invalidateSize(), 0);
  }, [activeTab]);

  useEffect(() => {
    const map = leafletMap.current;

    if (!map || !pos || !dest) {
      routeAbortRef.current?.abort();
      lastRouteKeyRef.current = null;

      if (map) {
        removeLayer(routeLayer.current, map);
        removeLayer(routeOutlineLayer.current, map);
      }
      routeLayer.current = null;
      routeOutlineLayer.current = null;

      setRouteSummary(null);
      setRouteSteps([]);
      setRoutePath([]);
      setActiveStepIndex(0);
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

    setRouteSummary(null);
    setRouteSteps([]);
    setRoutePath([]);
    setActiveStepIndex(0);
    lastRouteKeyRef.current = routeKey;

    const controller = new AbortController();
    routeAbortRef.current = controller;
    setIsRouting(true);

    const url =
      `${OSRM_URL}/route/v1/driving/` +
      `${pos.lng},${pos.lat};${dest.lng},${dest.lat}` +
      `?overview=full&geometries=geojson&steps=true`;

    const drawRouteLayers = (
      path: LatLngPoint[],
      variant: "fallback" | "driving",
    ) => {
      const renderer = routeRenderer.current ?? undefined;
      const latLngs = path.map((point) => [point.lat, point.lng] as [number, number]);

      removeLayer(routeLayer.current, map);
      removeLayer(routeOutlineLayer.current, map);
      routeOutlineLayer.current = L.polyline(latLngs, {
        color: "#ffffff",
        weight: variant === "fallback" ? 15 : 16,
        opacity: 1,
        dashArray: variant === "fallback" ? "12 10" : undefined,
        lineCap: "round",
        lineJoin: "round",
        pane: "routePane",
        renderer,
      }).addTo(map);

      routeLayer.current = L.polyline(latLngs, {
        color: variant === "fallback" ? "#f59e0b" : "#0ea5e9",
        weight: variant === "fallback" ? 9 : 10,
        opacity: 1,
        dashArray: variant === "fallback" ? "12 10" : undefined,
        lineCap: "round",
        lineJoin: "round",
        pane: "routePane",
        renderer,
      }).addTo(map);

      routeOutlineLayer.current.bringToFront();
      routeLayer.current.bringToFront();
    };

    const drawFallbackRoute = () => {
      const distanceMeters = haversineMeters(pos, dest);
      const durationSeconds = distanceMeters / 11;

      drawRouteLayers([pos, dest], "fallback");
      setRouteSummary({ distanceMeters, durationSeconds });
      setRouteSteps([{
        instruction: "Procedi verso la destinazione",
        shortInstruction: `Procedi verso la destinazione (${formatDistance(distanceMeters)})`,
        distanceMeters,
        durationSeconds,
        location: dest,
        roadName: "",
      }]);
      setRoutePath([pos, dest]);
      if (routeLayer.current) {
        map.fitBounds(routeLayer.current.getBounds().pad(0.18), { animate: false });
      }
      addLog(`▶ linea provvisoria: ${formatDistance(distanceMeters)}`);
    };

    drawFallbackRoute();

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

          const path = coordinates.map(
            ([lng, lat]: [number, number]) => ({ lat, lng }),
          ) as LatLngPoint[];

          drawRouteLayers(path, "driving");

          setRouteSummary({
            distanceMeters: route.distance,
            durationSeconds: route.duration,
          });
          setRouteSteps(normalizeRouteSteps(route));
          setRoutePath(path);

          if (routeLayer.current) {
            map.fitBounds(routeLayer.current.getBounds().pad(0.18), {
              animate: false,
            });
          }
          addLog(`✔ percorso OSRM: ${formatDistance(route.distance)}`);
          setStatus("Percorso stradale disegnato.");
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          console.warn("OSRM error", error);
          setStatus("OSRM non disponibile: linea diretta mostrata.");
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

  useEffect(() => {
    if (!pos || routeSteps.length === 0) return;

    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    routeSteps.forEach((step, index) => {
      const distance = haversineMeters(pos, step.location);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    setActiveStepIndex((current) => {
      if (closestIndex > current || closestDistance < 35) {
        return closestIndex;
      }
      return current;
    });
  }, [pos, routeSteps]);

  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    if (!dest) {
      destinationMarkerLayer.current?.removeFrom(map);
      destinationMarkerLayer.current = null;
      return;
    }

    const latLng = L.latLng(dest.lat, dest.lng);
    if (!destinationMarkerLayer.current) {
      destinationMarkerLayer.current = L.marker(latLng, {
        icon: destinationMarkerIcon(mapBearing),
        zIndexOffset: 1100,
      }).addTo(map);
      destinationMarkerLayer.current.bindTooltip("Destinazione");
    } else {
      destinationMarkerLayer.current.setLatLng(latLng);
      destinationMarkerLayer.current.setIcon(destinationMarkerIcon(mapBearing));
    }
    destinationMarkerLayer.current.setZIndexOffset(1100);
  }, [dest, mapBearing]);

  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    const step = routeSteps[activeStepIndex];
    if (!step) {
      activeStepMarkerLayer.current?.removeFrom(map);
      activeStepMarkerLayer.current = null;
      return;
    }

    const latLng = L.latLng(step.location.lat, step.location.lng);
    if (!activeStepMarkerLayer.current) {
      activeStepMarkerLayer.current = L.circleMarker(latLng, {
        radius: 9,
        color: "#ffffff",
        fillColor: "#f59e0b",
        fillOpacity: 1,
        opacity: 1,
        weight: 4,
        pane: "routePane",
        renderer: routeRenderer.current ?? undefined,
      }).addTo(map);
    } else {
      activeStepMarkerLayer.current.setLatLng(latLng);
    }

    activeStepMarkerLayer.current
      .bindTooltip(step.instruction)
      .bringToFront();
    routeOutlineLayer.current?.bringToFront();
    routeLayer.current?.bringToFront();
    activeStepMarkerLayer.current.bringToFront();
  }, [activeStepIndex, routeSteps]);

  useEffect(() => {
    const activeStep = routeSteps[activeStepIndex] || null;
    const fallbackTarget = activeStep?.location ?? dest;
    const target = routeLookAheadPoint(pos, routePath, fallbackTarget);
    const nextBearing =
      mapOrientation === "route" && pos && target
        ? bearingDegrees(pos, target)
        : 0;

    setMapBearing(nextBearing);
  }, [activeStepIndex, dest, mapOrientation, pos, routePath, routeSteps]);

  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    const syncRotation = () => applyMapRotation(map, mapBearing);
    syncRotation();
    map.on("move zoom resize viewreset", syncRotation);

    return () => {
      map.off("move zoom resize viewreset", syncRotation);
    };
  }, [mapBearing]);

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  const mapToCanvas = async () => {
    if (!mapRef.current || !mapShellRef.current || !leafletMap.current) {
      throw new Error("Mappa non inizializzata.");
    }

    leafletMap.current.invalidateSize();
    await sleep(250);

    try {
      return await html2canvas(mapShellRef.current, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#f8fafc",
        scale: 2,
      });
    } catch (error) {
      console.warn("html2canvas map fallback", error);
      return await new Promise<HTMLCanvasElement>((resolve, reject) => {
        leafletImage(leafletMap.current!, (err, canvas) => {
          if (err) reject(err);
          else resolve(canvas);
        });
      });
    }
  };

  const appendQuickText = (value: string) => {
    setFrameText((current) => {
      const spacer = current.trim() ? " " : "";
      return `${current}${spacer}${value}`;
    });
  };

  const sendFrameText = async () => {
    if (!frame) {
      setStatus("Connetti prima il Frame.");
      return;
    }

    const text = frameText.trim();
    if (!text) {
      setStatus("Scrivi un testo da inviare.");
      return;
    }

    try {
      await frame.sendMessage(
        0x0a,
        new TxPlainText({
          text,
          x: textX,
          y: textY,
          paletteOffset: textColor,
          spacing: textSpacing,
        }).pack(),
      );
      addLog(`✔ testo inviato: ${text}`);
      setStatus("Testo inviato al Frame.");
    } catch (e: any) {
      addLog("✖ text: " + e.message);
      setStatus("Errore testo: " + e.message);
    }
  };

  const sendNavigationStep = async () => {
    if (!frame) {
      setStatus("Connetti prima il Frame.");
      return;
    }

    const step = routeSteps[activeStepIndex];
    if (!step) {
      setStatus("Nessuna indicazione disponibile.");
      return;
    }

    const remaining = routeSummary ? `${formatDistance(routeSummary.distanceMeters)} totali` : "";
    const text = [`NAV`, step.shortInstruction, remaining].filter(Boolean).join("\n");

    try {
      await frame.sendMessage(
        0x0a,
        new TxPlainText({
          text,
          x: 12,
          y: 28,
          paletteOffset: 14,
          spacing: 3,
        }).pack(),
      );
      addLog(`✔ indicazione inviata: ${step.shortInstruction}`);
      setStatus("Indicazione inviata al Frame.");
    } catch (e: any) {
      addLog("✖ nav text: " + e.message);
      setStatus("Errore indicazione: " + e.message);
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
    if (isCapturing) {
      setStatus("Aspetta la fine della cattura foto.");
      return;
    }
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
    if (isCapturing) {
      setStatus("Auto mappa sospesa durante la cattura foto.");
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
    if (routeOutlineLayer.current && leafletMap.current) {
      routeOutlineLayer.current.removeFrom(leafletMap.current);
      routeOutlineLayer.current = null;
    }
    if (routeLayer.current && leafletMap.current) {
      routeLayer.current.removeFrom(leafletMap.current);
      routeLayer.current = null;
    }
    if (activeStepMarkerLayer.current && leafletMap.current) {
      activeStepMarkerLayer.current.removeFrom(leafletMap.current);
      activeStepMarkerLayer.current = null;
    }
    setDest(null);
    setDestInput({ lat: "", lng: "" });
    setRouteSummary(null);
    setRouteSteps([]);
    setRoutePath([]);
    setActiveStepIndex(0);
    setMapBearing(0);
    setStatus("Rotta cancellata.");
  };

  /* ─────────────── Capture photo (unchanged) ─────────────── */
  const handleCapture = async () => {
    if (!frame) return setStatus("Connetti prima gli occhiali!");
    if (isCapturing) return;

    setIsCapturing(true);
    stopAutoUpdate();
    setStatus("Cattura foto in corso...");
    addLog("▶ handleCapture");

    let rx: RxPhoto | null = null;
    try {
      const quality = CAPTURE_QUALITIES.find((item) => item.value === captureQualityIndex)
        ?? CAPTURE_QUALITIES[1];

      rx = new RxPhoto({
        upright: captureUpright,
        quality: quality.api,
        resolution: captureResolution,
      });
      const q = await rx.attach(frame);
      await sleep(350);
      await frame.sendMessage(
        0x0d,
        new TxCaptureSettings({
          resolution: captureResolution,
          qualityIndex: captureQualityIndex,
          pan: capturePan,
          raw: false,
        }).pack(),
      );
      const jpeg = await withTimeout(
        q.get(),
        45000,
        "Timeout foto: il Frame non ha chiuso il trasferimento JPEG.",
      );

      if (!isLikelyJpeg(jpeg)) {
        addLog(`⚠ JPEG sospetto: ${jpeg.length} byte, header/footer non completi`);
      }

      const url = blobUrl(jpeg);
      setPhotoUrl(url);
      setSpriteUrl(null);
      setShowMedia(true);
      setStatus(`Foto catturata: ${captureResolution}px, ${quality.label}`);
    } catch (e: any) {
      addLog("✖ capture: " + e.message);
      setStatus("Errore capture: " + e.message);
    } finally {
      if (rx) rx.detach(frame);
      setIsCapturing(false);
    }
  };

  /* ─────────────── Pollinations → Sprite ─────────────── */
  const handleGenerateImage = async () => {
    if (!frame) return setStatus("Connetti prima gli occhiali!");
    if (isCapturing) return setStatus("Aspetta la fine della cattura foto.");
    setStatus("Generazione immagine…");
    addLog("▶ handleGenerateImage");
    try {
      const pollUrl = pollinationsImageUrl(prompt, pollinationsApiKey);
      const resp = await fetch(pollUrl, {
        headers: {
          Accept: "image/*,application/json",
        },
      });
      const contentType = resp.headers.get("content-type") || "";

      if (!resp.ok) {
        const details = await responseTextPreview(resp);
        const hint = resp.status === 402
          ? "Pollinations ha bloccato la richiesta per rate limit/budget"
          : `Pollinations HTTP ${resp.status}`;
        throw new Error(`${hint}: ${details}`);
      }

      if (!contentType.startsWith("image/")) {
        const details = await responseTextPreview(resp);
        throw new Error(
          `Pollinations non ha restituito un'immagine (${contentType || "content-type assente"}): ${details}`,
        );
      }

      const imgBytes = await resp.arrayBuffer();

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

  const handleGalleryImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setStatus("Seleziona un file immagine.");
      return;
    }

    if (isCapturing) {
      setStatus("Aspetta la fine della cattura foto.");
      return;
    }

    setStatus("Preparo immagine da galleria...");
    addLog(`▶ gallery image: ${file.name}`);

    try {
      const bytes = await file.arrayBuffer();
      setPhotoUrl(blobUrl(bytes, file.type || "image/jpeg"));
      setShowMedia(true);

      const sprite = await TxSprite.fromImageBytes(bytes, 36000);
      const pngBytes = sprite.toPngBytes();
      if (pngBytes) {
        setSpriteUrl(blobUrl(pngBytes, "image/png"));
      }

      if (frame) {
        await frame.sendMessage(0x20, sprite.pack());
        addLog("✔ immagine galleria inviata agli occhiali");
        setStatus("Immagine galleria inviata al Frame.");
      } else {
        setStatus("Immagine pronta. Connetti il Frame per inviarla.");
      }
    } catch (e: any) {
      addLog("✖ gallery image: " + e.message);
      setStatus("Errore immagine galleria: " + e.message);
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

  const styles = buildResponsiveStyles(viewportWidth);
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
  const orientationLabel =
    mapOrientation === "route" && dest
      ? `Rotta su ${Math.round(mapBearing)}°`
      : "Nord su";
  const activeStep = routeSteps[activeStepIndex] || null;
  const activeStepLabel = activeStep
    ? activeStep.shortInstruction
    : routeSummary
      ? "Indicazioni non disponibili"
      : "Imposta una destinazione";
  const destLabel = dest
    ? `${formatCoord(dest.lat)}, ${formatCoord(dest.lng)}`
    : "Click sulla mappa o inserisci coordinate";
  const isConnected = Boolean(frame);
  const selectedTextColor = FRAME_PALETTE.find((color) => color.index === textColor) ?? FRAME_PALETTE[0];
  const selectedCaptureQuality = CAPTURE_QUALITIES.find((item) => item.value === captureQualityIndex)
    ?? CAPTURE_QUALITIES[1];
  const tabs: Array<{ id: ToolTab; label: string }> = [
    { id: "map", label: "Mappa" },
    { id: "frame", label: "Frame" },
    { id: "camera", label: "Camera" },
    { id: "ai", label: "AI" },
    { id: "logs", label: "Log" },
  ];

  return (
    <div style={styles.shell}>
      <header style={styles.topBar}>
        <div style={styles.brandGroup}>
          <div style={styles.logoMark}>MF</div>
          <div>
            <h1 style={styles.header}>Markino Frame</h1>
            <div style={styles.subHeader}>Control center BLE</div>
          </div>
        </div>
        <div style={{ ...styles.connectionPill, ...(isConnected ? styles.connectionOn : {}) }}>
          {isConnected ? "Connesso" : "Offline"}
        </div>
      </header>

      <nav style={styles.tabBar} aria-label="Sezioni app">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tabButton,
              ...(activeTab === tab.id ? styles.tabButtonActive : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main style={styles.appLayout}>
        <section style={styles.workspace}>
          <section style={{ ...styles.panel, display: activeTab === "map" ? "block" : "none" }}>
            <div style={styles.sectionHead}>
              <div>
                <h2 style={styles.sectionTitle}>Navigazione</h2>
                <div style={styles.sectionMeta}>{activeStepLabel}</div>
              </div>
              <button onClick={sendMapToFrame} disabled={!frame || isCapturing} style={btn(styles.primaryButton, !frame || isCapturing)}>
                Invia mappa
              </button>
            </div>

            <div style={styles.metricGrid}>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>GPS</span>
                <strong style={styles.metricValue}>{gpsLabel}</strong>
              </div>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Accuratezza</span>
                <strong style={styles.metricValue}>{accuracy !== null ? `${Math.round(accuracy)} m` : "n/d"}</strong>
              </div>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Destinazione</span>
                <strong style={styles.metricValue}>{destLabel}</strong>
              </div>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Bussola</span>
                <strong style={styles.metricValue}>{Math.round(heading)}°</strong>
              </div>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Rotta</span>
                <strong style={styles.metricValue}>{routeLabel}</strong>
              </div>
              <div style={styles.metricBox}>
                <span style={styles.metricLabel}>Orientamento</span>
                <strong style={styles.metricValue}>{orientationLabel}</strong>
              </div>
            </div>

            <div style={styles.inlineControls}>
              <input
                style={styles.compactField}
                type="text"
                placeholder="lat"
                value={destInput.lat}
                onChange={(e) => setDestInput({ ...destInput, lat: e.target.value })}
              />
              <input
                style={styles.compactField}
                type="text"
                placeholder="lng"
                value={destInput.lng}
                onChange={(e) => setDestInput({ ...destInput, lng: e.target.value })}
              />
              <button onClick={handleSetDest} style={btn(styles.secondaryButton, !destinationPoint)} disabled={!destinationPoint}>
                Avvia rotta
              </button>
              <button onClick={centerOnGps} disabled={!pos} style={btn(styles.ghostButton, !pos)}>Centra GPS</button>
              <button onClick={() => setFollowGps((value) => !value)} style={styles.ghostButton}>
                Follow {followGps ? "on" : "off"}
              </button>
              <button
                onClick={() => setMapOrientation((value) => value === "route" ? "north" : "route")}
                disabled={!dest}
                style={btn(styles.ghostButton, !dest)}
              >
                {mapOrientation === "route" ? "Rotta su" : "Nord su"}
              </button>
              <button onClick={sendNavigationStep} disabled={!frame || !activeStep} style={btn(styles.ghostButton, !frame || !activeStep)}>
                Invia indicazione
              </button>
              <button onClick={clearRoute} disabled={!dest} style={btn(styles.ghostButton, !dest)}>Cancella</button>
            </div>

            <div style={styles.navCard}>
              <div style={styles.previewTitle}>Prossima indicazione</div>
              <div style={styles.navInstruction}>{activeStepLabel}</div>
              <div style={styles.navMeta}>
                {activeStep
                  ? `${formatDistance(activeStep.distanceMeters)} / ${formatDuration(activeStep.durationSeconds)}`
                  : "Nessuno step attivo"}
              </div>
            </div>

            {routeSteps.length > 0 && (
              <div style={styles.directionsList}>
                {routeSteps.slice(0, 12).map((step, index) => (
                  <button
                    key={`${step.instruction}-${index}`}
                    onClick={() => setActiveStepIndex(index)}
                    style={{
                      ...styles.directionItem,
                      ...(index === activeStepIndex ? styles.directionItemActive : {}),
                    }}
                  >
                    <span style={styles.directionIndex}>{index + 1}</span>
                    <span style={styles.directionText}>{step.instruction}</span>
                    <span style={styles.directionDistance}>{formatDistance(step.distanceMeters)}</span>
                  </button>
                ))}
              </div>
            )}

            <div ref={mapShellRef} style={styles.mapShell}>
              <div ref={mapRef} style={styles.mapView} />
              <div style={styles.mapHud}>
                <div style={styles.mapHudKicker}>
                  {orientationLabel}
                  {routeSummary ? ` · ${routeLabel}` : ""}
                </div>
                <div style={styles.mapHudInstruction}>{activeStepLabel}</div>
                <div style={styles.mapHudMeta}>
                  {activeStep
                    ? `${formatDistance(activeStep.distanceMeters)} prima del prossimo step`
                    : dest
                      ? "Attendo GPS/OSRM per disegnare percorso e indicazioni"
                      : "Tocca la mappa o inserisci una destinazione"}
                </div>
              </div>
            </div>
            {gpsError && <div style={styles.inlineError}>{gpsError}</div>}
          </section>

          <section style={{ ...styles.panel, display: activeTab === "frame" ? "block" : "none" }}>
            <div style={styles.sectionHead}>
              <div>
                <h2 style={styles.sectionTitle}>Messaggi Frame</h2>
                <div style={styles.sectionMeta}>Colore: {selectedTextColor.label}</div>
              </div>
              <button onClick={sendFrameText} disabled={!frame || !frameText.trim()} style={btn(styles.primaryButton, !frame || !frameText.trim())}>
                Invia testo
              </button>
            </div>

            <textarea
              rows={4}
              value={frameText}
              onChange={(e) => setFrameText(e.target.value)}
              placeholder="Testo per display Frame"
              style={styles.textarea}
            />

            <div style={styles.quickGrid}>
              {QUICK_TEXTS.map((item) => (
                <button key={item} onClick={() => appendQuickText(item)} style={styles.quickButton}>
                  {item}
                </button>
              ))}
            </div>

            <div style={styles.paletteGrid}>
              {FRAME_PALETTE.map((color) => (
                <button
                  key={color.index}
                  onClick={() => setTextColor(color.index)}
                  title={color.label}
                  style={{
                    ...styles.swatch,
                    backgroundColor: color.hex,
                    ...(textColor === color.index ? styles.swatchActive : {}),
                  }}
                />
              ))}
            </div>

            <div style={styles.formGrid}>
              <label style={styles.fieldLabel}>
                X
                <input
                  type="number"
                  min={1}
                  max={640}
                  value={textX}
                  onChange={(e) => setTextX(Number(e.target.value))}
                  style={styles.field}
                />
              </label>
              <label style={styles.fieldLabel}>
                Y
                <input
                  type="number"
                  min={1}
                  max={400}
                  value={textY}
                  onChange={(e) => setTextY(Number(e.target.value))}
                  style={styles.field}
                />
              </label>
              <label style={styles.fieldLabel}>
                Spaziatura
                <input
                  type="number"
                  min={0}
                  max={24}
                  value={textSpacing}
                  onChange={(e) => setTextSpacing(Number(e.target.value))}
                  style={styles.field}
                />
              </label>
            </div>
          </section>

          <section style={{ ...styles.panel, display: activeTab === "camera" ? "block" : "none" }}>
            <div style={styles.sectionHead}>
              <div>
                <h2 style={styles.sectionTitle}>Camera</h2>
                <div style={styles.sectionMeta}>
                  {captureResolution}px, {selectedCaptureQuality.label}, pan {capturePan}
                </div>
              </div>
              <button onClick={handleCapture} disabled={!frame || isCapturing} style={btn(styles.primaryButton, !frame || isCapturing)}>
                {isCapturing ? "Cattura..." : "Scatta"}
              </button>
            </div>

            <div style={styles.formGrid}>
              <label style={styles.fieldLabel}>
                Risoluzione
                <select
                  value={captureResolution}
                  onChange={(e) => setCaptureResolution(Number(e.target.value))}
                  style={styles.field}
                >
                  {[320, 416, 512, 640, 720].map((value) => (
                    <option key={value} value={value}>{value}px</option>
                  ))}
                </select>
              </label>
              <label style={styles.fieldLabel}>
                Qualità
                <select
                  value={captureQualityIndex}
                  onChange={(e) => setCaptureQualityIndex(Number(e.target.value))}
                  style={styles.field}
                >
                  {CAPTURE_QUALITIES.map((quality) => (
                    <option key={quality.value} value={quality.value}>{quality.label}</option>
                  ))}
                </select>
              </label>
              <label style={styles.fieldLabel}>
                Pan
                <input
                  type="range"
                  min={-140}
                  max={140}
                  step={10}
                  value={capturePan}
                  onChange={(e) => setCapturePan(Number(e.target.value))}
                  style={styles.rangeField}
                />
              </label>
              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={captureUpright}
                  onChange={(e) => setCaptureUpright(e.target.checked)}
                />
                Ruota immagine
              </label>
            </div>

            <div style={styles.uploadStrip}>
              <div>
                <div style={styles.previewTitle}>Galleria</div>
                <div style={styles.sectionMeta}>Seleziona una foto locale e la mando come sprite al Frame</div>
              </div>
              <label style={styles.fileButton}>
                Scegli foto
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleGalleryImage}
                  style={styles.hiddenInput}
                />
              </label>
            </div>

            <div style={styles.mediaGrid}>
              <div style={styles.previewBox}>
                <div style={styles.previewTitle}>Foto</div>
                {photoUrl ? <img src={photoUrl} alt="capture" style={styles.previewImage} /> : <div style={styles.emptyPreview}>Nessuna foto</div>}
              </div>
              <div style={styles.previewBox}>
                <div style={styles.previewTitle}>Sprite</div>
                {spriteUrl ? <img src={spriteUrl} alt="sprite" style={styles.previewImage} /> : <div style={styles.emptyPreview}>Nessuno sprite</div>}
              </div>
            </div>
          </section>

          <section style={{ ...styles.panel, display: activeTab === "ai" ? "block" : "none" }}>
            <div style={styles.sectionHead}>
              <div>
                <h2 style={styles.sectionTitle}>AI e immagini</h2>
                <div style={styles.sectionMeta}>Gemini, Pollinations, invio sprite</div>
              </div>
              <button onClick={handleGenerateImage} disabled={!frame || !prompt || isCapturing} style={btn(styles.secondaryButton, !frame || !prompt || isCapturing)}>
                Genera immagine
              </button>
            </div>

            <div style={styles.formStack}>
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="Gemini API key"
                style={styles.field}
              />
              <input
                type="password"
                value={pollinationsApiKey}
                onChange={(e) => setPollinationsApiKey(e.target.value)}
                placeholder="Pollinations publishable key"
                style={styles.field}
              />
              <textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Prompt"
                style={styles.textarea}
              />
              <button
                onClick={handleSend}
                disabled={!prompt || !geminiApiKey.trim()}
                style={btn(styles.primaryButton, !prompt || !geminiApiKey.trim())}
              >
                Invia a Gemini e Frame
              </button>
            </div>

            <div style={styles.responseBox}>
              <div style={styles.previewTitle}>Risposta Gemini</div>
              <pre style={styles.responsePre}>{response || "Nessuna risposta"}</pre>
            </div>
          </section>

          <section style={{ ...styles.panel, display: activeTab === "logs" ? "block" : "none" }}>
            <div style={styles.sectionHead}>
              <div>
                <h2 style={styles.sectionTitle}>Diagnostica</h2>
                <div style={styles.sectionMeta}>Stato operativo e log BLE</div>
              </div>
              <button onClick={() => setLogs([])} style={styles.ghostButton}>Svuota log</button>
            </div>
            <div style={styles.statusBox}>{status}</div>
            <pre style={styles.logs}>{logs.join("\n") || "Nessun log"}</pre>
          </section>
        </section>

        <aside style={styles.sidePanel}>
          <div style={styles.sideBlock}>
            <div style={styles.sideTitle}>Frame</div>
            <button onClick={handleConnect} disabled={!!frame} style={btn(styles.primaryButton, !!frame)}>Connetti e carica</button>
            <button onClick={handleDashboard} disabled={!frame} style={btn(styles.secondaryButton, !frame)}>Dashboard</button>
            <button onClick={handleClear} disabled={!frame} style={btn(styles.ghostButton, !frame)}>Pulisci display</button>
            <button onClick={handleDisconnect} disabled={!frame} style={btn(styles.dangerButton, !frame)}>Disconnetti</button>
          </div>

          <div style={styles.sideBlock}>
            <div style={styles.sideTitle}>Mappa live</div>
            <button onClick={startAutoUpdate} disabled={!frame || isCapturing} style={btn(styles.secondaryButton, !frame || isCapturing)}>Auto mappa</button>
            <button onClick={stopAutoUpdate} style={styles.ghostButton}>Stop auto</button>
          </div>

          <div style={styles.sideBlock}>
            <div style={styles.sideTitle}>Stato</div>
            <div style={styles.statusBox}>{status}</div>
          </div>
        </aside>
      </main>
    </div>
  );
}

/* ─────────────── Styles ─────────────── */
const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100vh",
    padding: 18,
    backgroundColor: "#f4f1e8",
    color: "#171717",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
    maxWidth: 1180,
    margin: "0 auto 14px",
  },
  brandGroup: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  logoMark: {
    width: 44,
    height: 44,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    backgroundColor: "#1f2a44",
    color: "#fff",
    fontWeight: 800,
    letterSpacing: 0,
  },
  header: {
    margin: 0,
    fontSize: 24,
    lineHeight: 1.05,
    color: "#161616",
  },
  subHeader: {
    marginTop: 4,
    color: "#666052",
    fontSize: 13,
    fontWeight: 700,
  },
  connectionPill: {
    minWidth: 92,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid #d7d0c2",
    backgroundColor: "#fffaf0",
    color: "#7c2d12",
    textAlign: "center",
    fontWeight: 800,
  },
  connectionOn: {
    backgroundColor: "#dcfce7",
    borderColor: "#86efac",
    color: "#166534",
  },
  tabBar: {
    maxWidth: 1180,
    margin: "0 auto 14px",
    display: "flex",
    gap: 6,
    overflowX: "auto",
    padding: 4,
    borderRadius: 8,
    backgroundColor: "#e7decc",
  },
  tabButton: {
    minWidth: 96,
    padding: "10px 14px",
    borderRadius: 6,
    border: "1px solid transparent",
    backgroundColor: "transparent",
    color: "#4a4032",
    fontWeight: 800,
    cursor: "pointer",
  },
  tabButtonActive: {
    backgroundColor: "#ffffff",
    borderColor: "#d7d0c2",
    color: "#171717",
    boxShadow: "0 1px 3px rgba(20, 18, 15, .12)",
  },
  appLayout: {
    maxWidth: 1180,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 280px",
    gap: 14,
    alignItems: "start",
  },
  workspace: {
    minWidth: 0,
  },
  panel: {
    minWidth: 0,
    padding: 16,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    border: "1px solid #ddd4c5",
    boxShadow: "0 8px 28px rgba(58, 48, 34, .10)",
  },
  sidePanel: {
    display: "grid",
    gap: 12,
    position: "sticky",
    top: 12,
  },
  sideBlock: {
    display: "grid",
    gap: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#2f2a45",
    color: "#fff",
    boxShadow: "0 8px 24px rgba(47, 42, 69, .18)",
  },
  sideTitle: {
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    color: "#d8d3ef",
  },
  sectionHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  sectionTitle: {
    margin: 0,
    fontSize: 22,
    color: "#171717",
  },
  sectionMeta: {
    marginTop: 4,
    color: "#6b6255",
    fontSize: 13,
    fontWeight: 700,
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
    gap: 8,
    marginBottom: 12,
  },
  metricBox: {
    minWidth: 0,
    padding: 10,
    borderRadius: 6,
    backgroundColor: "#f7f4ed",
    border: "1px solid #e3dacd",
  },
  metricLabel: {
    display: "block",
    fontSize: 12,
    fontWeight: 900,
    color: "#7b6f61",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  metricValue: {
    display: "block",
    color: "#171717",
    fontSize: 14,
    overflowWrap: "anywhere",
  },
  inlineControls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  mapView: {
    width: "100%",
    minHeight: 430,
    height: "min(58vh, 560px)",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#e5e7eb",
    border: "1px solid #cfc7ba",
    touchAction: "pan-x pan-y",
  },
  mapShell: {
    position: "relative",
    minWidth: 0,
  },
  mapHud: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    zIndex: 900,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "rgba(34, 31, 47, .92)",
    color: "#f8fafc",
    boxShadow: "0 8px 24px rgba(0, 0, 0, .22)",
    pointerEvents: "none",
  },
  mapHudKicker: {
    marginBottom: 5,
    color: "#bae6fd",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  mapHudInstruction: {
    fontSize: 17,
    fontWeight: 900,
    lineHeight: 1.22,
    overflowWrap: "anywhere",
  },
  mapHudMeta: {
    marginTop: 5,
    color: "#e5e7eb",
    fontSize: 12,
    fontWeight: 800,
  },
  navCard: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#221f2f",
    color: "#f8fafc",
  },
  navInstruction: {
    fontSize: 20,
    fontWeight: 900,
    lineHeight: 1.2,
    overflowWrap: "anywhere",
  },
  navMeta: {
    marginTop: 6,
    color: "#d8d3ef",
    fontSize: 13,
    fontWeight: 800,
  },
  directionsList: {
    display: "grid",
    gap: 6,
    marginBottom: 12,
    maxHeight: 260,
    overflowY: "auto",
  },
  directionItem: {
    display: "grid",
    gridTemplateColumns: "32px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid #ddd4c5",
    backgroundColor: "#fffdf8",
    color: "#171717",
    cursor: "pointer",
    textAlign: "left",
  },
  directionItemActive: {
    borderColor: "#0f766e",
    backgroundColor: "#e6fffa",
  },
  directionIndex: {
    width: 26,
    height: 26,
    borderRadius: 6,
    display: "grid",
    placeItems: "center",
    backgroundColor: "#2f2a45",
    color: "#fff",
    fontWeight: 900,
    fontSize: 12,
  },
  directionText: {
    minWidth: 0,
    fontWeight: 800,
    overflowWrap: "anywhere",
  },
  directionDistance: {
    color: "#6b6255",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  inlineError: {
    marginTop: 8,
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: 700,
  },
  primaryButton: {
    minHeight: 40,
    padding: "10px 14px",
    borderRadius: 6,
    border: "1px solid #0f766e",
    backgroundColor: "#0f766e",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  secondaryButton: {
    minHeight: 40,
    padding: "10px 14px",
    borderRadius: 6,
    border: "1px solid #f59e0b",
    backgroundColor: "#f59e0b",
    color: "#241300",
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  ghostButton: {
    minHeight: 40,
    padding: "10px 14px",
    borderRadius: 6,
    border: "1px solid #c9bfaf",
    backgroundColor: "#fffaf0",
    color: "#342c23",
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  dangerButton: {
    minHeight: 40,
    padding: "10px 14px",
    borderRadius: 6,
    border: "1px solid #b91c1c",
    backgroundColor: "#b91c1c",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  compactField: {
    width: 128,
    minHeight: 40,
    padding: "9px 10px",
    borderRadius: 6,
    border: "1px solid #c9bfaf",
    backgroundColor: "#fffdf8",
    color: "#171717",
  },
  field: {
    width: "100%",
    minHeight: 42,
    padding: "9px 10px",
    borderRadius: 6,
    border: "1px solid #c9bfaf",
    backgroundColor: "#fffdf8",
    color: "#171717",
    boxSizing: "border-box",
  },
  textarea: {
    width: "100%",
    minHeight: 112,
    padding: 10,
    borderRadius: 6,
    border: "1px solid #c9bfaf",
    backgroundColor: "#fffdf8",
    color: "#171717",
    resize: "vertical",
    boxSizing: "border-box",
  },
  rangeField: {
    width: "100%",
    minHeight: 42,
    accentColor: "#0f766e",
  },
  fieldLabel: {
    display: "grid",
    gap: 6,
    minWidth: 0,
    color: "#5f5548",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  checkRow: {
    minHeight: 42,
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "#342c23",
    fontWeight: 800,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 10,
    marginTop: 12,
  },
  formStack: {
    display: "grid",
    gap: 10,
  },
  quickGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(68px, 1fr))",
    gap: 8,
    marginTop: 12,
  },
  quickButton: {
    minHeight: 42,
    borderRadius: 6,
    border: "1px solid #c9bfaf",
    backgroundColor: "#fffaf0",
    color: "#171717",
    cursor: "pointer",
    fontWeight: 900,
  },
  paletteGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(34px, 1fr))",
    gap: 8,
    marginTop: 12,
  },
  swatch: {
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: 6,
    border: "2px solid #d4cabb",
    cursor: "pointer",
  },
  swatchActive: {
    outline: "3px solid #0f766e",
    outlineOffset: 2,
  },
  mediaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    marginTop: 12,
  },
  uploadStrip: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f7f4ed",
    border: "1px solid #ddd4c5",
    flexWrap: "wrap",
  },
  fileButton: {
    minHeight: 40,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 14px",
    borderRadius: 6,
    border: "1px solid #0f766e",
    backgroundColor: "#0f766e",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  hiddenInput: {
    display: "none",
  },
  previewBox: {
    minHeight: 260,
    borderRadius: 8,
    border: "1px solid #ddd4c5",
    backgroundColor: "#f7f4ed",
    padding: 10,
  },
  previewTitle: {
    marginBottom: 8,
    color: "#5f5548",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  previewImage: {
    display: "block",
    width: "100%",
    maxHeight: 420,
    objectFit: "contain",
    borderRadius: 6,
    backgroundColor: "#ffffff",
  },
  emptyPreview: {
    minHeight: 220,
    display: "grid",
    placeItems: "center",
    color: "#7b6f61",
    borderRadius: 6,
    border: "1px dashed #c9bfaf",
  },
  responseBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f7f4ed",
    border: "1px solid #ddd4c5",
  },
  responsePre: {
    minHeight: 64,
    margin: 0,
    padding: 12,
    borderRadius: 6,
    backgroundColor: "#221f2f",
    color: "#f8fafc",
    overflowX: "auto",
    whiteSpace: "pre-wrap",
  },
  statusBox: {
    padding: 10,
    borderRadius: 6,
    backgroundColor: "#fffaf0",
    color: "#342c23",
    border: "1px solid #c9bfaf",
    fontSize: 13,
    fontWeight: 800,
    overflowWrap: "anywhere",
  },
  logs: {
    minHeight: 220,
    maxHeight: 420,
    overflowY: "auto",
    margin: 0,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#171717",
    color: "#e5e7eb",
    fontSize: 13,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap",
  },
};
