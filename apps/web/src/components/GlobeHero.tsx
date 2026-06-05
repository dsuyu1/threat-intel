"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import * as topojson from "topojson-client";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

import type { CountryActorSummary, CountryHeat } from "../lib/country-heat";
import { isoNumericToIso2, isoNumericToRgb, rgbToIsoNumeric } from "../lib/iso-numeric";
import { OrbitLoader } from "./OrbitLoader";

// ─── Config ───────────────────────────────────────────────────────────────────

const GLOBE_RADIUS = 2;
const OVERLAY_RADIUS = GLOBE_RADIUS + 0.0025;
const GRID_RADIUS = GLOBE_RADIUS + 0.0015;

// 2:1 equirectangular canvas, matches Three's SphereGeometry UV mapping
const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = 1024;

// Visual constants (keep stable to avoid flicker between theme renders)
const LAND_BASE_FILL_STYLE_DARK = "rgba(3,3,5,0.92)"; // almost black land (no attributed actors)
const LAND_BASE_FILL_STYLE_LIGHT = "rgba(252,252,253,0.92)"; // almost white land (no attributed actors)
const COUNTRY_BORDER_COLOR_HEX_DARK = 0x52525b; // zinc-600
const COUNTRY_BORDER_COLOR_HEX_LIGHT = 0xd4d4d8; // zinc-300
const COUNTRY_BORDER_OPACITY_DARK = 0.35;
const COUNTRY_BORDER_OPACITY_LIGHT = 0.65;
const COUNTRY_BORDER_STROKE_STYLE_DARK = "rgba(82,82,91,0.38)";
const COUNTRY_BORDER_STROKE_STYLE_LIGHT = "rgba(212,212,216,0.75)";
const OCEAN_GRID_STROKE_STYLE = "rgba(82,82,91,0.18)";

const ACTOR_LIST_MAX_VISIBLE_ROWS = 10;
const ACTOR_ROW_HEIGHT_PX = 56;
const SIDEBAR_HANDLE_W = 36;
const SIDEBAR_MARGIN_PX = 16; // Tailwind `left-4` / `top-4`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

type StatTone = "hot" | "cool";
type Rgb = { r: number; g: number; b: number };

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const tt = clamp01(t);
  return {
    r: Math.round(a.r + (b.r - a.r) * tt),
    g: Math.round(a.g + (b.g - a.g) * tt),
    b: Math.round(a.b + (b.b - a.b) * tt),
  };
}

function rgbCss(c: Rgb) {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function statTextGradient(t: number, tone: StatTone): string {
  const neutral: Rgb = { r: 228, g: 228, b: 231 }; // zinc-200
  const target: Rgb = tone === "hot" ? { r: 239, g: 68, b: 68 } : { r: 34, g: 197, b: 94 };

  const c1 = mixRgb(neutral, target, clamp01(t * 0.75));
  const c2 = mixRgb(neutral, target, clamp01(t));

  return `linear-gradient(90deg, ${rgbCss(c1)}, ${rgbCss(c2)})`;
}

function latLngToVec3(lat: number, lng: number, r = GLOBE_RADIUS): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

function createHeatNormalizer(values: number[]): (heat: number) => number {
  const sorted = values
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (sorted.length === 0) return () => 0;

  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1]!;
  const max = Math.max(p95, sorted[sorted.length - 1]!);
  const denom = Math.log1p(max);

  return (heat: number) => {
    const h = Math.max(0, Math.min(heat, max));
    return denom === 0 ? 0 : clamp01(Math.log1p(h) / denom);
  };
}

function heatToFillStyle(t: number): string {
  // Tailwind red-500, vary intensity via alpha + slight darkening
  const tt = clamp01(t);
  const r = 239;
  const g = Math.round(68 * (1 - tt * 0.75));
  const b = Math.round(68 * (1 - tt * 0.75));
  const a = 0.06 + tt * 0.55;
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

type CountryFeature = Feature<Polygon | MultiPolygon, { name?: string }> & {
  id?: string | number;
};

function getFeatureIsoNumeric(feature: CountryFeature): number | null {
  const raw = feature.id;
  const numeric = raw == null ? NaN : Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  // world-atlas@2 includes Kosovo as a country but omits the numeric id in this dataset
  if (feature.properties?.name === "Kosovo") return 983;
  return null;
}

type ProjectedPoint = { x: number; y: number };

function projectRing(ring: number[][]): { points: ProjectedPoint[]; minX: number; maxX: number } {
  const points: ProjectedPoint[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let prevLngAdj: number | null = null;

  for (const coord of ring) {
    const lng = coord[0] ?? 0;
    const lat = coord[1] ?? 0;

    let lngAdj = lng;
    if (prevLngAdj != null) {
      const delta = lngAdj - prevLngAdj;
      if (delta > 180) lngAdj -= 360;
      else if (delta < -180) lngAdj += 360;
    }
    prevLngAdj = lngAdj;

    const x = ((lngAdj + 180) / 360) * TEXTURE_WIDTH;
    const y = ((90 - lat) / 180) * TEXTURE_HEIGHT;
    points.push({ x, y });
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }

  return { points, minX, maxX };
}

function fillPolygon(
  ctx: CanvasRenderingContext2D,
  rings: number[][][],
  fillStyle: string
) {
  const projected = rings.map((r) => projectRing(r));
  const minX = Math.min(...projected.map((p) => p.minX));
  const maxX = Math.max(...projected.map((p) => p.maxX));

  const offsets: number[] = [0];
  if (maxX > TEXTURE_WIDTH) offsets.push(-TEXTURE_WIDTH);
  if (minX < 0) offsets.push(TEXTURE_WIDTH);

  for (const offsetX of offsets) {
    ctx.beginPath();
    for (const ring of projected) {
      const pts = ring.points;
      if (pts.length === 0) continue;
      ctx.moveTo(pts[0]!.x + offsetX, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i]!;
        ctx.lineTo(p.x + offsetX, p.y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = fillStyle;
    ctx.fill("evenodd");
  }
}

function fillGeometry(
  ctx: CanvasRenderingContext2D,
  geom: Polygon | MultiPolygon,
  fillStyle: string
) {
  if (geom.type === "Polygon") fillPolygon(ctx, geom.coordinates, fillStyle);
  else for (const poly of geom.coordinates) fillPolygon(ctx, poly, fillStyle);
}

function strokePolygon(
  ctx: CanvasRenderingContext2D,
  rings: number[][][],
  strokeStyle: string,
  lineWidth: number
) {
  const projected = rings.map((r) => projectRing(r));
  const minX = Math.min(...projected.map((p) => p.minX));
  const maxX = Math.max(...projected.map((p) => p.maxX));

  const offsets: number[] = [0];
  if (maxX > TEXTURE_WIDTH) offsets.push(-TEXTURE_WIDTH);
  if (minX < 0) offsets.push(TEXTURE_WIDTH);

  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;

  for (const offsetX of offsets) {
    ctx.beginPath();
    for (const ring of projected) {
      const pts = ring.points;
      if (pts.length === 0) continue;
      ctx.moveTo(pts[0]!.x + offsetX, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i]!;
        ctx.lineTo(p.x + offsetX, p.y);
      }
      ctx.closePath();
    }
    ctx.stroke();
  }
}

function strokeGeometry(
  ctx: CanvasRenderingContext2D,
  geom: Polygon | MultiPolygon,
  strokeStyle: string,
  lineWidth: number
) {
  if (geom.type === "Polygon") strokePolygon(ctx, geom.coordinates, strokeStyle, lineWidth);
  else for (const poly of geom.coordinates) strokePolygon(ctx, poly, strokeStyle, lineWidth);
}

function buildIdCanvas(features: CountryFeature[]) {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas not supported");
  ctx.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  const nameByIso2 = new Map<string, string>();

  for (const f of features) {
    if (!f.geometry) continue;
    const numeric = getFeatureIsoNumeric(f);
    if (!numeric) continue;
    const { r, g, b } = isoNumericToRgb(numeric);
    fillGeometry(ctx, f.geometry, `rgb(${r},${g},${b})`);

    const iso2 = isoNumericToIso2(numeric);
    const name = f.properties?.name ?? null;
    if (iso2 && name) nameByIso2.set(iso2, name);
  }

  const img = ctx.getImageData(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  return {
    idData: img.data,
    nameByIso2,
  };
}

function drawOceanGraticule(params: {
  ctx: CanvasRenderingContext2D;
  idData: Uint8ClampedArray;
  stepDegrees?: number;
  strokeStyle?: string;
}) {
  const step = params.stepDegrees ?? 10;
  const { ctx, idData } = params;

  ctx.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  ctx.lineWidth = 1;
  ctx.strokeStyle = params.strokeStyle ?? OCEAN_GRID_STROKE_STYLE;

  // Parallels (latitude) — straight lines in equirectangular projection.
  for (let lat = -80; lat <= 80; lat += step) {
    const y = ((90 - lat) / 180) * TEXTURE_HEIGHT;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(TEXTURE_WIDTH, y);
    ctx.stroke();
  }

  // Meridians (longitude).
  for (let lng = -180; lng < 180; lng += step) {
    const x = ((lng + 180) / 360) * TEXTURE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TEXTURE_HEIGHT);
    ctx.stroke();
  }

  // Mask out land using the ID canvas: any non-zero RGB means "country pixel".
  const img = ctx.getImageData(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    if ((idData[i] ?? 0) || (idData[i + 1] ?? 0) || (idData[i + 2] ?? 0)) {
      data[i + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function pickIso2AtUv(params: {
  uv: THREE.Vector2;
  idData: Uint8ClampedArray;
  maxRadius?: number;
}): string | null {
  const { uv, idData } = params;
  const maxRadius = params.maxRadius ?? 6;

  const x0 = clampInt(Math.floor(uv.x * TEXTURE_WIDTH), 0, TEXTURE_WIDTH - 1);
  const y0 = clampInt(Math.floor((1 - uv.y) * TEXTURE_HEIGHT), 0, TEXTURE_HEIGHT - 1);

  const sample = (x: number, y: number) => {
    if (x < 0 || x >= TEXTURE_WIDTH || y < 0 || y >= TEXTURE_HEIGHT) return null;
    const idx = (y * TEXTURE_WIDTH + x) * 4;
    const r = idData[idx] ?? 0;
    const g = idData[idx + 1] ?? 0;
    const b = idData[idx + 2] ?? 0;
    const numeric = rgbToIsoNumeric(r, g, b);
    if (!numeric) return null;
    return isoNumericToIso2(numeric);
  };

  const direct = sample(x0, y0);
  if (direct) return direct;

  // Border pixels can be anti-aliased; probe nearby pixels for a stable ID.
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const hit = sample(x0 + dx, y0 + dy);
        if (hit) return hit;
      }
    }
  }

  return null;
}

function formatHeat(v: number) {
  if (!Number.isFinite(v)) return "0";
  if (v >= 100) return Math.round(v).toString();
  return v.toFixed(2);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  countryHeat: CountryHeat[];
}

type DrawerState = {
  iso2: string;
  name: string;
  heat: number;
  actorCount: number;
  lastSeen: string | null;
  actors: CountryActorSummary[] | null;
  loading: boolean;
  error: string | null;
};

type DrawerRect = { x: number; y: number; w: number; h: number };

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0Zm-8.75-3a.75.75 0 0 1 .75-.75h.01a.75.75 0 1 1 0 1.5H10A.75.75 0 0 1 9.25 7Zm.75 2.25a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 .75-.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function InfoTip({
  title,
  body,
  sourceHref,
  sourceLabel = "country details",
}: {
  title: string;
  body: string;
  sourceHref?: string;
  sourceLabel?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => setOpen(false), 70);
  }, [clearHideTimer]);

  const show = useCallback(() => {
    clearHideTimer();
    setOpen(true);
  }, [clearHideTimer]);

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const width = 280;
    const margin = 10;

    let left = rect.left;
    if (left + width + margin > window.innerWidth) left = window.innerWidth - width - margin;
    if (left < margin) left = margin;

    const estimatedHeight = 170;
    const belowTop = rect.bottom + 8;
    const above = belowTop + estimatedHeight > window.innerHeight;
    const top = above ? rect.top - 8 : rect.bottom + 8;

    setPos({ left, top, above });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();

    const onScrollOrResize = () => updatePos();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, updatePos]);

  useEffect(() => {
    return () => clearHideTimer();
  }, [clearHideTimer]);

  const tooltip =
    open && pos ? (
      <div
        className="fixed z-[9999] w-[280px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 p-2 text-[11px] normal-case text-zinc-700 dark:text-zinc-200 shadow-2xl shadow-black/10 dark:shadow-black/70 backdrop-blur"
        style={{
          left: pos.left,
          top: pos.top,
          transform: pos.above ? "translateY(-100%)" : undefined,
        }}
        role="tooltip"
        onPointerEnter={show}
        onPointerLeave={scheduleHide}
      >
        <div className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
        <div className="mt-1 text-zinc-700 dark:text-zinc-300 leading-snug">{body}</div>
        {sourceHref ? (
          <div className="mt-1 text-zinc-600 dark:text-zinc-400">
            Source:{" "}
            <Link href={sourceHref} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors">
              {sourceLabel}
            </Link>
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <span className="ml-0.5 inline-flex">
      <span
        ref={anchorRef}
        className="inline-flex items-center justify-center text-zinc-500 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        aria-label={`Info: ${title}`}
        tabIndex={0}
        onPointerEnter={show}
        onPointerLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <InfoIcon className="h-3 w-3" />
      </span>
      {tooltip ? createPortal(tooltip, document.body) : null}
    </span>
  );
}

export function GlobeHero({ countryHeat }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const flatCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawerRootRef = useRef<HTMLDivElement>(null);
  const flatBaseRef = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(
    null
  );

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef = useRef<number>(0);
  const groupRef = useRef<THREE.Group | null>(null);
  const globeRef = useRef<THREE.Mesh | null>(null);
  const atmosphereRef = useRef<THREE.Mesh | null>(null);
  const countryLinesRef = useRef<THREE.LineSegments | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);
  const backLightRef = useRef<THREE.DirectionalLight | null>(null);
  const starsRef = useRef<THREE.Points | null>(null);
  const overlayRef = useRef<THREE.Mesh | null>(null);
  const gridRef = useRef<{
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    texture: THREE.CanvasTexture;
    mesh: THREE.Mesh;
  } | null>(null);

  const idDataRef = useRef<Uint8ClampedArray | null>(null);
  const featuresRef = useRef<CountryFeature[] | null>(null);
  const countryNameByIso2Ref = useRef<Map<string, string>>(new Map());

  const shadeRef = useRef<{
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    texture: THREE.CanvasTexture;
  } | null>(null);

  const isDragging = useRef(false);
  const didDrag = useRef(false);
  const prevMouse = useRef({ x: 0, y: 0 });
  const rotVelocity = useRef({ x: 0, y: 0 });
  const zoomTarget = useRef(6);
  const zoomCurrent = useRef(6);

  const [mode, setMode] = useState<"webgl" | "flat">("webgl");
  const [isDark, setIsDark] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [drawerRect, setDrawerRect] = useState<DrawerRect | null>(null);
  const [drawerUserResized, setDrawerUserResized] = useState(false);
  const [mapHover, setMapHover] = useState(false);
  const drawerRectRef = useRef<DrawerRect | null>(null);
  const drawerDragRef = useRef<{
    mode: "move" | "resize" | null;
    pointerId: number | null;
    captureEl: HTMLDivElement | null;
    startX: number;
    startY: number;
    startRect: DrawerRect | null;
  }>({ mode: null, pointerId: null, captureEl: null, startX: 0, startY: 0, startRect: null });
  const fetchSeq = useRef(0);
  const [actorCardsVisible, setActorCardsVisible] = useState(false);
  const actorListRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    drawerRectRef.current = drawerRect;
  }, [drawerRect]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();

    const mo = new MutationObserver(() => update());
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    // WebGL-only: update materials/lights to match theme.
    const globe = globeRef.current;
    if (globe) {
      const mat = globe.material as THREE.MeshPhongMaterial;
      mat.color.setHex(isDark ? 0x0d0d12 : 0xdbeafe); // near-black → light blue
      mat.emissive.setHex(isDark ? 0x06060a : 0x000000);
      mat.opacity = isDark ? 0.97 : 0.96;
      mat.needsUpdate = true;
    }

    const atmos = atmosphereRef.current;
    if (atmos) {
      const mat = atmos.material as THREE.MeshPhongMaterial;
      mat.opacity = isDark ? 0.06 : 0.08;
      mat.needsUpdate = true;
    }

    const ambient = ambientLightRef.current;
    if (ambient) ambient.intensity = isDark ? 0.15 : 0.22;

    const dir = dirLightRef.current;
    if (dir) dir.intensity = isDark ? 1.2 : 0.95;

    const back = backLightRef.current;
    if (back) back.intensity = isDark ? 0.4 : 0.22;

    const stars = starsRef.current;
    if (stars) {
      const mat = stars.material as THREE.PointsMaterial;
      mat.color.setHex(isDark ? 0xffffff : 0x000000);
      mat.opacity = isDark ? 0.85 : 0.18;
      mat.needsUpdate = true;
    }

    const lines = countryLinesRef.current;
    if (lines) {
      const mat = lines.material as THREE.LineBasicMaterial;
      mat.color.setHex(isDark ? COUNTRY_BORDER_COLOR_HEX_DARK : COUNTRY_BORDER_COLOR_HEX_LIGHT);
      mat.opacity = isDark ? COUNTRY_BORDER_OPACITY_DARK : COUNTRY_BORDER_OPACITY_LIGHT;
      mat.needsUpdate = true;
    }
  }, [isDark]);

  const resetDrawerInteraction = useCallback(() => {
    const st = drawerDragRef.current;
    if (st.mode && st.pointerId != null && st.captureEl) {
      try {
        if (st.captureEl.hasPointerCapture(st.pointerId)) st.captureEl.releasePointerCapture(st.pointerId);
      } catch {
        // ignore
      }
    }
    drawerDragRef.current = {
      mode: null,
      pointerId: null,
      captureEl: null,
      startX: 0,
      startY: 0,
      startRect: null,
    };
    document.body.style.userSelect = "";
  }, []);

  const setDotCursorEnabled = useCallback((enabled: boolean) => {
    if (typeof window === "undefined") return;
    (window as any).__tiDotCursorEnabled = enabled;
    window.dispatchEvent(new CustomEvent("ti-dotcursor", { detail: { enabled } }));
  }, []);

  useEffect(() => {
    return () => setDotCursorEnabled(false);
  }, [setDotCursorEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = mode === "flat" ? flatCanvasRef.current : mountRef.current;
    if (!el) return;

    const id = window.setTimeout(() => {
      if (el.matches(":hover")) {
        setMapHover(true);
        setDotCursorEnabled(true);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [mode, setDotCursorEnabled]);

  const heatByIso2Ref = useRef<Map<string, CountryHeat>>(new Map());
  const flatGridRef = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(
    null
  );
  const flatViewRef = useRef<{ width: number; height: number; dpr: number; baseScale: number }>({
    width: 0,
    height: 0,
    dpr: 1,
    baseScale: 1,
  });
  const flatZoomTarget = useRef(1);
  const flatZoomCurrent = useRef(1);
  const flatOffsetRef = useRef({ x: 0, y: 0 });
  const flatInitializedRef = useRef(false);
  const flatIsDragging = useRef(false);
  const flatDidDrag = useRef(false);
  const flatPrevMouse = useRef({ x: 0, y: 0 });

  const displayNames = useMemo(() => {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      return null;
    }
  }, []);

  const countryStatScales = useMemo(() => {
    let maxHeat = 0;
    let maxActors = 0;
    let newest = 0;
    let oldest = Number.POSITIVE_INFINITY;

    for (const c of countryHeat) {
      maxHeat = Math.max(maxHeat, Number(c.heat ?? 0));
      maxActors = Math.max(maxActors, Number(c.actorCount ?? 0));

      const ts =
        c.lastSeen && typeof c.lastSeen === "string" ? Date.parse(c.lastSeen) : Number.NaN;
      if (Number.isFinite(ts)) {
        newest = Math.max(newest, ts);
        oldest = Math.min(oldest, ts);
      }
    }

    if (!Number.isFinite(oldest)) oldest = newest;
    if (!Number.isFinite(newest)) newest = oldest;

    return { maxHeat, maxActors, oldest, newest };
  }, [countryHeat]);

  const redrawShade = useCallback(() => {
    const shade = shadeRef.current;
    const features = featuresRef.current;
    if (!shade || !features) return;

    const heatByIso2 = heatByIso2Ref.current;
    const normalizer = createHeatNormalizer(
      Array.from(heatByIso2.values()).map((v) => v.heat)
    );

    shade.ctx.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

    // Base land fill so countries with no attributed actors are still visible.
    const landFill =
      typeof document !== "undefined" && document.documentElement.classList.contains("dark")
        ? LAND_BASE_FILL_STYLE_DARK
        : LAND_BASE_FILL_STYLE_LIGHT;
    for (const f of features) {
      if (!f.geometry) continue;
      fillGeometry(shade.ctx, f.geometry, landFill);
    }

    for (const f of features) {
      if (!f.geometry) continue;
      const numeric = getFeatureIsoNumeric(f);
      if (!numeric) continue;
      const iso2 = isoNumericToIso2(numeric);
      if (!iso2) continue;
      const heat = heatByIso2.get(iso2)?.heat ?? 0;
      if (heat <= 0) continue;
      fillGeometry(shade.ctx, f.geometry, heatToFillStyle(normalizer(heat)));
    }

    shade.texture.needsUpdate = true;
  }, []);

  const redrawFlat = useCallback(() => {
    const features = featuresRef.current;
    const idData = idDataRef.current;
    if (!features || !idData) return;

    if (!flatBaseRef.current) {
      const baseCanvas = document.createElement("canvas");
      baseCanvas.width = TEXTURE_WIDTH;
      baseCanvas.height = TEXTURE_HEIGHT;
      const baseCtx = baseCanvas.getContext("2d");
      if (!baseCtx) return;
      flatBaseRef.current = { canvas: baseCanvas, ctx: baseCtx };
    }

    const base = flatBaseRef.current;
    const ctx = base.ctx;

    if (!flatGridRef.current) {
      const gridCanvas = document.createElement("canvas");
      gridCanvas.width = TEXTURE_WIDTH;
      gridCanvas.height = TEXTURE_HEIGHT;
      const gridCtx = gridCanvas.getContext("2d", { willReadFrequently: true });
      if (!gridCtx) return;
      flatGridRef.current = { canvas: gridCanvas, ctx: gridCtx };
    }

    const grid = flatGridRef.current;
    drawOceanGraticule({
      ctx: grid.ctx,
      idData,
      stepDegrees: 10,
      strokeStyle: OCEAN_GRID_STROKE_STYLE,
    });

    ctx.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    ctx.fillStyle = isDark ? "#0d0d12" : "#dbeafe";
    ctx.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    ctx.drawImage(grid.canvas, 0, 0);

    const heatByIso2 = heatByIso2Ref.current;
    const normalizer = createHeatNormalizer(
      Array.from(heatByIso2.values()).map((v) => v.heat)
    );

    // Base land fill so countries with no attributed actors are still visible.
    const landFill = isDark ? LAND_BASE_FILL_STYLE_DARK : LAND_BASE_FILL_STYLE_LIGHT;
    for (const f of features) {
      if (!f.geometry) continue;
      fillGeometry(ctx, f.geometry, landFill);
    }

    for (const f of features) {
      if (!f.geometry) continue;
      const numeric = getFeatureIsoNumeric(f);
      if (!numeric) continue;
      const iso2 = isoNumericToIso2(numeric);
      if (!iso2) continue;
      const heat = heatByIso2.get(iso2)?.heat ?? 0;
      if (heat <= 0) continue;
      fillGeometry(ctx, f.geometry, heatToFillStyle(normalizer(heat)));
    }

    // Country borders
    for (const f of features) {
      if (!f.geometry) continue;
      strokeGeometry(
        ctx,
        f.geometry,
        isDark ? COUNTRY_BORDER_STROKE_STYLE_DARK : COUNTRY_BORDER_STROKE_STYLE_LIGHT,
        1
      );
    }
  }, [isDark]);

  const syncFlatCanvasSize = useCallback(() => {
    const root = rootRef.current;
    const canvas = flatCanvasRef.current;
    if (!root || !canvas) return;

    const width = root.clientWidth;
    const height = root.clientHeight;
    if (!width || !height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    flatViewRef.current = {
      width,
      height,
      dpr,
      baseScale: Math.max(width / TEXTURE_WIDTH, height / TEXTURE_HEIGHT),
    };

    const scale = flatViewRef.current.baseScale * flatZoomCurrent.current;
    const maxOffsetY = Math.max(0, TEXTURE_HEIGHT - height / scale);

    if (!flatInitializedRef.current) {
      flatOffsetRef.current.x = mod(
        TEXTURE_WIDTH * 0.5 - width / (2 * scale),
        TEXTURE_WIDTH
      );
      flatOffsetRef.current.y = clamp(
        TEXTURE_HEIGHT * 0.5 - height / (2 * scale),
        0,
        maxOffsetY
      );
      flatInitializedRef.current = true;
    } else {
      flatOffsetRef.current.y = clamp(flatOffsetRef.current.y, 0, maxOffsetY);
    }
  }, []);

  const renderFlatView = useCallback(() => {
    if (mode !== "flat") return;

    const canvas = flatCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const base = flatBaseRef.current;
    const view = flatViewRef.current;
    if (!view.width || !view.height) return;

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.fillStyle = isDark ? "#0b0b0d" : "#ffffff";
    ctx.fillRect(0, 0, view.width, view.height);

    if (!base) {
      ctx.fillStyle = isDark ? "rgba(244,244,245,0.7)" : "rgba(24,24,27,0.65)";
      ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText("Loading map…", 16, 28);
      return;
    }

    const scale = view.baseScale * flatZoomCurrent.current;
    const drawW = TEXTURE_WIDTH * scale;
    const drawH = TEXTURE_HEIGHT * scale;

    const offsetX = mod(flatOffsetRef.current.x, TEXTURE_WIDTH);
    const maxOffsetY = Math.max(0, TEXTURE_HEIGHT - view.height / scale);
    const offsetY = clamp(flatOffsetRef.current.y, 0, maxOffsetY);
    flatOffsetRef.current.x = offsetX;
    flatOffsetRef.current.y = offsetY;

    const ty = -offsetY * scale;
    let xStart = (-offsetX * scale) % drawW;
    if (xStart > 0) xStart -= drawW;

    ctx.imageSmoothingEnabled = true;
    for (let x = xStart; x < view.width; x += drawW) {
      ctx.drawImage(base.canvas, x, ty, drawW, drawH);
    }
  }, [isDark, mode]);

  useEffect(() => {
    heatByIso2Ref.current = new Map(
      countryHeat.map((c) => [c.iso2.trim().toUpperCase(), { ...c, iso2: c.iso2.trim().toUpperCase() }])
    );
    redrawShade();
    redrawFlat();
    renderFlatView();
  }, [countryHeat, redrawFlat, redrawShade, renderFlatView]);

  useEffect(() => {
    redrawShade();
    redrawFlat();
    renderFlatView();
  }, [isDark, redrawFlat, redrawShade, renderFlatView]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const initialDark = document.documentElement.classList.contains("dark");

    // ── Renderer
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      console.warn("[GlobeHero] WebGL unavailable; falling back to 2D map.", err);
      setMode("flat");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ── Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      el.clientWidth / el.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 6);
    cameraRef.current = camera;

    // ── Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // ── Lights
    const ambient = new THREE.AmbientLight(0xffffff, initialDark ? 0.15 : 0.22);
    scene.add(ambient);
    ambientLightRef.current = ambient;

    const dirLight = new THREE.DirectionalLight(0x6366f1, initialDark ? 1.2 : 0.95);
    dirLight.position.set(5, 3, 5);
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    const backLight = new THREE.DirectionalLight(0x1e293b, initialDark ? 0.4 : 0.22);
    backLight.position.set(-5, -3, -5);
    scene.add(backLight);
    backLightRef.current = backLight;

    // ── Starfield (not part of rotating group, so zoom parallax stays)
    const stars = buildStarfield();
    {
      const mat = stars.material as THREE.PointsMaterial;
      mat.color.setHex(initialDark ? 0xffffff : 0x000000);
      mat.opacity = initialDark ? 0.85 : 0.18;
      mat.needsUpdate = true;
    }
    scene.add(stars);
    starsRef.current = stars;

    // ── Globe group
    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const globeMat = new THREE.MeshPhongMaterial({
      color: initialDark ? 0x0d0d12 : 0xdbeafe,
      emissive: initialDark ? 0x06060a : 0x000000,
      shininess: 15,
      transparent: true,
      opacity: initialDark ? 0.97 : 0.96,
    });
    const globeMesh = new THREE.Mesh(globeGeo, globeMat);
    group.add(globeMesh);
    globeRef.current = globeMesh;

    // Ocean-only grid overlay (masked by ID canvas once loaded)
    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = TEXTURE_WIDTH;
    gridCanvas.height = TEXTURE_HEIGHT;
    const gridCtx = gridCanvas.getContext("2d", { willReadFrequently: true });
    if (!gridCtx) throw new Error("2D canvas not supported");
    const gridTexture = new THREE.CanvasTexture(gridCanvas);
    gridTexture.needsUpdate = true;
    const gridGeo = new THREE.SphereGeometry(GRID_RADIUS, 64, 64);
    const gridMat = new THREE.MeshBasicMaterial({
      map: gridTexture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const gridMesh = new THREE.Mesh(gridGeo, gridMat);
    gridMesh.renderOrder = 1;
    group.add(gridMesh);
    gridRef.current = { canvas: gridCanvas, ctx: gridCtx, texture: gridTexture, mesh: gridMesh };

    // Country heat overlay
    const shadeCanvas = document.createElement("canvas");
    shadeCanvas.width = TEXTURE_WIDTH;
    shadeCanvas.height = TEXTURE_HEIGHT;
    const shadeCtx = shadeCanvas.getContext("2d");
    if (!shadeCtx) throw new Error("2D canvas not supported");
    shadeRef.current = {
      canvas: shadeCanvas,
      ctx: shadeCtx,
      texture: new THREE.CanvasTexture(shadeCanvas),
    };
    shadeRef.current.texture.needsUpdate = true;

    const overlayGeo = new THREE.SphereGeometry(OVERLAY_RADIUS, 64, 64);
    const overlayMat = new THREE.MeshBasicMaterial({
      map: shadeRef.current.texture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const overlayMesh = new THREE.Mesh(overlayGeo, overlayMat);
    overlayMesh.renderOrder = 2;
    group.add(overlayMesh);
    overlayRef.current = overlayMesh;

    // Atmosphere glow
    const atmosGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.04, 64, 64);
    const atmosMat = new THREE.MeshPhongMaterial({
      color: 0x1d4ed8,
      transparent: true,
      opacity: initialDark ? 0.06 : 0.08,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
    group.add(atmosMesh);
    atmosphereRef.current = atmosMesh;

    // ── Animation loop
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);

      if (!isDragging.current && groupRef.current) {
        groupRef.current.rotation.y += 0.0015;
        groupRef.current.rotation.y += rotVelocity.current.y;
        groupRef.current.rotation.x += rotVelocity.current.x;
        rotVelocity.current.x *= 0.92;
        rotVelocity.current.y *= 0.92;
        groupRef.current.rotation.x = Math.max(
          -0.5,
          Math.min(0.5, groupRef.current.rotation.x)
        );
      }

      // Smooth zoom — lerp current Z toward target
      zoomCurrent.current += (zoomTarget.current - zoomCurrent.current) * 0.1;
      camera.position.z = zoomCurrent.current;

      // Star twinkle + subtle drift (keep zoom parallax)
      const t = performance.now() * 0.001;
      if (starsRef.current && groupRef.current) {
        starsRef.current.rotation.y = groupRef.current.rotation.y * 0.12;
        starsRef.current.rotation.x = groupRef.current.rotation.x * 0.12;

        const mat = starsRef.current.material as THREE.PointsMaterial;
        const shader = mat.userData["shader"] as
          | { uniforms?: Record<string, { value: number }> }
          | undefined;
        if (shader?.uniforms?.["uTime"]) shader.uniforms["uTime"].value = t;
      }

      renderer.render(scene, camera);
    };
    animate();

    // ── Scroll to zoom
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * 0.01;
      zoomTarget.current = Math.max(3, Math.min(12, zoomTarget.current + delta));
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // ── Resize
    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", onResize);
      el.removeEventListener("wheel", onWheel);

      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
      scene.remove(stars);
      starsRef.current = null;

      if (countryLinesRef.current) {
        const lines = countryLinesRef.current;
        lines.geometry.dispose();
        (lines.material as THREE.Material).dispose();
        countryLinesRef.current = null;
      }

      if (overlayRef.current) {
        const mesh = overlayRef.current;
        mesh.geometry.dispose();
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
        overlayRef.current = null;
      }

      if (gridRef.current) {
        const grid = gridRef.current;
        grid.mesh.geometry.dispose();
        const mat = grid.mesh.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
        gridRef.current = null;
      }

      if (atmosphereRef.current) {
        const mesh = atmosphereRef.current;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        atmosphereRef.current = null;
      }

      if (globeRef.current) {
        const mesh = globeRef.current;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        globeRef.current = null;
      }

      ambientLightRef.current = null;
      dirLightRef.current = null;
      backLightRef.current = null;

      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // World atlas (shared for WebGL + flat fallback): borders + ID canvas for picking/shading.
  useEffect(() => {
    let cancelled = false;
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
      .then((r) => r.json())
      .then((topo) => {
        if (cancelled) return;

        // 3D border lines (if WebGL initialized)
        if (groupRef.current && !countryLinesRef.current) {
          const lines = buildCountryLines(topo) as THREE.LineSegments;
          {
            const dark = document.documentElement.classList.contains("dark");
            const mat = lines.material as THREE.LineBasicMaterial;
            mat.color.setHex(dark ? COUNTRY_BORDER_COLOR_HEX_DARK : COUNTRY_BORDER_COLOR_HEX_LIGHT);
            mat.opacity = dark ? COUNTRY_BORDER_OPACITY_DARK : COUNTRY_BORDER_OPACITY_LIGHT;
            mat.needsUpdate = true;
          }
          groupRef.current.add(lines);
          countryLinesRef.current = lines;
        }

        const geojson = topojson.feature(
          topo as never,
          (topo as any).objects.countries
        ) as unknown as FeatureCollection<Polygon | MultiPolygon, { name?: string }>;

        const features = (geojson.features ?? []) as CountryFeature[];
        featuresRef.current = features;

        const { idData, nameByIso2 } = buildIdCanvas(features);
        idDataRef.current = idData;
        countryNameByIso2Ref.current = nameByIso2;

        // Now that we have a land mask, draw the graticule only on oceans (WebGL texture).
        if (gridRef.current) {
          drawOceanGraticule({
            ctx: gridRef.current.ctx,
            idData,
            stepDegrees: 10,
            strokeStyle: OCEAN_GRID_STROKE_STYLE,
          });
          gridRef.current.texture.needsUpdate = true;
        }

        redrawShade();
        redrawFlat();
        renderFlatView();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [redrawFlat, redrawShade, renderFlatView]);

  // ── Pointer events
  // Flat mode: keep the full-bleed canvas sized to the viewport.
  useEffect(() => {
    if (mode !== "flat") return;

    const root = rootRef.current;
    if (!root) return;

    const update = () => {
      syncFlatCanvasSize();
      renderFlatView();
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(root);

    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [mode, renderFlatView, syncFlatCanvasSize]);

  // Flat mode: wheel zoom (prevents page scroll while hovering the map).
  useEffect(() => {
    if (mode !== "flat") return;
    const canvas = flatCanvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const view = flatViewRef.current;
      if (!view.width || !view.height) return;

      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const oldScale = view.baseScale * flatZoomCurrent.current;
      if (!oldScale) return;

      const anchorX = flatOffsetRef.current.x + sx / oldScale;
      const anchorY = flatOffsetRef.current.y + sy / oldScale;

      const factor = Math.exp(-e.deltaY * 0.001);
      const nextZoom = clamp(flatZoomCurrent.current * factor, 0.75, 4);
      flatZoomCurrent.current = nextZoom;
      flatZoomTarget.current = nextZoom;

      const nextScale = view.baseScale * nextZoom;
      flatOffsetRef.current.x = mod(anchorX - sx / nextScale, TEXTURE_WIDTH);

      const maxOffsetY = Math.max(0, TEXTURE_HEIGHT - view.height / nextScale);
      flatOffsetRef.current.y = clamp(anchorY - sy / nextScale, 0, maxOffsetY);

      renderFlatView();
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [mode, renderFlatView]);

  const onPointerDown = useCallback((e: ReactMouseEvent) => {
    isDragging.current = true;
    didDrag.current = false;
    prevMouse.current = { x: e.clientX, y: e.clientY };
    rotVelocity.current = { x: 0, y: 0 };
  }, []);

  const onPointerMove = useCallback((e: ReactMouseEvent) => {
    if (!isDragging.current || !groupRef.current) return;
    const dx = e.clientX - prevMouse.current.x;
    const dy = e.clientY - prevMouse.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) didDrag.current = true;

    groupRef.current.rotation.y += dx * 0.006;
    groupRef.current.rotation.x += dy * 0.006;
    groupRef.current.rotation.x = Math.max(-0.7, Math.min(0.7, groupRef.current.rotation.x));
    rotVelocity.current = { x: dy * 0.001, y: dx * 0.001 };
    prevMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const clampDrawerRect = useCallback((rect: DrawerRect): DrawerRect => {
    const margin = 10;
    const minW = 360;
    const minH = 480;

    const maxW = Math.max(minW, window.innerWidth - margin * 2);
    const maxH = Math.max(minH, window.innerHeight - margin * 2);

    const w = clamp(rect.w, minW, maxW);
    const h = clamp(rect.h, minH, maxH);
    const x = clamp(rect.x, margin, window.innerWidth - w - margin);
    const y = clamp(rect.y, margin, window.innerHeight - h - margin);

    return { x, y, w, h };
  }, []);

  useEffect(() => {
    const onResize = () => {
      setDrawerRect((cur) => (cur ? clampDrawerRect(cur) : cur));
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [clampDrawerRect]);

  const onDrawerMoveStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      let rect = drawerRectRef.current;
      if (!rect && drawerRootRef.current) {
        const r = drawerRootRef.current.getBoundingClientRect();
        rect = clampDrawerRect({ x: r.left, y: r.top, w: r.width, h: r.height });
        setDrawerRect(rect);
      }
      if (!rect) return;

      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      drawerDragRef.current = {
        mode: "move",
        pointerId: e.pointerId,
        captureEl: e.currentTarget,
        startX: e.clientX,
        startY: e.clientY,
        startRect: rect,
      };
      document.body.style.userSelect = "none";
    },
    [clampDrawerRect]
  );

  const onDrawerResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      let rect = drawerRectRef.current;
      if (!rect && drawerRootRef.current) {
        const r = drawerRootRef.current.getBoundingClientRect();
        rect = clampDrawerRect({ x: r.left, y: r.top, w: r.width, h: r.height });
        setDrawerRect(rect);
      }
      if (!rect) return;

      setDrawerUserResized(true);
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      drawerDragRef.current = {
        mode: "resize",
        pointerId: e.pointerId,
        captureEl: e.currentTarget,
        startX: e.clientX,
        startY: e.clientY,
        startRect: rect,
      };
      document.body.style.userSelect = "none";
    },
    [clampDrawerRect]
  );

  const onDrawerDragMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const st = drawerDragRef.current;
      if (!st.mode || st.pointerId !== e.pointerId || !st.startRect) return;
      e.stopPropagation();

      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;

      if (st.mode === "move") {
        const next = clampDrawerRect({
          ...st.startRect,
          x: st.startRect.x + dx,
          y: st.startRect.y + dy,
        });
        setDrawerRect(next);
        return;
      }

      const next = clampDrawerRect({
        ...st.startRect,
        w: st.startRect.w + dx,
        h: st.startRect.h + dy,
      });
      setDrawerRect(next);
    },
    [clampDrawerRect]
  );

  const onDrawerDragEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = drawerDragRef.current;
    if (!st.mode || st.pointerId !== e.pointerId) return;
    e.stopPropagation();
    try {
      if (st.captureEl?.hasPointerCapture(e.pointerId)) st.captureEl.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    resetDrawerInteraction();
  }, [resetDrawerInteraction]);

  const openDrawer = useCallback(
    async (iso2: string) => {
      const code = iso2.trim().toUpperCase();
      if (!code) return;

      resetDrawerInteraction();
      setDrawerUserResized(false);

      // Always spawn on the right (default) when selecting a country.
      const defaultW = 480;
      const defaultH = Math.min(Math.round(window.innerHeight * 0.82), 760);
      const margin = 16; // Tailwind `*-4`
      const nextRect = clampDrawerRect({
        x: window.innerWidth - defaultW - margin,
        y: margin,
        w: defaultW,
        h: defaultH,
      });
      setDrawerRect(nextRect);
      drawerRectRef.current = nextRect;

      const stats = heatByIso2Ref.current.get(code) ?? null;
      const name =
        countryNameByIso2Ref.current.get(code) ??
        displayNames?.of(code) ??
        code;

      const seq = ++fetchSeq.current;
      setActorCardsVisible(false);
      setDrawer({
        iso2: code,
        name,
        heat: stats?.heat ?? 0,
        actorCount: stats?.actorCount ?? 0,
        lastSeen: stats?.lastSeen ?? null,
        actors: null,
        loading: true,
        error: null,
      });

      try {
        const res = await fetch(`/api/countries/${code}/actors`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { actors?: CountryActorSummary[] };
        const actors = Array.isArray(json.actors) ? json.actors : [];
        if (fetchSeq.current !== seq) return;
        setDrawer((cur) =>
          cur && cur.iso2 === code
            ? { ...cur, actors, loading: false, error: null }
            : cur
        );
        requestAnimationFrame(() => setActorCardsVisible(true));
      } catch (err) {
        if (fetchSeq.current !== seq) return;
        setDrawer((cur) =>
          cur && cur.iso2 === code
            ? { ...cur, loading: false, error: "Failed to load actors." }
            : cur
        );
      }
    },
    [clampDrawerRect, displayNames, resetDrawerInteraction]
  );

  const closeDrawer = useCallback(() => {
    resetDrawerInteraction();
    setDrawer(null);
    setDrawerRect(null);
    drawerRectRef.current = null;
    setDrawerUserResized(false);
    setDotCursorEnabled(false);
    setMapHover(false);
  }, [resetDrawerInteraction, setDotCursorEnabled]);

  const onClick = useCallback(
    (e: ReactMouseEvent) => {
      if (didDrag.current) {
        didDrag.current = false;
        return;
      }

      const el = mountRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const overlay = overlayRef.current;
      const idData = idDataRef.current;
      if (!el || !camera || !renderer || !overlay || !idData) return;

      const rect = el.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = ((e.clientY - rect.top) / rect.height) * -2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hits = raycaster.intersectObject(overlay);
      const uv = hits[0]?.uv ?? null;
      if (!uv) return;

      const iso2 =
        pickIso2AtUv({ uv, idData }) ??
        null;

      if (!iso2) {
        closeDrawer();
        return;
      }

      void openDrawer(iso2);
    },
    [closeDrawer, openDrawer]
  );

  const onFlatPointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    flatIsDragging.current = true;
    flatDidDrag.current = false;
    flatPrevMouse.current = { x: e.clientX, y: e.clientY };
    syncFlatCanvasSize();
  }, [syncFlatCanvasSize]);

  const onFlatPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!flatIsDragging.current) return;

      const dx = e.clientX - flatPrevMouse.current.x;
      const dy = e.clientY - flatPrevMouse.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) flatDidDrag.current = true;

      flatPrevMouse.current = { x: e.clientX, y: e.clientY };

      const view = flatViewRef.current;
      const scale = view.baseScale * flatZoomCurrent.current;
      if (!scale) return;

      flatOffsetRef.current.x = mod(flatOffsetRef.current.x - dx / scale, TEXTURE_WIDTH);

      const maxOffsetY = Math.max(0, TEXTURE_HEIGHT - view.height / scale);
      flatOffsetRef.current.y = clamp(flatOffsetRef.current.y - dy / scale, 0, maxOffsetY);

      renderFlatView();
    },
    [renderFlatView]
  );

  const onFlatPointerUp = useCallback(() => {
    flatIsDragging.current = false;
  }, []);

  const onFlatClick = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      if (flatDidDrag.current) {
        flatDidDrag.current = false;
        return;
      }

      const canvas = flatCanvasRef.current;
      const idData = idDataRef.current;
      if (!canvas || !idData) return;

      const view = flatViewRef.current;
      const scale = view.baseScale * flatZoomCurrent.current;
      if (!scale) return;

      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const baseX = mod(flatOffsetRef.current.x + sx / scale, TEXTURE_WIDTH);
      const baseY = clamp(flatOffsetRef.current.y + sy / scale, 0, TEXTURE_HEIGHT);

      const uv = new THREE.Vector2(baseX / TEXTURE_WIDTH, 1 - baseY / TEXTURE_HEIGHT);
      const iso2 = pickIso2AtUv({ uv, idData });
      if (!iso2) {
        closeDrawer();
        return;
      }
      void openDrawer(iso2);
    },
    [closeDrawer, openDrawer]
  );

  const drawerActorStrength = drawer
    ? clamp01(drawer.actorCount / Math.max(1, countryStatScales.maxActors))
    : 0;

  const drawerHeatStrength = drawer
    ? clamp01(drawer.heat / Math.max(1, countryStatScales.maxHeat))
    : 0;

  const drawerLoopedActors = useMemo(() => {
    if (!drawer?.actors?.length) return null;
    if (drawer.actors.length < 2) return drawer.actors;
    return [...drawer.actors, ...drawer.actors, ...drawer.actors];
  }, [drawer?.actors]);

  const drawerVisibleRows = useMemo(() => {
    const n = drawer?.actors?.length ?? 0;
    if (!n) return ACTOR_LIST_MAX_VISIBLE_ROWS;
    return Math.min(ACTOR_LIST_MAX_VISIBLE_ROWS, n);
  }, [drawer?.actors?.length]);

  const resetActorListScroll = useCallback(() => {
    const base = drawer?.actors;
    const el = actorListRef.current;
    if (!base?.length || !el || base.length < 2) return;
    requestAnimationFrame(() => {
      el.scrollTop = base.length * ACTOR_ROW_HEIGHT_PX;
    });
  }, [drawer?.actors]);

  const onActorListScroll = useCallback(() => {
    const base = drawer?.actors;
    const el = actorListRef.current;
    if (!base?.length || !el || base.length < 2) return;

    const segment = base.length * ACTOR_ROW_HEIGHT_PX;
    if (el.scrollTop < segment * 0.5) el.scrollTop += segment;
    if (el.scrollTop > segment * 1.5) el.scrollTop -= segment;
  }, [drawer?.actors]);

  useEffect(() => {
    resetActorListScroll();
  }, [drawer?.iso2, resetActorListScroll]);

  return (
    <div ref={rootRef} className="relative w-full h-full bg-white dark:bg-[#0b0b0d] overflow-hidden select-none">
      {/* Left info sidebar */}
      <div
        className="absolute z-20 left-4 top-4 max-w-[calc(100%-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative transition-transform duration-300 ease-out will-change-transform"
          style={{
            transform: sidebarOpen
              ? "translateX(0px)"
              : `translateX(calc(-100% + ${SIDEBAR_HANDLE_W}px - ${SIDEBAR_MARGIN_PX}px))`,
          }}
        >
          <aside
            className="relative w-[360px] max-w-[calc(100vw-2rem)] max-h-[82vh] bg-white/90 dark:bg-zinc-950/70 backdrop-blur border border-zinc-200 dark:border-zinc-800/70 rounded-2xl shadow-2xl shadow-black/10 dark:shadow-black/60 px-5 py-5 pr-12 overflow-auto"
          >
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">How this heatmap works</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Countries shade red based on how strongly threat actors are attributed as originating from that
              country. Click a country to see the top actors and drill into evidence.
            </p>
            <div className="mt-4 space-y-3 text-sm text-zinc-600 dark:text-zinc-400">
              <div>
                <div className="text-zinc-900 dark:text-zinc-200 font-medium">Actors</div>
                <div className="mt-1">
                  Count of distinct threat actors currently attributed to the country (origin attribution).
                </div>
              </div>
              <div>
                <div className="text-zinc-900 dark:text-zinc-200 font-medium">Heat</div>
                <div className="mt-1">
                  Sum of each actor&apos;s origin-attribution score. Scores increase with repeated, higher-confidence
                  observations and can decay as data gets stale.
                </div>
              </div>
              <div>
                <div className="text-zinc-900 dark:text-zinc-200 font-medium">Last</div>
                <div className="mt-1">
                  Most recent time any origin attribution for that country was updated.
                </div>
              </div>
              <div>
                <div className="text-zinc-900 dark:text-zinc-200 font-medium">Confidence</div>
                <div className="mt-1">
                  Per-relationship confidence (0-100%) based on extraction confidence and source reliability.
                </div>
              </div>
            </div>
            <div className="mt-5 pt-4 border-t border-zinc-200 dark:border-zinc-800/70 text-sm text-zinc-600 dark:text-zinc-400 space-y-2">
              <div className="text-zinc-900 dark:text-zinc-200 font-medium">Sources</div>
              <div>
                MITRE ATT&amp;CK for group metadata, techniques, mitigations, and campaigns.{" "}
                <a
                  href="https://attack.mitre.org/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                >
                  attack.mitre.org
                </a>
              </div>
              <div className="text-xs text-zinc-500">
                Every score shown in the UI links back to citations on country and actor pages.
              </div>
            </div>
          </aside>
          <button
            type="button"
            className="absolute right-0 top-1/2 -translate-y-1/2 h-10 w-9 flex items-center justify-center text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white transition-colors"
            aria-label={sidebarOpen ? "Hide map info" : "Show map info"}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <span aria-hidden="true" className="text-xl leading-none">
              {sidebarOpen ? "\u2190" : "\u2192"}
            </span>
          </button>
        </div>
      </div>

      <div
        ref={mountRef}
        className={["absolute inset-0", mode === "webgl" ? "" : "hidden"].join(" ")}
        style={{ cursor: mapHover ? "none" : "default" }}
        onPointerEnter={() => {
          setMapHover(true);
          setDotCursorEnabled(true);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => {
          if (!mapHover) {
            setMapHover(true);
            setDotCursorEnabled(true);
          }
          onPointerMove(e);
        }}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setMapHover(false);
          setDotCursorEnabled(false);
          onPointerUp();
        }}
        onClick={onClick}
      />

      <div className={["absolute inset-0", mode === "flat" ? "" : "hidden"].join(" ")}>
        <canvas
          ref={flatCanvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ cursor: mapHover ? "none" : "default", touchAction: "none" }}
          onPointerEnter={() => {
            setMapHover(true);
            setDotCursorEnabled(true);
          }}
          onPointerDown={onFlatPointerDown}
          onPointerMove={(e) => {
            if (!mapHover) {
              setMapHover(true);
              setDotCursorEnabled(true);
            }
            onFlatPointerMove(e);
          }}
          onPointerUp={onFlatPointerUp}
          onPointerLeave={() => {
            setMapHover(false);
            setDotCursorEnabled(false);
            onFlatPointerUp();
          }}
          onClick={onFlatClick}
        />
        <div className="absolute left-3 bottom-3 text-xs text-zinc-600 dark:text-zinc-500 bg-white/80 dark:bg-zinc-950/70 backdrop-blur border border-zinc-200 dark:border-zinc-800 rounded-lg px-2 py-1">
          WebGL disabled &mdash; showing 2D map (drag to pan, scroll to zoom)
        </div>
      </div>

      {/* Country drawer */}
      {drawer ? (
        <div
          ref={drawerRootRef}
          key={drawer.iso2}
          className={[
            "absolute z-20 bg-white/85 dark:bg-black/80 backdrop-blur border border-zinc-200 dark:border-zinc-800/70 rounded-2xl shadow-2xl shadow-black/10 dark:shadow-black/70 p-4 flex flex-col min-h-0 overflow-hidden relative",
          ].join(" ")}
          style={
            drawerRect
              ? { left: drawerRect.x, top: drawerRect.y, width: drawerRect.w, height: drawerRect.h }
              : { right: 16, top: 16, width: 480 }
          }
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-start justify-between gap-3 cursor-grab active:cursor-grabbing select-none"
            onPointerDown={onDrawerMoveStart}
            onPointerMove={onDrawerDragMove}
            onPointerUp={onDrawerDragEnd}
            onPointerCancel={onDrawerDragEnd}
          >
            <div>
              <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">{drawer.name}</div>
              <div className="text-xs text-zinc-500 tracking-wide tabular-nums">{drawer.iso2}</div>
            </div>
            <button
              className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-600 dark:hover:text-zinc-300 transition-colors text-sm leading-none"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={closeDrawer}
              aria-label="Close"
            >
              &times;
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat
              label="Actors"
              value={String(drawer.actorCount)}
              prominent
              strength={drawerActorStrength}
              tone="hot"
              info={{
                title: "Actors",
                body: "Distinct threat actors attributed to this country as suspected origin.",
              }}
              sourceHref={`/countries/${drawer.iso2}`}
            />
            <Stat
              label="Heat"
              value={formatHeat(drawer.heat)}
              prominent
              strength={drawerHeatStrength}
              tone="hot"
              info={{
                title: "Heat",
                body: "Overall origin-attribution score for this country. It's the sum of each attributed actor's score.",
              }}
              sourceHref={`/countries/${drawer.iso2}`}
            />
          </div>

          <div className="mt-2 flex items-center gap-1 text-xs text-zinc-500">
            <span className="text-zinc-600">Last seen:</span>
            <InfoTip
              title="Last seen"
              body="Most recent time any actor-to-country origin attribution for this country was observed/updated."
              sourceHref={`/countries/${drawer.iso2}`}
            />
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
              {drawer.lastSeen ? new Date(drawer.lastSeen).toLocaleDateString() : "\u2014"}
            </span>
          </div>

          <Link
            href={`/countries/${drawer.iso2}`}
            className="mt-3 inline-flex text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            View country details <span aria-hidden="true">&rarr;</span>
          </Link>

          <div className="mt-3 flex-1 min-h-0">
            {drawer.loading ? (
              <div className="h-full min-h-[120px] flex items-center justify-center">
                <OrbitLoader size={44} color="#a1a1aa" />
              </div>
            ) : drawer.error ? (
              <p className="text-sm text-red-400">{drawer.error}</p>
            ) : drawer.actors?.length ? (
              <div className="relative h-full min-h-0">
                <ul
                  ref={actorListRef}
                  className="h-full min-h-0 overflow-y-auto pr-1"
                  onScroll={onActorListScroll}
                  style={{
                    height: drawerUserResized ? undefined : drawerVisibleRows * ACTOR_ROW_HEIGHT_PX,
                    minHeight: drawerVisibleRows * ACTOR_ROW_HEIGHT_PX,
                    maskImage:
                      "linear-gradient(to bottom, transparent, black 18px, black calc(100% - 28px), transparent)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, transparent, black 18px, black calc(100% - 28px), transparent)",
                  }}
                >
                    {(drawerLoopedActors ?? drawer.actors).map((a, idx) => {
                      const baseLen = drawer.actors?.length ?? 0;
                      const logicalIndex = baseLen ? idx % baseLen : idx;
                      return (
                        <li
                          key={`${idx}-${a.actorId}`}
                          className={[
                            "h-14 border-b border-zinc-200 dark:border-zinc-900/60 last:border-b-0",
                            "flex items-center",
                            "transition-[transform,opacity,background-color] duration-300 ease-out",
                            actorCardsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
                            "hover:bg-black/5 dark:hover:bg-white/5 rounded-lg px-2 -mx-2",
                          ].join(" ")}
                          style={{ transitionDelay: `${Math.min(logicalIndex, 5) * 35}ms` }}
                        >
                          <div className="flex items-center justify-between gap-3 w-full">
                            <div className="min-w-0">
                              <Link
                                href={`/actors/${a.actorId}`}
                                className="block text-base font-medium text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate"
                              >
                                {a.name}
                              </Link>
                              <div className="text-xs text-zinc-500 dark:text-zinc-600 tracking-wide tabular-nums">
                                {a.actorId}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="flex items-center justify-end gap-1 text-[11px] text-zinc-500">
                                <span className="text-zinc-600">Score</span>
                                <InfoTip
                                  title="Attribution score"
                                  body="A strength score for this actor-to-country attribution (higher = more/stronger evidence and/or higher-confidence sources; older observations can decay)."
                                  sourceHref={`/countries/${drawer.iso2}`}
                                />
                                <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">
                                  {a.support.toFixed(2)}
                                </span>
                              </div>
                              <div className="flex items-center justify-end gap-1 text-[11px] text-zinc-500">
                                <span className="text-zinc-600">Confidence</span>
                                <InfoTip
                                  title="Confidence"
                                  body="How confident we are that this actor is correctly attributed to this country (0-100%)."
                                  sourceHref={`/countries/${drawer.iso2}`}
                                />
                                <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-200">
                                  {Math.round(a.confidence * 100)}%
                                </span>
                              </div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No actors attributed yet.</p>
            )}
          </div>

          <div
            className="absolute right-2 bottom-2 h-6 w-6 cursor-se-resize text-zinc-500 hover:text-zinc-200 transition-colors"
            style={{ touchAction: "none" }}
            onPointerDown={onDrawerResizeStart}
            onPointerMove={onDrawerDragMove}
            onPointerUp={onDrawerDragEnd}
            onPointerCancel={onDrawerDragEnd}
            aria-label="Resize panel"
            title="Drag to resize"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-6 w-6">
              <path d="M7 19L19 7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 19L19 12" stroke="currentColor" strokeWidth="1.5" />
              <path d="M17 19L19 17" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  info,
  sourceHref,
  strength,
  tone = "hot",
  prominent = false,
  valueClassName,
}: {
  label: string;
  value: string;
  info?: { title: string; body: string };
  sourceHref?: string;
  strength?: number;
  tone?: StatTone;
  prominent?: boolean;
  valueClassName?: string;
}) {
  const gradient = typeof strength === "number" ? statTextGradient(strength, tone) : null;
  return (
    <div className="bg-white/70 dark:bg-black/45 border border-zinc-200 dark:border-zinc-900/80 rounded-lg px-2 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-600">
        <span>{label}</span>
        {info ? <InfoTip title={info.title} body={info.body} sourceHref={sourceHref} /> : null}
      </div>
      <div
        className={[
          prominent ? "text-xl md:text-2xl font-semibold tracking-tight" : "text-xs tabular-nums",
          gradient ? "bg-clip-text text-transparent" : valueClassName ?? "text-zinc-900 dark:text-zinc-200",
        ].join(" ")}
        style={gradient ? { backgroundImage: gradient } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Scene builders ───────────────────────────────────────────────────────────

function buildStarfield(): THREE.Points {
  const count = 2500;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const twinkleOffset = new Float32Array(count);
  const twinkleSpeed = new Float32Array(count);
  const twinkleAmp = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = 20 + Math.random() * 30;
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;
    positions[i * 3] = r * Math.sin(theta) * Math.cos(phi);
    positions[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
    positions[i * 3 + 2] = r * Math.cos(theta);

    sizes[i] = Math.random() < 0.05 ? 1.8 : Math.random() < 0.2 ? 1.1 : 0.6;

    // Subtle twinkle (toned down)
    twinkleOffset[i] = Math.random() * Math.PI * 2;
    twinkleSpeed[i] = 0.10 + Math.random() * 0.25;
    twinkleAmp[i] = 0.001 + Math.random() * 0.003;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("aTwinkleOffset", new THREE.BufferAttribute(twinkleOffset, 1));
  geo.setAttribute("aTwinkleSpeed", new THREE.BufferAttribute(twinkleSpeed, 1));
  geo.setAttribute("aTwinkleAmp", new THREE.BufferAttribute(twinkleAmp, 1));

  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    sizeAttenuation: true,
    size: 0.07,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = { value: 0 };
    mat.userData["shader"] = shader;

    shader.vertexShader =
      [
        "uniform float uTime;",
        "attribute float aSize;",
        "attribute float aTwinkleOffset;",
        "attribute float aTwinkleSpeed;",
        "attribute float aTwinkleAmp;",
        "varying float vTwinkle;",
        "",
      ].join("\n") + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      "void main() {\n\tvTwinkle = 1.0 + sin(uTime * aTwinkleSpeed + aTwinkleOffset) * aTwinkleAmp;"
    );

    shader.vertexShader = shader.vertexShader.replace(
      "gl_PointSize = size;",
      "gl_PointSize = size * aSize;"
    );

    shader.fragmentShader = ["varying float vTwinkle;", ""].join("\n") + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      "gl_FragColor = vec4( outgoingLight, diffuseColor.a );",
      "gl_FragColor = vec4( outgoingLight, diffuseColor.a * vTwinkle );"
    );
  };
  mat.customProgramCacheKey = () => "starfield-v2";

  return new THREE.Points(geo, mat);
}

function buildCountryLines(topoData: unknown): THREE.Object3D {
  const R = GLOBE_RADIUS + 0.004;
  const allPoints: number[] = [];

  const topo = topoData as any;
  const geojson = (topojson.feature(topo, topo.objects.countries) as any) as {
    features: Array<{
      geometry: {
        type: string;
        coordinates: number[][][] | number[][][][];
      } | null;
    }>;
  };

  const processRing = (ring: number[][]) => {
    for (let i = 0; i < ring.length - 1; i++) {
      const [lng0, lat0] = ring[i]!;
      const [lng1, lat1] = ring[i + 1]!;
      const v0 = latLngToVec3(lat0!, lng0!, R);
      const v1 = latLngToVec3(lat1!, lng1!, R);
      allPoints.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z);
    }
  };

  for (const feature of geojson.features) {
    if (!feature.geometry) continue;
    if (feature.geometry.type === "Polygon") {
      for (const ring of feature.geometry.coordinates as number[][][]) processRing(ring);
    } else if (feature.geometry.type === "MultiPolygon") {
      for (const polygon of feature.geometry.coordinates as number[][][][]) {
        for (const ring of polygon) processRing(ring);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(allPoints, 3));
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({
      color: COUNTRY_BORDER_COLOR_HEX_DARK,
      transparent: true,
      opacity: COUNTRY_BORDER_OPACITY_DARK,
    })
  );
}
