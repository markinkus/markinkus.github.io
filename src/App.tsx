import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  FrameMsg,
  StdLua,
  TxPlainText,
  TxCaptureSettings,
  TxSprite,
  RxPhoto,
} from "frame-msg";
import type { JpegQuality } from "frame-msg";
import markinoFrameApp from "../lua/markino_frame_app.min.lua?raw";
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
const ROUTE_RECALC_DISTANCE_METERS = 45;
const ROUTE_DESTINATION_CHANGE_METERS = 8;
const NAVIGATION_ZOOM = 19;
const AUTO_MAP_INTERVAL_MS = 18000;
const MAP_SEND_COOLDOWN_MS = 3500;
const NAV_STEP_SWITCH_TOLERANCE_METERS = 8;
const NAV_FRAME_DISTANCE_BUCKET_METERS = 25;
const NAV_FRAME_MIN_AUTO_MS = 8000;
const FRAME_MAP_WIDTH = 640;
const FRAME_MAP_HEIGHT = 400;
const FRAME_MAP_JPEG_QUALITY = 0.58;
const FRAME_MAP_SPRITE_BUDGET = 24000;
const FRAME_IMAGE_SPRITE_BUDGET = 36000;
const FRAME_MIN_SPRITE_BUDGET = 6000;
const FRAME_MAX_SPRITE_BUDGET = 160000;
const FRAME_IMAGE_SCALE_STORAGE_KEY = "markino.frameImageScale";
const FRAME_IMAGE_SCALE_MIN = 50;
const FRAME_IMAGE_SCALE_MAX = 110;
const FRAME_IMAGE_SCALE_STEP = 10;
const DASHBOARD_CONFIG_STORAGE_KEY = "markino.dashboardConfig";
const DASHBOARD_AUTO_DEFAULT_INTERVAL_SECONDS = 5;
const DASHBOARD_AUTO_MIN_INTERVAL_SECONDS = 4;
const DASHBOARD_AUTO_MAX_INTERVAL_SECONDS = 30;
const DASHBOARD_ANIMATION_SPEED_MIN = 1;
const DASHBOARD_ANIMATION_SPEED_MAX = 5;
const LIVE_VIEW_DEFAULT_INTERVAL_SECONDS = 5;
const LIVE_VIEW_MIN_INTERVAL_SECONDS = 3;
const LIVE_VIEW_MAX_INTERVAL_SECONDS = 30;
const LUA_ANIMATION_MSG = 0x30;

type LatLngPoint = { lat: number; lng: number };
type GpsStatus = "checking" | "watching" | "unavailable" | "denied" | "error";
type RouteSummary = {
  distanceMeters: number;
  durationSeconds: number;
};
type RouteVariant = "fallback" | "driving";
type RouteOverlayState = {
  points: string;
  width: number;
  height: number;
  variant: RouteVariant;
};
type RouteStepInfo = {
  instruction: string;
  shortInstruction: string;
  distanceMeters: number;
  durationSeconds: number;
  location: LatLngPoint;
  roadName: string;
  maneuverType: string;
  modifier: string;
  cumulativeMeters: number;
};
type NavigationProgressState = {
  progressMeters: number;
  remainingMeters: number;
  distanceFromRouteMeters: number;
  activeStepIndex: number;
  distanceToInstructionMeters: number;
  isManeuverSoon: boolean;
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
type DashboardModuleKey =
  | "brand"
  | "date"
  | "time"
  | "weather"
  | "route"
  | "gps"
  | "nextStep"
  | "frameVitals"
  | "custom";
type DashboardAnimationMode = "none" | "pulse" | "blink" | "ticker" | "progress" | "turn";
type DashboardColors = Record<DashboardModuleKey, string>;
type DashboardConfig = {
  showBrand: boolean;
  showDate: boolean;
  showTime: boolean;
  showWeather: boolean;
  showRoute: boolean;
  showGps: boolean;
  showNextStep: boolean;
  showFrameVitals: boolean;
  customText: string;
  emoji: string;
  showEmoji: boolean;
  animate: boolean;
  animationMode: DashboardAnimationMode;
  animationSpeed: number;
  autoIntervalSeconds: number;
  colors: DashboardColors;
  fontSize: number;
  maxRows: number;
  width: number;
};
type DashboardItem = {
  key: DashboardModuleKey;
  label: string;
  value: string;
};
type LiveViewMode = "off" | "app" | "screen";

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
const FRAME_LUA_COLORS = [
  "VOID",
  "WHITE",
  "GREY",
  "RED",
  "PINK",
  "DARKBROWN",
  "BROWN",
  "ORANGE",
  "YELLOW",
  "DARKGREEN",
  "GREEN",
  "LIGHTGREEN",
  "NIGHTBLUE",
  "SEABLUE",
  "SKYBLUE",
  "CLOUDBLUE",
];
const QUICK_TEXTS = [":)", ":D", "<3", "OK", "SOS", "!", "?", "XD", ":P", "GO"];
const DASHBOARD_ANIMATION_PRESETS: Array<{
  value: DashboardAnimationMode;
  label: string;
  description: string;
}> = [
  { value: "none", label: "Statica", description: "Snapshot pulito, senza effetti." },
  { value: "pulse", label: "Pulse", description: "Emoji e prima riga respirano piano." },
  { value: "blink", label: "Blink", description: "La riga importante lampeggia per attirare l'occhio." },
  { value: "ticker", label: "Ticker", description: "Testo lungo in movimento nella fascia bassa." },
  { value: "progress", label: "Progress", description: "Barra e scanline per dashboard live." },
  { value: "turn", label: "Turn HUD", description: "Freccia grande per indicazioni e svolte." },
];
const CAPTURE_QUALITIES: CaptureQualityOption[] = [
  { label: "Low", value: 1, api: "LOW" },
  { label: "Medium", value: 2, api: "MEDIUM" },
  { label: "High", value: 3, api: "HIGH" },
  { label: "Very high", value: 4, api: "VERY_HIGH" },
];
const DEFAULT_DASHBOARD_COLORS: DashboardColors = {
  brand: "#38bdf8",
  date: "#f8fafc",
  time: "#facc15",
  weather: "#86efac",
  route: "#fb923c",
  gps: "#bae6fd",
  nextStep: "#f43f5e",
  frameVitals: "#c4b5fd",
  custom: "#ffffff",
};
const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  showBrand: true,
  showDate: true,
  showTime: true,
  showWeather: true,
  showRoute: true,
  showGps: false,
  showNextStep: false,
  showFrameVitals: false,
  customText: "",
  emoji: "🧭",
  showEmoji: true,
  animate: false,
  animationMode: "none",
  animationSpeed: 2,
  autoIntervalSeconds: DASHBOARD_AUTO_DEFAULT_INTERVAL_SECONDS,
  colors: DEFAULT_DASHBOARD_COLORS,
  fontSize: 30,
  maxRows: 7,
  width: 600,
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

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeFrameImageScale = (value: number) =>
  Math.round(clampNumber(value, FRAME_IMAGE_SCALE_MIN, FRAME_IMAGE_SCALE_MAX));

const luaColorName = (paletteIndex: number) =>
  FRAME_LUA_COLORS[Math.round(clampNumber(paletteIndex, 1, FRAME_LUA_COLORS.length - 1))] || "WHITE";

const cleanLuaAnimationPart = (value: string, maxLength: number) =>
  value
    .replace(/[|\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const readStoredFrameImageScale = () => {
  if (typeof window === "undefined") return 100;
  const stored = Number.parseInt(
    window.localStorage.getItem(FRAME_IMAGE_SCALE_STORAGE_KEY) || "",
    10,
  );
  return Number.isFinite(stored) ? normalizeFrameImageScale(stored) : 100;
};

const isDashboardAnimationMode = (value: unknown): value is DashboardAnimationMode =>
  typeof value === "string"
  && DASHBOARD_ANIMATION_PRESETS.some((preset) => preset.value === value);

const normalizeDashboardConfig = (value: Partial<DashboardConfig> = {}): DashboardConfig => {
  const legacyAnimate = value.animate ?? DEFAULT_DASHBOARD_CONFIG.animate;
  const animationMode = isDashboardAnimationMode(value.animationMode)
    ? value.animationMode
    : legacyAnimate
      ? "pulse"
      : DEFAULT_DASHBOARD_CONFIG.animationMode;

  return {
    ...DEFAULT_DASHBOARD_CONFIG,
    ...value,
    colors: {
      ...DEFAULT_DASHBOARD_COLORS,
      ...(value.colors ?? {}),
    },
    emoji: (value.emoji ?? DEFAULT_DASHBOARD_CONFIG.emoji).slice(0, 8),
    showEmoji: value.showEmoji ?? DEFAULT_DASHBOARD_CONFIG.showEmoji,
    animate: value.animate ?? animationMode !== "none",
    animationMode,
    animationSpeed: Math.round(clampNumber(
      value.animationSpeed ?? DEFAULT_DASHBOARD_CONFIG.animationSpeed,
      DASHBOARD_ANIMATION_SPEED_MIN,
      DASHBOARD_ANIMATION_SPEED_MAX,
    )),
    autoIntervalSeconds: Math.round(clampNumber(
      value.autoIntervalSeconds ?? DEFAULT_DASHBOARD_CONFIG.autoIntervalSeconds,
      DASHBOARD_AUTO_MIN_INTERVAL_SECONDS,
      DASHBOARD_AUTO_MAX_INTERVAL_SECONDS,
    )),
    fontSize: Math.round(clampNumber(value.fontSize ?? DEFAULT_DASHBOARD_CONFIG.fontSize, 18, 48)),
    maxRows: Math.round(clampNumber(value.maxRows ?? DEFAULT_DASHBOARD_CONFIG.maxRows, 3, 10)),
    width: Math.round(clampNumber(value.width ?? DEFAULT_DASHBOARD_CONFIG.width, 320, 640)),
    customText: (value.customText ?? "").slice(0, 120),
  };
};

const readStoredDashboardConfig = () => {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_CONFIG;
  try {
    const raw = window.localStorage.getItem(DASHBOARD_CONFIG_STORAGE_KEY);
    return raw
      ? normalizeDashboardConfig(JSON.parse(raw) as Partial<DashboardConfig>)
      : DEFAULT_DASHBOARD_CONFIG;
  } catch {
    return DEFAULT_DASHBOARD_CONFIG;
  }
};

const scaledSpriteBudget = (basePixels: number, scalePercent: number) => {
  const scale = normalizeFrameImageScale(scalePercent) / 100;
  return Math.round(
    clampNumber(
      basePixels * scale * scale,
      FRAME_MIN_SPRITE_BUDGET,
      FRAME_MAX_SPRITE_BUDGET,
    ),
  );
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

const rotatePoint = (point: L.Point, center: L.Point, degrees: number) => {
  if (!degrees) return point;
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return L.point(
    center.x + dx * cos - dy * sin,
    center.y + dx * sin + dy * cos,
  );
};

const interpolatePoint = (from: LatLngPoint, to: LatLngPoint, amount: number) => ({
  lat: from.lat + (to.lat - from.lat) * amount,
  lng: from.lng + (to.lng - from.lng) * amount,
});

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
    const segmentMeters = haversineMeters(path[i], path[i + 1]);
    if (walked + segmentMeters >= lookAheadMeters) {
      const remainingMeters = Math.max(0, lookAheadMeters - walked);
      const segmentAmount = segmentMeters > 0 ? remainingMeters / segmentMeters : 0;
      return interpolatePoint(path[i], path[i + 1], segmentAmount);
    }
    walked += segmentMeters;
  }

  return path[path.length - 1] ?? fallback;
};

const routePathWithAnchors = (
  current: LatLngPoint,
  destination: LatLngPoint,
  path: LatLngPoint[],
) => {
  const anchored = path.length > 0 ? [...path] : [current, destination];
  const first = anchored[0];
  const last = anchored[anchored.length - 1];

  if (!first || haversineMeters(current, first) > 3) anchored.unshift(current);
  if (!last || haversineMeters(destination, last) > 3) anchored.push(destination);

  return anchored;
};

const projectPointOnRoute = (
  point: LatLngPoint,
  path: LatLngPoint[],
): { progressMeters: number; totalMeters: number; distanceFromRouteMeters: number } | null => {
  if (path.length < 2) return null;

  const origin = path[0];
  const metersPerLat = 111320;
  const metersPerLng = Math.cos(origin.lat * Math.PI / 180) * 111320;
  const toXY = (value: LatLngPoint) => ({
    x: (value.lng - origin.lng) * metersPerLng,
    y: (value.lat - origin.lat) * metersPerLat,
  });

  const current = toXY(point);
  let walkedMeters = 0;
  let routeMeters = 0;
  let bestProgress = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < path.length - 1; i += 1) {
    const start = toXY(path[i]);
    const end = toXY(path[i + 1]);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segmentMeters = haversineMeters(path[i], path[i + 1]);
    routeMeters += segmentMeters;

    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared > 0
      ? clampNumber(((current.x - start.x) * dx + (current.y - start.y) * dy) / lengthSquared, 0, 1)
      : 0;
    const projected = {
      x: start.x + dx * amount,
      y: start.y + dy * amount,
    };
    const distance = Math.hypot(current.x - projected.x, current.y - projected.y);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestProgress = walkedMeters + segmentMeters * amount;
    }

    walkedMeters += segmentMeters;
  }

  return {
    progressMeters: bestProgress,
    totalMeters: routeMeters,
    distanceFromRouteMeters: bestDistance,
  };
};

const maneuverAlertDistance = (step: RouteStepInfo) => {
  if (step.maneuverType === "arrive") return 35;
  if (step.maneuverType === "depart") return 20;
  if (step.maneuverType === "roundabout" || step.maneuverType === "rotary") return 95;
  if (step.modifier.includes("sharp")) return 90;
  if (step.modifier.includes("slight")) return 65;
  return 80;
};

const buildNavigationState = (
  current: LatLngPoint | null,
  path: LatLngPoint[],
  steps: RouteStepInfo[],
  summaryDistanceMeters?: number,
): NavigationProgressState | null => {
  if (!current || path.length < 2 || steps.length === 0) return null;

  const projection = projectPointOnRoute(current, path);
  if (!projection) return null;

  const progressMeters = projection.progressMeters;
  let currentStepIndex = 0;
  steps.forEach((step, index) => {
    if (step.cumulativeMeters <= progressMeters + NAV_STEP_SWITCH_TOLERANCE_METERS) {
      currentStepIndex = index;
    }
  });

  const nextStepIndex = steps.findIndex(
    (step, index) =>
      index > currentStepIndex &&
      step.cumulativeMeters > progressMeters + NAV_STEP_SWITCH_TOLERANCE_METERS,
  );
  const upcomingIndex = nextStepIndex >= 0 ? nextStepIndex : steps.length - 1;
  const upcomingStep = steps[upcomingIndex];
  const distanceToUpcoming = Math.max(0, upcomingStep.cumulativeMeters - progressMeters);
  const shouldPreviewUpcoming =
    upcomingIndex > currentStepIndex &&
    distanceToUpcoming <= maneuverAlertDistance(upcomingStep);
  const activeStepIndex = shouldPreviewUpcoming ? upcomingIndex : currentStepIndex;
  const activeStep = steps[activeStepIndex];
  const followingStep = steps[activeStepIndex + 1];
  const distanceToInstructionMeters = Math.max(
    0,
    shouldPreviewUpcoming
      ? distanceToUpcoming
      : (followingStep?.cumulativeMeters ?? projection.totalMeters) - progressMeters,
  );

  return {
    progressMeters,
    remainingMeters: Math.max(
      0,
      Math.min(
        projection.totalMeters - progressMeters,
        summaryDistanceMeters ?? Number.POSITIVE_INFINITY,
      ),
    ),
    distanceFromRouteMeters: projection.distanceFromRouteMeters,
    activeStepIndex,
    distanceToInstructionMeters,
    isManeuverSoon: shouldPreviewUpcoming || distanceToInstructionMeters <= maneuverAlertDistance(activeStep),
  };
};

const frameManeuverSymbol = (step: RouteStepInfo) => {
  if (step.maneuverType === "arrive") return "OK";
  if (step.maneuverType === "depart") return "GO";
  if (step.maneuverType === "roundabout" || step.maneuverType === "rotary") return "O";
  if (step.modifier.includes("left")) return "<<";
  if (step.modifier.includes("right")) return ">>";
  if (step.modifier === "straight" || step.maneuverType === "continue") return "^";
  return ">";
};

const applyMapRotation = (map: L.Map, bearing: number) => {
  const mapPane = map.getPane("mapPane");
  if (!mapPane) return;

  const rotation = normalizeDegrees(bearing);
  const size = map.getSize();
  const panePosition = L.DomUtil.getPosition(mapPane) ?? L.point(0, 0);
  const originX = size.x / 2 - panePosition.x;
  const originY = size.y / 2 - panePosition.y;

  const cleanMapTransform = (mapPane.style.transform || "")
    .replace(/\s?rotate\([^)]*\)/g, "")
    .trim();
  mapPane.style.transformOrigin = "";
  mapPane.style.transition = "";
  mapPane.style.transform = cleanMapTransform;

  const paneNames = [
    "tilePane",
    "overlayPane",
    "shadowPane",
    "markerPane",
    "tooltipPane",
    "popupPane",
    "routePane",
  ];

  paneNames.forEach((name) => {
    const pane = map.getPane(name);
    if (!pane) return;

    pane.style.transformOrigin = `${originX}px ${originY}px`;
    pane.style.transition = rotation ? "transform 180ms linear" : "";
    pane.style.transform = rotation ? `rotate(${-rotation}deg)` : "";
  });
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

const normalizeRouteSteps = (route: any, startOffsetMeters = 0): RouteStepInfo[] => {
  const steps = route?.legs?.flatMap((leg: any) => leg.steps || []) || [];
  let cumulativeMeters = startOffsetMeters;

  return steps
    .map((step: any, index: number) => {
      const location = step.maneuver?.location;
      if (!Array.isArray(location) || location.length < 2) return null;
      const stepDistance = step.distance || 0;
      const maneuverType = step.maneuver?.type || "";
      const modifier = step.maneuver?.modifier || "";
      const instruction = buildInstruction(step, index);
      const normalized = {
        instruction,
        shortInstruction: `${instruction} (${formatDistance(stepDistance)})`,
        distanceMeters: stepDistance,
        durationSeconds: step.duration || 0,
        location: { lng: location[0], lat: location[1] },
        roadName: step.name || "",
        maneuverType,
        modifier,
        cumulativeMeters,
      } satisfies RouteStepInfo;
      cumulativeMeters += stepDistance;
      return normalized;
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
    headerActions: {
      ...styles.headerActions,
      flex: "0 0 auto",
      gap: 6,
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
    sideInline: {
      ...styles.sideInline,
      gridTemplateColumns: "76px minmax(0, 1fr)",
    },
    colorGrid: {
      ...styles.colorGrid,
      gridTemplateColumns: isTiny ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
    },
    modalBackdrop: {
      ...styles.modalBackdrop,
      padding: isTiny ? 8 : 12,
      alignItems: "start",
    },
    modalPanel: {
      ...styles.modalPanel,
      maxHeight: isTiny ? "calc(100svh - 16px)" : "calc(100svh - 24px)",
      padding: isTiny ? 10 : 12,
    },
    modalActions: {
      ...styles.modalActions,
      display: "grid",
      gridTemplateColumns: isTiny ? "minmax(0, 1fr)" : "repeat(3, minmax(0, 1fr))",
      justifyContent: "stretch",
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
  const [luaAnimationMode, setLuaAnimationMode] = useState<DashboardAnimationMode>("pulse");
  const [luaAnimationTitle, setLuaAnimationTitle] = useState("BullFrame");
  const [luaAnimationBody, setLuaAnimationBody] = useState("Pronto");
  const [luaAnimationSpeed, setLuaAnimationSpeed] = useState(2);
  const [frameImageScale, setFrameImageScale] = useState(readStoredFrameImageScale);
  const [dashboardConfig, setDashboardConfig] = useState(readStoredDashboardConfig);
  const [showDashboardConfig, setShowDashboardConfig] = useState(false);
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(false);
  const [autoDashboard, setAutoDashboard] = useState(false);
  const [frameVitals, setFrameVitals] = useState("");
  const [liveViewMode, setLiveViewMode] = useState<LiveViewMode>("off");
  const [liveViewIntervalSeconds, setLiveViewIntervalSeconds] = useState(LIVE_VIEW_DEFAULT_INTERVAL_SECONDS);
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
  const [routeVariant, setRouteVariant] = useState<RouteVariant>("fallback");
  const [routeOverlay, setRouteOverlay] = useState<RouteOverlayState | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isRouting, setIsRouting] = useState(false);
  const [autoFrameNavigation, setAutoFrameNavigation] = useState(true);
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
  const appShellRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const autoUpdateRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveViewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveViewStreamRef = useRef<MediaStream | null>(null);
  const liveViewVideoRef = useRef<HTMLVideoElement | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const lastRouteRequestRef = useRef<{ origin: LatLngPoint; destination: LatLngPoint } | null>(null);
  const isSendingMapRef = useRef(false);
  const lastMapSendAtRef = useRef(0);
  const mapSendCountRef = useRef(0);
  const lastAutoNavSendRef = useRef<{ stepIndex: number; bucket: number; sentAt: number } | null>(null);

  const poiList = [
    { name: "Bar", lat: 40.8367, lng: 16.5931 },
    { name: "Casa", lat: 40.8362, lng: 16.5925 },
  ];

  const addLog = (m: string) =>
    setLogs((l) => [...l.slice(-19), `${new Date().toLocaleTimeString()}: ${m}`]);

  useEffect(() => {
    window.localStorage.setItem(FRAME_IMAGE_SCALE_STORAGE_KEY, String(frameImageScale));
  }, [frameImageScale]);

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_CONFIG_STORAGE_KEY, JSON.stringify(dashboardConfig));
  }, [dashboardConfig]);

  const destinationFromInput = (): LatLngPoint | null => {
    const lat = parseCoordinate(destInput.lat);
    const lng = parseCoordinate(destInput.lng);
    if (lat === null || lng === null) return null;
    const point = { lat, lng };
    return isValidLatLng(point) ? point : null;
  };

  const navigationState = useMemo(
    () => buildNavigationState(pos, routePath, routeSteps, routeSummary?.distanceMeters),
    [pos, routePath, routeSteps, routeSummary],
  );

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
      minZoom: 4,
      maxZoom: 21,
      zoomSnap: 0.25,
      zoomDelta: 0.75,
      wheelPxPerZoomLevel: 90,
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
        maxZoom: 21,
        maxNativeZoom: 20,
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
      lastRouteRequestRef.current = null;
      lastAutoNavSendRef.current = null;

      if (map) {
        removeLayer(routeLayer.current, map);
        removeLayer(routeOutlineLayer.current, map);
      }
      routeLayer.current = null;
      routeOutlineLayer.current = null;

      setRouteSummary(null);
      setRouteSteps([]);
      setRoutePath([]);
      setRouteOverlay(null);
      setActiveStepIndex(0);
      setIsRouting(false);
      return;
    }

    const lastRouteRequest = lastRouteRequestRef.current;
    const currentProjection = routePath.length >= 2
      ? projectPointOnRoute(pos, routePath)
      : null;
    const isOffRoute = currentProjection
      ? currentProjection.distanceFromRouteMeters > 40
      : false;
    const canKeepCurrentRoute =
      Boolean(routeLayer.current && lastRouteRequest) &&
      haversineMeters(lastRouteRequest!.origin, pos) < ROUTE_RECALC_DISTANCE_METERS &&
      haversineMeters(lastRouteRequest!.destination, dest) < ROUTE_DESTINATION_CHANGE_METERS &&
      !isOffRoute;

    if (canKeepCurrentRoute) {
      setIsRouting(false);
      return;
    }

    routeAbortRef.current?.abort();

    setRouteSummary(null);
    setRouteSteps([]);
    setRoutePath([]);
    setRouteOverlay(null);
    setActiveStepIndex(0);
    lastAutoNavSendRef.current = null;
    lastRouteRequestRef.current = { origin: pos, destination: dest };

    const controller = new AbortController();
    routeAbortRef.current = controller;
    setIsRouting(true);

    const url =
      `${OSRM_URL}/route/v1/driving/` +
      `${pos.lng},${pos.lat};${dest.lng},${dest.lat}` +
      `?overview=full&geometries=geojson&steps=true`;

    const drawRouteLayers = (
      path: LatLngPoint[],
      variant: RouteVariant,
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
        maneuverType: "continue",
        modifier: "straight",
        cumulativeMeters: 0,
      }]);
      setRoutePath([pos, dest]);
      setRouteVariant("fallback");
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

          const osrmPath = coordinates.map(
            ([lng, lat]: [number, number]) => ({ lat, lng }),
          ) as LatLngPoint[];
          const startOffsetMeters = osrmPath[0] ? haversineMeters(pos, osrmPath[0]) : 0;
          const path = routePathWithAnchors(pos, dest, osrmPath);

          drawRouteLayers(path, "driving");

          setRouteSummary({
            distanceMeters: route.distance,
            durationSeconds: route.duration,
          });
          setRouteSteps(normalizeRouteSteps(route, startOffsetMeters));
          setRoutePath(path);
          setRouteVariant("driving");

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
    const map = leafletMap.current;
    if (!map) {
      setRouteOverlay(null);
      return;
    }

    const path = routePath.length >= 2
      ? routePath
      : pos && dest
        ? [pos, dest]
        : [];

    if (path.length < 2) {
      setRouteOverlay(null);
      return;
    }

    let raf = 0;
    const updateOverlay = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const size = map.getSize();
        if (!size.x || !size.y) {
          setRouteOverlay(null);
          return;
        }

        const center = L.point(size.x / 2, size.y / 2);
        const visualRotation =
          mapOrientation === "route" ? -normalizeDegrees(mapBearing) : 0;
        const points = path
          .map((point) => {
            const projected = map.latLngToContainerPoint([point.lat, point.lng]);
            const visualPoint = rotatePoint(projected, center, visualRotation);
            return `${visualPoint.x.toFixed(1)},${visualPoint.y.toFixed(1)}`;
          })
          .join(" ");

        setRouteOverlay({
          points,
          width: size.x,
          height: size.y,
          variant: routeVariant,
        });
      });
    };

    updateOverlay();
    map.on("move zoom resize viewreset moveend zoomend", updateOverlay);

    return () => {
      window.cancelAnimationFrame(raf);
      map.off("move zoom resize viewreset moveend zoomend", updateOverlay);
    };
  }, [activeTab, dest, mapBearing, mapOrientation, pos, routePath, routeVariant, viewportWidth]);

  useEffect(() => {
    if (!navigationState) return;
    setActiveStepIndex((current) =>
      current === navigationState.activeStepIndex
        ? current
        : navigationState.activeStepIndex,
    );
  }, [navigationState]);

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

  const mapCanvasToFrameJpeg = async (source: HTMLCanvasElement) => {
    const output = document.createElement("canvas");
    output.width = FRAME_MAP_WIDTH;
    output.height = FRAME_MAP_HEIGHT;
    const ctx = output.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile.");

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, output.width, output.height);

    const scale = Math.min(output.width / source.width, output.height / source.height);
    const drawWidth = Math.max(1, Math.round(source.width * scale));
    const drawHeight = Math.max(1, Math.round(source.height * scale));
    const dx = Math.round((output.width - drawWidth) / 2);
    const dy = Math.round((output.height - drawHeight) / 2);
    ctx.drawImage(source, dx, dy, drawWidth, drawHeight);

    return new Promise<Blob>((resolve, reject) =>
      output.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("toBlob mappa fallito")),
        "image/jpeg",
        FRAME_MAP_JPEG_QUALITY,
      ),
    );
  };

  const sendCanvasSnapshotToFrame = async (
    source: HTMLCanvasElement,
    label: string,
    budget = frameMapSpriteBudget,
  ) => {
    if (!frame) {
      setStatus("Connetti prima il Frame.");
      return false;
    }
    if (isCapturing) {
      setStatus("Aspetta la fine della cattura foto.");
      return false;
    }
    if (isSendingMapRef.current) {
      setStatus("Invio immagine già in corso, salto questo frame.");
      return false;
    }
    const now = Date.now();
    if (now - lastMapSendAtRef.current < MAP_SEND_COOLDOWN_MS) {
      setStatus("Troppi update immagine ravvicinati, attendo un attimo.");
      return false;
    }

    isSendingMapRef.current = true;
    lastMapSendAtRef.current = now;

    try {
      const blob = await mapCanvasToFrameJpeg(source);
      const arr = await blob.arrayBuffer();
      const sprite = await TxSprite.fromImageBytes(arr, budget);

      await frame.sendMessage(0x20, sprite.pack());
      addLog(
        `✔ ${label} ${sprite.width}x${sprite.height} scala ${frameImageScale}% ` +
        `${Math.round(arr.byteLength / 1024)}KB`,
      );
      setStatus(`${label} mostrato sul Frame: ${sprite.width}x${sprite.height}.`);
      return true;
    } catch (e: any) {
      addLog(`✖ ${label}: ${e.message || e}`);
      setStatus(`Errore ${label}: ${e.message || e}`);
      return false;
    } finally {
      isSendingMapRef.current = false;
    }
  };

  const captureAppViewportCanvas = async () =>
    html2canvas(appShellRef.current ?? document.body, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#f8fafc",
      scale: 1,
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    });

  const captureScreenCanvas = () => {
    const video = liveViewVideoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new Error("Stream schermo non ancora pronto.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || FRAME_MAP_WIDTH;
    canvas.height = video.videoHeight || FRAME_MAP_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile.");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  const sendLiveViewFrame = async (mode: LiveViewMode) => {
    if (mode === "off") return false;
    const canvas = mode === "screen"
      ? captureScreenCanvas()
      : await captureAppViewportCanvas();
    return sendCanvasSnapshotToFrame(canvas, mode === "screen" ? "Live screen" : "Live app");
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
      return false;
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

  const sendLuaAnimation = async (
    mode: DashboardAnimationMode | "stop" = luaAnimationMode,
    overrides: Partial<{ title: string; body: string; speed: number }> = {},
  ) => {
    if (!frame) {
      setStatus("Connetti prima il Frame.");
      return;
    }

    const finalMode = mode === "none" ? "stop" : mode;
    const title = cleanLuaAnimationPart(overrides.title ?? luaAnimationTitle, 24);
    const body = cleanLuaAnimationPart(overrides.body ?? luaAnimationBody, 48);
    const speed = Math.round(clampNumber(
      overrides.speed ?? luaAnimationSpeed,
      DASHBOARD_ANIMATION_SPEED_MIN,
      DASHBOARD_ANIMATION_SPEED_MAX,
    ));
    const payload = new TextEncoder().encode([
      finalMode,
      title,
      body,
      luaColorName(textColor),
      String(speed),
    ].join("|"));

    try {
      await frame.sendMessage(LUA_ANIMATION_MSG, payload);
      addLog(`✔ lua animation ${finalMode} ${payload.length}B`);
      setStatus(finalMode === "stop" ? "Animazione Lua fermata." : `Animazione Lua ${finalMode} avviata.`);
      return true;
    } catch (e: any) {
      addLog("✖ lua animation: " + e.message);
      setStatus("Errore animazione Lua: " + e.message);
      return false;
    }
  };

  const sendNavigationStepToFrame = async (
    step: RouteStepInfo,
    state: NavigationProgressState | null,
    reason = "manual",
  ) => {
    if (!frame) {
      setStatus("Connetti prima il Frame.");
      return;
    }

    const distanceLine = state
      ? `${state.distanceToInstructionMeters <= 18 ? "ORA" : `tra ${formatDistance(state.distanceToInstructionMeters)}`}`
      : "";
    const remaining = state
      ? `${formatDistance(state.remainingMeters)} restanti`
      : routeSummary
        ? `${formatDistance(routeSummary.distanceMeters)} totali`
        : "";
    const offRoute = state && state.distanceFromRouteMeters > 35
      ? `fuori rotta ${formatDistance(state.distanceFromRouteMeters)}`
      : "";
    const title = `NAV ${frameManeuverSymbol(step)} ${distanceLine}`.trim();
    const body = [step.shortInstruction || step.instruction, remaining, offRoute]
      .filter(Boolean)
      .join(" · ");

    try {
      const sent = await sendLuaAnimation("turn", {
        title,
        body,
        speed: Math.max(luaAnimationSpeed, 3),
      });
      if (!sent) return;
      addLog(`✔ nav ${reason}: ${frameManeuverSymbol(step)} ${step.shortInstruction}`);
      setStatus(`Indicazione Frame: ${frameManeuverSymbol(step)} ${distanceLine}`.trim());
    } catch (e: any) {
      addLog("✖ nav animation: " + e.message);
      setStatus("Errore indicazione: " + e.message);
    }
  };

  const sendNavigationStep = async () => {
    const step = routeSteps[activeStepIndex];
    if (!step) {
      setStatus("Nessuna indicazione disponibile.");
      return;
    }
    await sendNavigationStepToFrame(step, navigationState);
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
      setFrameVitals(String(battMem || ""));
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
      return false;
    }
    setStatus("📸 Snap mappa…");
    addLog("▶ sendMapToFrame");

    try {
      const canvas = await mapToCanvas();
      const sent = await sendCanvasSnapshotToFrame(canvas, "Mappa");
      if (sent) mapSendCountRef.current += 1;
      return sent;
    } catch (e: any) {
      addLog("✖ map error: " + e);
      setStatus("Errore mappa");
      return false;
    }
  };

  const stopLiveView = () => {
    if (liveViewTimerRef.current) {
      clearInterval(liveViewTimerRef.current);
      liveViewTimerRef.current = null;
    }
    liveViewStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveViewStreamRef.current = null;
    liveViewVideoRef.current = null;
    setLiveViewMode("off");
    addLog("■ Live view OFF");
  };

  const startLiveViewLoop = (mode: LiveViewMode) => {
    if (!frame) {
      setStatus("Connetti prima il Frame.");
      return;
    }

    if (liveViewTimerRef.current) {
      clearInterval(liveViewTimerRef.current);
      liveViewTimerRef.current = null;
    }

    const intervalMs = clampNumber(
      liveViewIntervalSeconds,
      LIVE_VIEW_MIN_INTERVAL_SECONDS,
      LIVE_VIEW_MAX_INTERVAL_SECONDS,
    ) * 1000;

    setLiveViewMode(mode);
    setShowDashboardConfig(false);
    void sendLiveViewFrame(mode).catch((e) => {
      addLog(`✖ live ${mode}: ${e.message || e}`);
      setStatus(`Errore live ${mode}: ${e.message || e}`);
    });
    liveViewTimerRef.current = setInterval(() => {
      void sendLiveViewFrame(mode).catch((e) => {
        addLog(`✖ live ${mode}: ${e.message || e}`);
        setStatus(`Errore live ${mode}: ${e.message || e}`);
      });
    }, intervalMs);
    addLog(`▶ Live ${mode} ON ${intervalMs / 1000}s`);
  };

  const startAppLiveView = () => {
    liveViewStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveViewStreamRef.current = null;
    liveViewVideoRef.current = null;
    startLiveViewLoop("app");
  };

  const startScreenLiveView = async () => {
    if (!frame) {
      setStatus("Connetti prima il Frame.");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus("Screen capture non supportato da questo browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();

      liveViewStreamRef.current?.getTracks().forEach((track) => track.stop());
      liveViewStreamRef.current = stream;
      liveViewVideoRef.current = video;
      stream.getVideoTracks()[0]?.addEventListener("ended", stopLiveView, { once: true });
      startLiveViewLoop("screen");
    } catch (e: any) {
      addLog("✖ screen live: " + (e.message || e));
      setStatus("Permesso screen capture negato o non disponibile.");
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
    autoUpdateRef.current = setInterval(() => {
      if (document.hidden) return;
      void sendMapToFrame();
    }, AUTO_MAP_INTERVAL_MS);
    addLog("▶ Auto‐update ON");
  };

  const stopAutoUpdate = () => {
    if (autoUpdateRef.current) {
      clearInterval(autoUpdateRef.current);
      autoUpdateRef.current = null;
      addLog("■ Auto‐update OFF");
    }
  };

  useEffect(() => () => {
    stopAutoUpdate();
    stopLiveView();
  }, []);

  useEffect(() => {
    if (!autoFrameNavigation || !frame || !navigationState || isCapturing) return;

    const step = routeSteps[activeStepIndex];
    if (!step) return;

    const bucket = Math.floor(
      navigationState.distanceToInstructionMeters / NAV_FRAME_DISTANCE_BUCKET_METERS,
    );
    const now = Date.now();
    const last = lastAutoNavSendRef.current;
    const stepChanged = !last || last.stepIndex !== activeStepIndex;
    const bucketChanged = !last || last.bucket !== bucket;
    const enoughTimePassed = !last || now - last.sentAt >= NAV_FRAME_MIN_AUTO_MS;
    const urgentManeuver = navigationState.distanceToInstructionMeters <= 35;
    const shouldSend =
      stepChanged ||
      (navigationState.isManeuverSoon && bucketChanged && (enoughTimePassed || urgentManeuver));

    if (!shouldSend) return;

    lastAutoNavSendRef.current = { stepIndex: activeStepIndex, bucket, sentAt: now };

    if (autoUpdateRef.current && !document.hidden) {
      void sendMapToFrame().then((sent) => {
        if (!sent) void sendNavigationStepToFrame(step, navigationState, "auto fallback");
      });
      return;
    }

    void sendNavigationStepToFrame(step, navigationState, "auto");
  }, [
    activeStepIndex,
    autoFrameNavigation,
    frame,
    isCapturing,
    navigationState,
    routeSteps,
  ]);

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

  const getNavigationCenter = () => pos;

  const zoomMap = (delta: number) => {
    if (!leafletMap.current) return;
    const map = leafletMap.current;
    const nextZoom = Math.max(
      map.getMinZoom(),
      Math.min(map.getMaxZoom(), map.getZoom() + delta),
    );
    const center = followGps ? getNavigationCenter() : null;
    map.setView(center ? [center.lat, center.lng] : map.getCenter(), nextZoom, { animate: false });
    window.setTimeout(() => map.invalidateSize(), 0);
  };

  const fitRouteView = () => {
    if (!leafletMap.current) return;
    const map = leafletMap.current;
    if (routeLayer.current) {
      map.fitBounds(routeLayer.current.getBounds().pad(0.12), { animate: false });
      return;
    }
    if (pos && dest) {
      map.fitBounds(L.latLngBounds([[pos.lat, pos.lng], [dest.lat, dest.lng]]).pad(0.16), {
        animate: false,
      });
      return;
    }
    centerOnGps();
  };

  const focusNavigationView = () => {
    if (!pos || !leafletMap.current) {
      setStatus("GPS non ancora disponibile.");
      return;
    }

    const map = leafletMap.current;
    const center = getNavigationCenter() ?? pos;
    setFollowGps(true);
    map.setView([center.lat, center.lng], Math.max(map.getZoom(), NAVIGATION_ZOOM), {
      animate: false,
    });
    window.setTimeout(() => map.invalidateSize(), 0);
  };

  const clearRoute = () => {
    routeAbortRef.current?.abort();
    lastRouteRequestRef.current = null;
    lastAutoNavSendRef.current = null;
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
    setRouteOverlay(null);
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

      const sprite = await TxSprite.fromImageBytes(imgBytes, frameImageSpriteBudget);
      const pngBytes = sprite.toPngBytes();
      if (pngBytes) setSpriteUrl(blobUrl(pngBytes, "image/png"));

      await frame.sendMessage(0x20, sprite.pack());
      addLog(`✔ sprite Pollinations ${sprite.width}x${sprite.height} scala ${frameImageScale}%`);
      setStatus(`Immagine Pollinations mostrata ${sprite.width}x${sprite.height}.`);
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

      const sprite = await TxSprite.fromImageBytes(bytes, frameImageSpriteBudget);
      const pngBytes = sprite.toPngBytes();
      if (pngBytes) {
        setSpriteUrl(blobUrl(pngBytes, "image/png"));
      }

      if (frame) {
        await frame.sendMessage(0x20, sprite.pack());
        addLog(`✔ immagine galleria ${sprite.width}x${sprite.height} scala ${frameImageScale}%`);
        setStatus(`Immagine galleria inviata ${sprite.width}x${sprite.height}.`);
      } else {
        setStatus(`Immagine pronta ${sprite.width}x${sprite.height}. Connetti il Frame per inviarla.`);
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
      stopLiveView();
      setAutoDashboard(false);
      await frame.stopFrameApp();
      await frame.disconnect();
      setFrame(null);
      setStatus("Disconnesso");
    } catch (e: any) {
      setStatus("Errore disconnect: " + e.message);
    }
  };

  const updateDashboardConfig = (patch: Partial<DashboardConfig>) => {
    setDashboardConfig((current) => normalizeDashboardConfig({ ...current, ...patch }));
  };

  const getDashboardWeatherLine = async () => {
    if (!pos) return "Meteo: n/d";

    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lng}&current_weather=true`,
      );
      const { current_weather: cw } = await res.json();
      return `Meteo: ${cw.temperature}C, vento ${cw.windspeed} km/h`;
    } catch {
      return "Meteo: n/d";
    }
  };

  const composeDashboardItems = (weatherLine: string, now = new Date()): DashboardItem[] => {
    const dateStr = now.toLocaleDateString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
    const timeStr = now.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    const items: DashboardItem[] = [];

    if (dashboardConfig.showBrand) items.push({ key: "brand", label: "BullFrame", value: "Mark - BullVerge" });
    if (dashboardConfig.showDate) items.push({ key: "date", label: "Data", value: dateStr });
    if (dashboardConfig.showTime) items.push({ key: "time", label: "Ora", value: timeStr });
    if (dashboardConfig.showWeather) items.push({ key: "weather", label: "Meteo", value: weatherLine.replace(/^Meteo:\s*/i, "") });
    if (dashboardConfig.showRoute) items.push({ key: "route", label: "Rotta", value: routeLabel });
    if (dashboardConfig.showGps) items.push({ key: "gps", label: "GPS", value: gpsLabel });
    if (dashboardConfig.showNextStep) items.push({ key: "nextStep", label: "Indicazione", value: activeStepLabel });
    if (dashboardConfig.showFrameVitals && frameVitals) {
      items.push({ key: "frameVitals", label: "Frame batt/mem", value: frameVitals });
    }
    if (dashboardConfig.customText.trim()) {
      items.push({ key: "custom", label: "Custom", value: dashboardConfig.customText.trim() });
    }

    return items.length > 0 ? items : [{ key: "custom", label: "Dashboard", value: "Vuota" }];
  };

  const fitCanvasText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
  ) => {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let value = text;
    while (value.length > 4 && ctx.measureText(`${value}...`).width > maxWidth) {
      value = value.slice(0, -1);
    }
    return `${value}...`;
  };

  const renderDashboardCanvas = (items: DashboardItem[], now = new Date()) => {
    const canvas = document.createElement("canvas");
    canvas.width = FRAME_MAP_WIDTH;
    canvas.height = FRAME_MAP_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas dashboard non disponibile.");

    const animationMode = dashboardConfig.animate ? dashboardConfig.animationMode : "none";
    const speedFactor = 0.65 + dashboardConfig.animationSpeed * 0.24;
    const phase = animationMode !== "none" ? Math.floor(now.getTime() / (900 / speedFactor)) % 4 : 0;
    const pulse = animationMode === "pulse" || animationMode === "turn"
      ? 0.72 + 0.28 * Math.sin(now.getTime() / (420 / speedFactor))
      : 1;
    const contentWidth = Math.min(dashboardConfig.width, canvas.width - 32);
    const x = Math.round((canvas.width - contentWidth) / 2);
    const rowHeight = Math.max(34, Math.floor((canvas.height - 40) / dashboardConfig.maxRows));

    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(248, 250, 252, .08)";
    ctx.fillRect(x - 8, 12, contentWidth + 16, canvas.height - 24);

    if (dashboardConfig.showEmoji && dashboardConfig.emoji.trim() && animationMode !== "turn") {
      ctx.globalAlpha = pulse;
      ctx.font = "58px system-ui, Apple Color Emoji, Segoe UI Emoji, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(dashboardConfig.emoji.trim(), canvas.width - 26, 18);
      ctx.globalAlpha = 1;
    }

    items.slice(0, dashboardConfig.maxRows).forEach((item, index) => {
      const y = 24 + index * rowHeight;
      const color = dashboardConfig.colors[item.key] || "#ffffff";
      const animatedSuffix = animationMode === "pulse" && index === 0 ? ".".repeat(phase) : "";
      const dimBlink = animationMode === "blink" && index === 0 && phase % 2 === 1;

      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "800 12px Inter, system-ui, sans-serif";
      ctx.fillStyle = "rgba(248, 250, 252, .72)";
      ctx.fillText(item.label.toUpperCase(), x, y);

      ctx.font = `900 ${dashboardConfig.fontSize}px Inter, system-ui, sans-serif`;
      ctx.globalAlpha = dimBlink ? 0.28 : 1;
      ctx.fillStyle = color;
      ctx.fillText(
        fitCanvasText(ctx, `${item.value}${animatedSuffix}`, contentWidth - 8),
        x,
        y + 13,
      );
      ctx.globalAlpha = 1;
    });

    if (animationMode === "ticker") {
      const tickerText = items.map((item) => `${item.label}: ${item.value}`).join("   |   ");
      const tickerWidth = contentWidth - 20;
      const offset = Math.round((now.getTime() / (34 / speedFactor)) % Math.max(tickerWidth, 1));
      ctx.fillStyle = "rgba(15, 23, 42, .82)";
      ctx.fillRect(x, canvas.height - 48, contentWidth, 30);
      ctx.font = "900 18px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#f8fafc";
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 10, canvas.height - 43, tickerWidth, 24);
      ctx.clip();
      ctx.fillText(tickerText, x + 10 - offset, canvas.height - 41);
      ctx.fillText(tickerText, x + 10 - offset + tickerWidth + 80, canvas.height - 41);
      ctx.restore();
    }

    if (animationMode === "turn") {
      ctx.globalAlpha = pulse;
      ctx.font = "900 78px Inter, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillStyle = "#facc15";
      ctx.fillText(">>>", canvas.width - 24 - phase * 6, 28);
      ctx.globalAlpha = 1;
    }

    if (animationMode === "progress" || animationMode === "pulse") {
      const autoWindowMs = dashboardConfig.autoIntervalSeconds * 1000;
      const progress = (now.getTime() % autoWindowMs) / autoWindowMs;
      ctx.fillStyle = "rgba(20, 184, 166, .22)";
      ctx.fillRect(x, canvas.height - 18, contentWidth, 5);
      ctx.fillStyle = "#14b8a6";
      ctx.fillRect(x, canvas.height - 18, contentWidth * progress, 5);
    }

    return canvas;
  };

  const handleDashboard = async (reason = "manual") => {
    if (!frame) return setStatus("Connetti prima");
    addLog(`▶ showDashboard ${reason}`);

    const items = composeDashboardItems(await getDashboardWeatherLine());
    const canvas = renderDashboardCanvas(items);
    const sent = await sendCanvasSnapshotToFrame(canvas, "Dashboard", frameImageSpriteBudget);
    if (sent) {
      setStatus(reason === "auto" ? "Dashboard auto aggiornata." : "Dashboard inviata.");
      addLog(`✔ dashboard canvas ${dashboardConfig.width}px/${dashboardConfig.fontSize}px/${dashboardConfig.maxRows} righe`);
    }
  };

  const styles = buildResponsiveStyles(viewportWidth);
  const btn = (st: any, dis = false) => ({ ...st, ...(dis ? styles.btnDisabled : {}) });
  const frameMapSpriteBudget = scaledSpriteBudget(FRAME_MAP_SPRITE_BUDGET, frameImageScale);
  const frameImageSpriteBudget = scaledSpriteBudget(FRAME_IMAGE_SPRITE_BUDGET, frameImageScale);
  const handleFrameImageScaleChange = (value: string) => {
    const next = Number.parseInt(value, 10);
    if (Number.isFinite(next)) setFrameImageScale(normalizeFrameImageScale(next));
  };
  const handleLiveViewIntervalChange = (value: string) => {
    const next = Number.parseInt(value, 10);
    if (Number.isFinite(next)) {
      setLiveViewIntervalSeconds(
        Math.round(clampNumber(next, LIVE_VIEW_MIN_INTERVAL_SECONDS, LIVE_VIEW_MAX_INTERVAL_SECONDS)),
      );
    }
  };
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
  const routeOverlayColor = routeOverlay?.variant === "driving" ? "#e11d48" : "#f59e0b";
  const routeOverlayDash = routeOverlay?.variant === "fallback" ? "18 12" : undefined;
  const activeStep = routeSteps[activeStepIndex] || null;
  const activeStepDistanceLabel = navigationState
    ? navigationState.distanceToInstructionMeters <= 18
      ? "ora"
      : `tra ${formatDistance(navigationState.distanceToInstructionMeters)}`
    : "";
  const activeStepLabel = activeStep
    ? `${frameManeuverSymbol(activeStep)} ${activeStep.instruction}${activeStepDistanceLabel ? ` ${activeStepDistanceLabel}` : ""}`
    : routeSummary
      ? "Indicazioni non disponibili"
      : "Imposta una destinazione";
  const dashboardPreviewText = composeDashboardItems("Meteo: live")
    .map((item) => `${item.label}: ${item.value}`)
    .join("\n");
  const dashboardAutoIntervalMs = dashboardConfig.autoIntervalSeconds * 1000;
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

  useEffect(() => {
    if (!autoDashboard || !frame) return;

    let stopped = false;
    const tick = () => {
      if (!document.hidden && !stopped) void handleDashboard("auto");
    };

    tick();
    const timer = setInterval(tick, dashboardAutoIntervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [
    activeStepLabel,
    autoDashboard,
    dashboardConfig,
    dashboardAutoIntervalMs,
    frame,
    frameImageSpriteBudget,
    frameVitals,
    gpsLabel,
    pos,
    routeLabel,
  ]);

  return (
    <div ref={appShellRef} style={styles.shell}>
      <header style={styles.topBar}>
        <div style={styles.brandGroup}>
          <div style={styles.logoMark}>BV</div>
          <div>
            <h1 style={styles.header}>BullFrame</h1>
            <div style={styles.subHeader}>BullVerge's Control center for Frame</div>
          </div>
        </div>
        <div style={styles.headerActions}>
          <button onClick={() => setIsMenuCollapsed((value) => !value)} style={styles.ghostButton}>
            {isMenuCollapsed ? "Apri menu" : "Chiudi menu"}
          </button>
          <div style={{ ...styles.connectionPill, ...(isConnected ? styles.connectionOn : {}) }}>
            {isConnected ? "Connesso" : "Offline"}
          </div>
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

      <main style={isMenuCollapsed ? { ...styles.appLayout, gridTemplateColumns: "minmax(0, 1fr)" } : styles.appLayout}>
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
              <button onClick={focusNavigationView} disabled={!pos} style={btn(styles.ghostButton, !pos)}>
                Vista guida
              </button>
              <button onClick={() => zoomMap(1)} style={styles.ghostButton}>Zoom +</button>
              <button onClick={() => zoomMap(-1)} style={styles.ghostButton}>Zoom -</button>
              <button onClick={fitRouteView} disabled={!pos && !dest} style={btn(styles.ghostButton, !pos && !dest)}>
                Fit rotta
              </button>
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
                  ? navigationState
                    ? `${formatDistance(navigationState.distanceToInstructionMeters)} alla manovra · ${formatDistance(navigationState.remainingMeters)} restanti`
                    : `${formatDistance(activeStep.distanceMeters)} / ${formatDuration(activeStep.durationSeconds)}`
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
              {routeOverlay && (
                <svg
                  aria-hidden="true"
                  viewBox={`0 0 ${routeOverlay.width} ${routeOverlay.height}`}
                  preserveAspectRatio="none"
                  style={styles.routeOverlay}
                >
                  <polyline
                    points={routeOverlay.points}
                    fill="none"
                    stroke="rgba(15, 23, 42, .42)"
                    strokeWidth={routeOverlay.variant === "driving" ? 24 : 22}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={routeOverlayDash}
                  />
                  <polyline
                    points={routeOverlay.points}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={routeOverlay.variant === "driving" ? 18 : 16}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={routeOverlayDash}
                  />
                  <polyline
                    points={routeOverlay.points}
                    fill="none"
                    stroke={routeOverlayColor}
                    strokeWidth={routeOverlay.variant === "driving" ? 10 : 9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={routeOverlayDash}
                  />
                </svg>
              )}
              <div style={styles.mapHud}>
                <div style={styles.mapHudKicker}>
                  {orientationLabel}
                  {routeSummary ? ` · ${routeLabel}` : ""}
                </div>
                <div style={styles.mapHudInstruction}>{activeStepLabel}</div>
                <div style={styles.mapHudMeta}>
                  {activeStep
                    ? navigationState
                      ? `${formatDistance(navigationState.distanceToInstructionMeters)} alla manovra · ${formatDistance(navigationState.remainingMeters)} restanti`
                      : `${formatDistance(activeStep.distanceMeters)} prima del prossimo step`
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

            <div style={styles.subPanel}>
              <div style={styles.sectionHead}>
                <div>
                  <h3 style={styles.subTitle}>Animazioni Lua</h3>
                  <div style={styles.sectionMeta}>Effetti locali leggeri: testo, frecce, ticker e progress bar</div>
                </div>
                <button onClick={() => void sendLuaAnimation("stop")} disabled={!frame} style={btn(styles.ghostButton, !frame)}>
                  Stop animazione
                </button>
              </div>

              <div style={styles.formGrid}>
                <label style={styles.fieldLabel}>
                  Preset
                  <select
                    value={luaAnimationMode}
                    onChange={(e) => setLuaAnimationMode(e.target.value as DashboardAnimationMode)}
                    style={styles.field}
                  >
                    {DASHBOARD_ANIMATION_PRESETS
                      .filter((preset) => preset.value !== "none")
                      .map((preset) => (
                        <option key={preset.value} value={preset.value}>{preset.label}</option>
                      ))}
                  </select>
                </label>
                <label style={styles.fieldLabel}>
                  Velocità
                  <input
                    type="range"
                    min={DASHBOARD_ANIMATION_SPEED_MIN}
                    max={DASHBOARD_ANIMATION_SPEED_MAX}
                    step={1}
                    value={luaAnimationSpeed}
                    onChange={(e) => setLuaAnimationSpeed(Number(e.target.value))}
                    style={styles.rangeField}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Titolo
                  <input
                    type="text"
                    value={luaAnimationTitle}
                    onChange={(e) => setLuaAnimationTitle(e.target.value)}
                    style={styles.field}
                  />
                </label>
                <label style={styles.fieldLabel}>
                  Riga
                  <input
                    type="text"
                    value={luaAnimationBody}
                    onChange={(e) => setLuaAnimationBody(e.target.value)}
                    style={styles.field}
                  />
                </label>
              </div>

              <div style={styles.inlineControls}>
                {DASHBOARD_ANIMATION_PRESETS
                  .filter((preset) => preset.value !== "none")
                  .map((preset) => (
                    <button
                      key={preset.value}
                      onClick={() => {
                        setLuaAnimationMode(preset.value);
                        void sendLuaAnimation(preset.value);
                      }}
                      disabled={!frame}
                      title={preset.description}
                      style={btn(styles.ghostButton, !frame)}
                    >
                      {preset.label}
                    </button>
                  ))}
              </div>
              <div style={styles.inlineHint}>Questi effetti girano nel Lua del Frame: non inviano immagini continue e pesano pochi byte via BLE.</div>
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

        {!isMenuCollapsed && <aside style={styles.sidePanel}>
          <div style={styles.sideBlock}>
            <div style={styles.sideTitle}>Frame</div>
            <button onClick={handleConnect} disabled={!!frame} style={btn(styles.primaryButton, !!frame)}>Connetti e carica</button>
            <button onClick={() => void handleDashboard()} disabled={!frame} style={btn(styles.secondaryButton, !frame)}>Dashboard</button>
            <button onClick={() => setShowDashboardConfig(true)} style={styles.ghostButton}>Config dashboard</button>
            <button onClick={() => setAutoDashboard((value) => !value)} style={styles.ghostButton}>
              Auto dashboard {autoDashboard ? "on" : "off"}
            </button>
            <button onClick={() => void sendLuaAnimation("pulse")} disabled={!frame} style={btn(styles.ghostButton, !frame)}>Lua pulse</button>
            <button onClick={() => void sendLuaAnimation("ticker")} disabled={!frame} style={btn(styles.ghostButton, !frame)}>Lua ticker</button>
            <button
              onClick={() => void sendLuaAnimation("turn", { title: "NAV", body: activeStepLabel, speed: 4 })}
              disabled={!frame}
              style={btn(styles.ghostButton, !frame)}
            >
              Lua freccia
            </button>
            <button onClick={handleClear} disabled={!frame} style={btn(styles.ghostButton, !frame)}>Pulisci display</button>
            <button onClick={handleDisconnect} disabled={!frame} style={btn(styles.dangerButton, !frame)}>Disconnetti</button>
            <div style={styles.sideHint}>Dashboard invia sprite. Le animazioni Lua girano locali sul Frame e usano payload piccoli.</div>
          </div>

          <div style={styles.sideBlock}>
            <div style={styles.sideTitle}>Mappa live</div>
            <button onClick={startAutoUpdate} disabled={!frame || isCapturing} style={btn(styles.secondaryButton, !frame || isCapturing)}>Auto mappa</button>
            <button onClick={stopAutoUpdate} style={styles.ghostButton}>Stop auto</button>
            <button onClick={() => setAutoFrameNavigation((value) => !value)} style={styles.ghostButton}>
              Auto nav {autoFrameNavigation ? "on" : "off"}
            </button>
            <div style={styles.sideHint}>Auto mappa manda lo screenshot della mappa. Auto nav manda la svolta quando arrivi vicino alla manovra.</div>
          </div>

          <div style={styles.sideBlock}>
            <div style={styles.sideTitle}>Immagini Frame</div>
            <label style={styles.sideControl}>
              <span style={styles.sideControlHead}>
                <span>Scala sprite</span>
                <strong>{frameImageScale}%</strong>
              </span>
              <input
                type="range"
                min={FRAME_IMAGE_SCALE_MIN}
                max={FRAME_IMAGE_SCALE_MAX}
                step={FRAME_IMAGE_SCALE_STEP}
                value={frameImageScale}
                onChange={(e) => handleFrameImageScaleChange(e.target.value)}
                style={styles.rangeField}
              />
            </label>
            <div style={styles.sideInline}>
              <input
                type="number"
                min={FRAME_IMAGE_SCALE_MIN}
                max={FRAME_IMAGE_SCALE_MAX}
                step={FRAME_IMAGE_SCALE_STEP}
                value={frameImageScale}
                onChange={(e) => handleFrameImageScaleChange(e.target.value)}
                style={styles.sideNumberField}
              />
              <span style={styles.sideHint}>Mappa {frameMapSpriteBudget.toLocaleString()} px</span>
            </div>
            <div style={styles.sideHint}>Foto/AI {frameImageSpriteBudget.toLocaleString()} px</div>
            <div style={styles.sideHint}>Limite massimo 110%: oltre il Frame satura memoria e BLE.</div>
          </div>

          <div style={styles.sideBlock}>
            <div style={styles.sideTitle}>Live view</div>
            <button onClick={startAppLiveView} disabled={!frame} style={btn(styles.secondaryButton, !frame)}>Live app</button>
            <button onClick={startScreenLiveView} disabled={!frame} style={btn(styles.ghostButton, !frame)}>Live screen</button>
            <button onClick={stopLiveView} disabled={liveViewMode === "off"} style={btn(styles.ghostButton, liveViewMode === "off")}>Stop live</button>
            <div style={styles.sideInline}>
              <input
                type="number"
                min={LIVE_VIEW_MIN_INTERVAL_SECONDS}
                max={LIVE_VIEW_MAX_INTERVAL_SECONDS}
                step={1}
                value={liveViewIntervalSeconds}
                onChange={(e) => handleLiveViewIntervalChange(e.target.value)}
                style={styles.sideNumberField}
              />
              <span style={styles.sideHint}>ogni {liveViewIntervalSeconds}s · {liveViewMode}</span>
            </div>
            <div style={styles.sideHint}>Live app cattura questa web app. Live screen chiede permesso browser per tab/finestra/schermo.</div>
          </div>

          <div style={styles.sideBlock}>
            <div style={styles.sideTitle}>Stato</div>
            <div style={styles.statusBox}>{status}</div>
          </div>
        </aside>}
      </main>

      {showDashboardConfig && (
        <div style={styles.modalBackdrop}>
          <section role="dialog" aria-modal="true" aria-label="Dashboard" style={styles.modalPanel}>
            <div style={styles.sectionHead}>
              <div>
                <h2 style={styles.sectionTitle}>Dashboard</h2>
                <div style={styles.sectionMeta}>{dashboardConfig.width}px · {dashboardConfig.fontSize}px · {dashboardConfig.maxRows} righe</div>
              </div>
              <div style={styles.modalActions}>
                <button onClick={() => setDashboardConfig(DEFAULT_DASHBOARD_CONFIG)} style={styles.ghostButton}>Default</button>
                <button onClick={() => void handleDashboard()} disabled={!frame} style={btn(styles.secondaryButton, !frame)}>Invia</button>
                <button onClick={() => setShowDashboardConfig(false)} style={styles.ghostButton}>Chiudi</button>
              </div>
            </div>

            <div style={styles.formGrid}>
              {([
                ["showBrand", "Brand"],
                ["showDate", "Data"],
                ["showTime", "Ora"],
                ["showWeather", "Meteo"],
                ["showRoute", "Rotta"],
                ["showGps", "GPS"],
                ["showNextStep", "Indicazione"],
                ["showFrameVitals", "Frame batt/mem"],
              ] as Array<[keyof DashboardConfig, string]>).map(([key, label]) => (
                <label key={key} style={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={Boolean(dashboardConfig[key])}
                    onChange={(e) => updateDashboardConfig({ [key]: e.target.checked } as Partial<DashboardConfig>)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div style={styles.inlineHint}>Frame batt/mem mostra la lettura batteria/memoria presa al momento della connessione.</div>

            <div style={styles.formGrid}>
              <label style={styles.fieldLabel}>
                Larghezza
                <input
                  type="number"
                  min={320}
                  max={640}
                  step={20}
                  value={dashboardConfig.width}
                  onChange={(e) => updateDashboardConfig({ width: Number(e.target.value) })}
                  style={styles.field}
                />
              </label>
              <label style={styles.fieldLabel}>
                Font
                <input
                  type="number"
                  min={18}
                  max={48}
                  step={2}
                  value={dashboardConfig.fontSize}
                  onChange={(e) => updateDashboardConfig({ fontSize: Number(e.target.value) })}
                  style={styles.field}
                />
              </label>
              <label style={styles.fieldLabel}>
                Righe
                <input
                  type="number"
                  min={3}
                  max={10}
                  step={1}
                  value={dashboardConfig.maxRows}
                  onChange={(e) => updateDashboardConfig({ maxRows: Number(e.target.value) })}
                  style={styles.field}
                />
              </label>
            </div>

            <div style={styles.formGrid}>
              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={dashboardConfig.showEmoji}
                  onChange={(e) => updateDashboardConfig({ showEmoji: e.target.checked })}
                />
                Emoji
              </label>
              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={dashboardConfig.animate}
                  onChange={(e) => updateDashboardConfig({
                    animate: e.target.checked,
                    animationMode: e.target.checked && dashboardConfig.animationMode === "none"
                      ? "pulse"
                      : dashboardConfig.animationMode,
                  })}
                />
                Animazione
              </label>
              <label style={styles.fieldLabel}>
                Preset canvas
                <select
                  value={dashboardConfig.animationMode}
                  onChange={(e) => updateDashboardConfig({
                    animationMode: e.target.value as DashboardAnimationMode,
                    animate: e.target.value !== "none",
                  })}
                  style={styles.field}
                >
                  {DASHBOARD_ANIMATION_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>{preset.label}</option>
                  ))}
                </select>
              </label>
              <label style={styles.fieldLabel}>
                Auto ogni sec
                <input
                  type="number"
                  min={DASHBOARD_AUTO_MIN_INTERVAL_SECONDS}
                  max={DASHBOARD_AUTO_MAX_INTERVAL_SECONDS}
                  step={1}
                  value={dashboardConfig.autoIntervalSeconds}
                  onChange={(e) => updateDashboardConfig({ autoIntervalSeconds: Number(e.target.value) })}
                  style={styles.field}
                />
              </label>
              <label style={styles.fieldLabel}>
                Velocità canvas
                <input
                  type="range"
                  min={DASHBOARD_ANIMATION_SPEED_MIN}
                  max={DASHBOARD_ANIMATION_SPEED_MAX}
                  step={1}
                  value={dashboardConfig.animationSpeed}
                  onChange={(e) => updateDashboardConfig({ animationSpeed: Number(e.target.value) })}
                  style={styles.rangeField}
                />
              </label>
              <label style={styles.fieldLabel}>
                Emoji dashboard
                <input
                  type="text"
                  value={dashboardConfig.emoji}
                  onChange={(e) => updateDashboardConfig({ emoji: e.target.value })}
                  style={styles.field}
                />
              </label>
            </div>

            <div style={styles.colorGrid}>
              {([
                ["brand", "Brand"],
                ["date", "Data"],
                ["time", "Ora"],
                ["weather", "Meteo"],
                ["route", "Rotta"],
                ["gps", "GPS"],
                ["nextStep", "Indicazione"],
                ["frameVitals", "Frame"],
                ["custom", "Custom"],
              ] as Array<[DashboardModuleKey, string]>).map(([key, label]) => (
                <label key={key} style={styles.colorField}>
                  <span>{label}</span>
                  <input
                    type="color"
                    value={dashboardConfig.colors[key]}
                    onChange={(e) => updateDashboardConfig({
                      colors: {
                        ...dashboardConfig.colors,
                        [key]: e.target.value,
                      },
                    })}
                  />
                </label>
              ))}
            </div>

            <label style={styles.fieldLabel}>
              Testo custom
              <textarea
                rows={3}
                value={dashboardConfig.customText}
                onChange={(e) => updateDashboardConfig({ customText: e.target.value })}
                style={styles.textarea}
              />
            </label>

            <div style={styles.responseBox}>
              <div style={styles.previewTitle}>Anteprima</div>
              <pre style={styles.responsePre}>{dashboardPreviewText}</pre>
            </div>
          </section>
        </div>
      )}
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
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
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
  subPanel: {
    marginTop: 14,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f7f4ed",
    border: "1px solid #ddd4c5",
  },
  subTitle: {
    margin: 0,
    color: "#171717",
    fontSize: 16,
    lineHeight: 1.2,
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
  sideControl: {
    display: "grid",
    gap: 6,
    gridColumn: "1 / -1",
    minWidth: 0,
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: 800,
  },
  sideControlHead: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    color: "#f8fafc",
  },
  sideInline: {
    display: "grid",
    gridTemplateColumns: "84px minmax(0, 1fr)",
    alignItems: "center",
    gap: 8,
    gridColumn: "1 / -1",
    minWidth: 0,
  },
  sideNumberField: {
    width: "100%",
    minHeight: 36,
    padding: "8px 9px",
    borderRadius: 6,
    border: "1px solid #9b927f",
    backgroundColor: "#fffdf8",
    color: "#171717",
    fontWeight: 900,
    boxSizing: "border-box",
  },
  sideHint: {
    gridColumn: "1 / -1",
    color: "#d8d3ef",
    fontSize: 12,
    fontWeight: 800,
    overflowWrap: "anywhere",
  },
  inlineHint: {
    marginTop: 8,
    color: "#6b6255",
    fontSize: 12,
    fontWeight: 800,
  },
  colorGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: 10,
    marginTop: 12,
  },
  colorField: {
    minHeight: 42,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: 8,
    borderRadius: 6,
    border: "1px solid #ddd4c5",
    backgroundColor: "#f7f4ed",
    color: "#342c23",
    fontSize: 12,
    fontWeight: 900,
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    display: "grid",
    placeItems: "center",
    padding: 18,
    backgroundColor: "rgba(21, 18, 12, .46)",
  },
  modalPanel: {
    width: "min(760px, 100%)",
    maxHeight: "calc(100vh - 36px)",
    overflowY: "auto",
    padding: 16,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    border: "1px solid #ddd4c5",
    boxShadow: "0 18px 52px rgba(21, 18, 12, .24)",
  },
  modalActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
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
  routeOverlay: {
    position: "absolute",
    inset: 0,
    zIndex: 760,
    width: "100%",
    height: "100%",
    borderRadius: 8,
    overflow: "hidden",
    pointerEvents: "none",
    transformOrigin: "50% 50%",
    transition: "transform 180ms linear",
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
