"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from "react";
import * as THREE from "three";
import * as topojson from "topojson-client";
import type { MapFinding } from "./ThreatMap";

// ─── Geo helpers ──────────────────────────────────────────────────────────────

const GLOBE_RADIUS = 2;

function latLngToVec3(lat: number, lng: number, r = GLOBE_RADIUS): THREE.Vector3 {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const AGENT_COLOR_HEX: Record<string, number> = {
  vuln:    0x3b82f6,
  attack:  0xef4444,
  ttp:     0xa855f7,
  exploit: 0xf97316,
  malware: 0xeab308,
};

const SEVERITY_COLOR_CSS: Record<string, string> = {
  critical: "#ef4444",
  high:     "#f97316",
  medium:   "#eab308",
  low:      "#22c55e",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Popup {
  finding: MapFinding;
  screenX: number;
  screenY: number;
}

interface Props {
  findings: MapFinding[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GlobeHero({ findings }: Props) {
  const mountRef    = useRef<HTMLDivElement>(null);
  const sceneRef    = useRef<THREE.Scene | null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const frameRef    = useRef<number>(0);
  const groupRef    = useRef<THREE.Group | null>(null);
  const dotsRef     = useRef<THREE.Mesh[]>([]);

  const isDragging  = useRef(false);
  const prevMouse   = useRef({ x: 0, y: 0 });
  const rotVelocity = useRef({ x: 0, y: 0 });

  const [popup, setPopup] = useState<Popup | null>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ── Camera ──
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 6);
    cameraRef.current = camera;

    // ── Scene ──
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // ── Lights ──
    scene.add(new THREE.AmbientLight(0xffffff, 0.15));
    const dirLight = new THREE.DirectionalLight(0x6366f1, 1.2);
    dirLight.position.set(5, 3, 5);
    scene.add(dirLight);
    const backLight = new THREE.DirectionalLight(0x1e293b, 0.4);
    backLight.position.set(-5, -3, -5);
    scene.add(backLight);

    // ── Starfield (added to scene, not the rotating group) ──
    scene.add(buildStarfield());

    // ── Globe group ──
    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    // Sphere
    const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const globeMat = new THREE.MeshPhongMaterial({
      color: 0x0d0d12, emissive: 0x06060a, shininess: 15,
      transparent: true, opacity: 0.97,
    });
    group.add(new THREE.Mesh(globeGeo, globeMat));

    // Atmosphere glow
    const atmosGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.04, 64, 64);
    const atmosMat = new THREE.MeshPhongMaterial({
      color: 0x1d4ed8, transparent: true, opacity: 0.06,
      side: THREE.BackSide, depthWrite: false,
    });
    group.add(new THREE.Mesh(atmosGeo, atmosMat));

    // Graticule
    buildGraticule(group);

    // ── Country outlines (via topojson-client — correct decoding) ──
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
      .then(r => r.json())
      .then(topo => { group.add(buildCountryLines(topo)); })
      .catch(() => {});

    // ── Threat dots ──
    dotsRef.current = buildDots(findings, group);

    // ── Animation loop ──
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      if (!isDragging.current) {
        group.rotation.y += 0.0015;
        group.rotation.y += rotVelocity.current.y;
        group.rotation.x += rotVelocity.current.x;
        rotVelocity.current.x *= 0.92;
        rotVelocity.current.y *= 0.92;
        group.rotation.x = Math.max(-0.5, Math.min(0.5, group.rotation.x));
      }
      renderer.render(scene, camera);
    };
    animate();

    // ── Resize ──
    const onResize = () => {
      if (!el) return;
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    dotsRef.current.forEach(m => group.remove(m));
    dotsRef.current = buildDots(findings, group);
  }, [findings]);

  // ── Pointer events ──
  const onPointerDown = useCallback((e: ReactMouseEvent) => {
    isDragging.current = true;
    prevMouse.current  = { x: e.clientX, y: e.clientY };
    rotVelocity.current = { x: 0, y: 0 };
  }, []);

  const onPointerMove = useCallback((e: ReactMouseEvent) => {
    if (!isDragging.current || !groupRef.current) return;
    const dx = e.clientX - prevMouse.current.x;
    const dy = e.clientY - prevMouse.current.y;
    groupRef.current.rotation.y += dx * 0.006;
    groupRef.current.rotation.x += dy * 0.006;
    groupRef.current.rotation.x = Math.max(-0.7, Math.min(0.7, groupRef.current.rotation.x));
    rotVelocity.current = { x: dy * 0.001, y: dx * 0.001 };
    prevMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback(() => { isDragging.current = false; }, []);

  const onClick = useCallback((e: ReactMouseEvent) => {
    const el       = mountRef.current;
    const camera   = cameraRef.current;
    const renderer = rendererRef.current;
    if (!el || !camera || !renderer) return;

    const rect = el.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
    const ndcY = ((e.clientY - rect.top)  / rect.height) * -2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hits = raycaster.intersectObjects(dotsRef.current);
    if (hits.length > 0) {
      const hit     = hits[0]!;
      const finding = (hit.object as THREE.Mesh).userData["finding"] as MapFinding;
      const pos3D   = hit.point.clone().project(camera);
      const sx      = (pos3D.x *  0.5 + 0.5) * rect.width;
      const sy      = (pos3D.y * -0.5 + 0.5) * rect.height;
      setPopup({ finding, screenX: sx, screenY: sy });
    } else {
      setPopup(null);
    }
  }, []);

  return (
    <div className="relative w-full h-full bg-[#09090b] overflow-hidden select-none">

      {/* Three.js canvas */}
      <div
        ref={mountRef}
        className="absolute inset-0"
        style={{ cursor: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={onClick}
      />

      {/* Dot popup */}
      {popup && (
        <DotPopup
          popup={popup}
          containerWidth={mountRef.current?.clientWidth ?? 800}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

// ─── Popup ────────────────────────────────────────────────────────────────────

function DotPopup({
  popup, containerWidth, onClose,
}: { popup: Popup; containerWidth: number; onClose: () => void }) {
  const { finding, screenX, screenY } = popup;
  const popupWidth = 272;
  const left = screenX + popupWidth + 16 > containerWidth
    ? screenX - popupWidth - 12
    : screenX + 12;

  const tags: string[] = (() => {
    try { return finding.tags ? JSON.parse(finding.tags) : []; }
    catch { return []; }
  })();

  const agentColor = AGENT_COLOR_CSS[finding.agent] ?? "#3b82f6";
  const sevColor   = finding.severity ? (SEVERITY_COLOR_CSS[finding.severity] ?? "#71717a") : null;

  return (
    <div
      className="absolute z-20 bg-zinc-900/95 backdrop-blur-sm border border-zinc-800 rounded-lg shadow-2xl shadow-black/60 text-xs"
      style={{ left, top: Math.max(8, screenY - 60), width: popupWidth }}
      onClick={e => e.stopPropagation()}
    >
      <div className="px-3 pt-3 pb-2 border-b border-zinc-800 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-mono px-1.5 py-0.5 rounded text-[10px]"
            style={{ backgroundColor: `${agentColor}18`, color: agentColor, border: `1px solid ${agentColor}30` }}
          >
            {finding.agent.toUpperCase()}
          </span>
          {finding.cveId && <span className="font-mono text-zinc-500">{finding.cveId}</span>}
          {sevColor && <span className="font-mono" style={{ color: sevColor }}>{finding.severity}</span>}
        </div>
        <button onClick={onClose} className="text-zinc-700 hover:text-zinc-400 transition-colors text-sm leading-none shrink-0">×</button>
      </div>

      <div className="px-3 py-2">
        <p className="text-zinc-200 font-medium leading-snug line-clamp-2">{finding.title}</p>
      </div>

      {finding.summary && (
        <div className="px-3 pb-2">
          <p className="text-zinc-500 leading-relaxed line-clamp-3">{finding.summary}</p>
        </div>
      )}

      {finding.cvssScore && (
        <div className="px-3 pb-2 flex items-center gap-2 font-mono">
          <span className="text-zinc-700">CVSS</span>
          <span className="font-bold" style={{
            color: parseFloat(finding.cvssScore) >= 9 ? "#ef4444"
                 : parseFloat(finding.cvssScore) >= 7 ? "#f97316"
                 : parseFloat(finding.cvssScore) >= 4 ? "#eab308"
                 : "#22c55e",
          }}>
            {parseFloat(finding.cvssScore).toFixed(1)}
          </span>
        </div>
      )}

      {tags.length > 0 && (
        <div className="px-3 pb-3 flex flex-wrap gap-1">
          {tags.slice(0, 4).map(tag => (
            <span key={tag} className="bg-zinc-800 text-zinc-600 px-1.5 py-0.5 rounded font-mono">{tag}</span>
          ))}
        </div>
      )}

      <div className="px-3 py-2 border-t border-zinc-800 flex items-center justify-between">
        <span className="text-zinc-700 font-mono">
          {finding.publishedAt ? new Date(finding.publishedAt).toLocaleDateString() : ""}
        </span>
        <a href={finding.href} className="text-blue-500 hover:text-blue-400 transition-colors font-medium">
          Full writeup →
        </a>
      </div>
    </div>
  );
}

// ─── Scene builders ───────────────────────────────────────────────────────────

function buildStarfield(): THREE.Points {
  const count = 2500;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Distribute evenly across a large sphere shell (r = 20–50)
    const r     = 20 + Math.random() * 30;
    const theta = Math.acos(2 * Math.random() - 1);
    const phi   = Math.random() * Math.PI * 2;
    positions[i * 3]     = r * Math.sin(theta) * Math.cos(phi);
    positions[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
    positions[i * 3 + 2] = r * Math.cos(theta);
    // Vary star sizes so some pop more than others
    sizes[i] = Math.random() < 0.05 ? 1.8 : Math.random() < 0.2 ? 1.1 : 0.6;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("size",     new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.PointsMaterial({
    color:        0xffffff,
    sizeAttenuation: true,
    size:         0.07,
    transparent:  true,
    opacity:      0.85,
    depthWrite:   false,
  });

  return new THREE.Points(geo, mat);
}

function buildGraticule(group: THREE.Group) {
  const R = GLOBE_RADIUS + 0.002;
  const points: number[] = [];
  const step = 10;

  const push = (lat: number, lng: number) => {
    const v = latLngToVec3(lat, lng, R);
    points.push(v.x, v.y, v.z);
  };

  for (let lat = -80; lat <= 80; lat += step) {
    for (let lng = -180; lng < 180; lng += 2) { push(lat, lng); push(lat, lng + 2); }
  }
  for (let lng = -180; lng < 180; lng += step) {
    for (let lat = -88; lat < 88; lat += 2) { push(lat, lng); push(lat + 2, lng); }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x18181b, transparent: true, opacity: 0.5 })));
}

/**
 * Build country border lines using topojson-client for correct decoding.
 * The old manual decoder (÷10) was wrong — topojson-client applies the
 * proper quantization transform (scale + translate) from the topology.
 */
function buildCountryLines(topoData: unknown): THREE.Object3D {
  const R = GLOBE_RADIUS + 0.004;
  const allPoints: number[] = [];

  // topojson-client converts TopoJSON → GeoJSON FeatureCollection correctly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo = topoData as any;
  const geojson = topojson.feature(topo, topo.objects.countries) as {
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
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x3f3f46, transparent: true, opacity: 0.9 }));
}

function buildDots(findings: MapFinding[], group: THREE.Group): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];

  for (const finding of findings) {
    const [lng, lat] = finding.coords;
    const R   = GLOBE_RADIUS + 0.025;
    const pos = latLngToVec3(lat, lng, R);
    const color = AGENT_COLOR_HEX[finding.agent] ?? 0x3b82f6;
    const isCritical = finding.severity === "critical" || finding.severity === "high";

    if (isCritical) {
      const ring = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 8, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 })
      );
      ring.position.copy(pos);
      group.add(ring);
    }

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(isCritical ? 0.026 : 0.018, 8, 8),
      new THREE.MeshBasicMaterial({ color })
    );
    dot.position.copy(pos);
    dot.userData["finding"] = finding;
    group.add(dot);
    meshes.push(dot);
  }

  return meshes;
}
