"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import clsx from "clsx";

type ActorOption = {
  actorId: string;
  name: string;
};

type ApiNode = {
  key: string;
  kind: string;
  entityId: string;
  name: string;
};

type ApiEdge = {
  id: string;
  type: string;
  from: string;
  to: string;
  support: number;
  confidence: number;
  lastSeen: string | null;
};

type ApiResponse = {
  center: string;
  nodes: ApiNode[];
  edges: ApiEdge[];
  truncated: boolean;
};

type Viewport = { w: number; h: number };
type View = { scale: number; tx: number; ty: number };

type SimNode = ApiNode & {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

type SimEdge = ApiEdge & {
  source: SimNode | string;
  target: SimNode | string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function prettyKind(kind: string) {
  if (!kind) return "Unknown";
  return kind.replaceAll("_", " ");
}

function nodeRadius(n: { kind: string; key: string }) {
  if (n.kind === "actor") return 11;
  if (n.kind === "campaign") return 9;
  if (n.kind === "malware") return 9;
  if (n.kind === "infrastructure") return 9;
  if (n.kind === "tool") return 9;
  if (n.kind === "technique") return 8;
  if (n.kind === "cve") return 8;
  if (n.kind === "country") return 8;
  if (n.kind === "sector") return 8;
  return 7;
}

function kindFill(kind: string, dark: boolean) {
  const colors: Record<string, string> = {
    actor: dark ? "#60a5fa" : "#2563eb",
    campaign: dark ? "#fbbf24" : "#d97706",
    malware: dark ? "#f87171" : "#dc2626",
    infrastructure: dark ? "#a78bfa" : "#7c3aed",
    tool: dark ? "#34d399" : "#059669",
    technique: dark ? "#22d3ee" : "#0891b2",
    cve: dark ? "#fb7185" : "#e11d48",
    country: dark ? "#f472b6" : "#db2777",
    sector: dark ? "#facc15" : "#ca8a04",
  };
  return colors[kind] ?? (dark ? "#94a3b8" : "#64748b");
}

function edgeStroke(edgeType: string, dark: boolean) {
  if (edgeType === "actor_similar_actor") return dark ? "rgba(96,165,250,0.35)" : "rgba(37,99,235,0.30)";
  return dark ? "rgba(148,163,184,0.35)" : "rgba(100,116,139,0.30)";
}

function edgeDash(edgeType: string) {
  if (edgeType === "actor_similar_actor") return [6, 4];
  return null;
}

function parseActorIdFromInput(input: string, options: ActorOption[]) {
  const raw = input.trim();
  if (!raw) return null;

  const byId = new Map(options.map((o) => [o.actorId, o]));
  if (byId.has(raw)) return raw;

  const parenMatch = raw.match(/\(([^()]+)\)\s*$/);
  if (parenMatch) {
    const id = parenMatch[1]?.trim();
    if (id && byId.has(id)) return id;
  }

  const dashMatch = raw.split(" — ");
  if (dashMatch.length >= 2) {
    const id = dashMatch[dashMatch.length - 1]?.trim();
    if (id && byId.has(id)) return id;
  }

  const rawLower = raw.toLowerCase();
  const exactName = options.find((o) => o.name.trim().toLowerCase() === rawLower);
  return exactName?.actorId ?? null;
}

function formatActorInput(opt: ActorOption | null) {
  if (!opt) return "";
  return `${opt.name} (${opt.actorId})`;
}

function groupCounts(items: string[]) {
  const map = new Map<string, number>();
  for (const it of items) map.set(it, (map.get(it) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function Icon({
  name,
  className,
}: {
  name: "fullscreen" | "exitFullscreen" | "reset";
  className?: string;
}) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const };
  if (name === "reset") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path {...common} d="M21 12a9 9 0 1 1-3.1-6.8" />
        <path {...common} d="M21 3v6h-6" />
      </svg>
    );
  }
  if (name === "exitFullscreen") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path {...common} d="M8 3H3v5" />
        <path {...common} d="M3 3l7 7" />
        <path {...common} d="M16 3h5v5" />
        <path {...common} d="M21 3l-7 7" />
        <path {...common} d="M8 21H3v-5" />
        <path {...common} d="M3 21l7-7" />
        <path {...common} d="M16 21h5v-5" />
        <path {...common} d="M21 21l-7-7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path {...common} d="M8 3H3v5" />
      <path {...common} d="M16 3h5v5" />
      <path {...common} d="M8 21H3v-5" />
      <path {...common} d="M16 21h5v-5" />
    </svg>
  );
}

export function ActorRelationshipGraph({
  actorOptions,
  initialActorId,
  initialDepth = 2,
  initialIncludeSimilarity = true,
  initialIncludeDerived = false,
}: {
  actorOptions: ActorOption[];
  initialActorId?: string | null;
  initialDepth?: number;
  initialIncludeSimilarity?: boolean;
  initialIncludeDerived?: boolean;
}) {
  const [darkMode, setDarkMode] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => setDarkMode(root.classList.contains("dark"));
    apply();

    const mo = new MutationObserver(() => apply());
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  const optionsById = useMemo(
    () => new Map(actorOptions.map((o) => [o.actorId, o] as const)),
    [actorOptions]
  );

  const [actorInput, setActorInput] = useState(() => {
    const initial = initialActorId ? optionsById.get(initialActorId) ?? null : null;
    return formatActorInput(initial) || (actorOptions[0] ? formatActorInput(actorOptions[0]) : "");
  });

  const [actorId, setActorId] = useState(() => {
    const id = initialActorId && optionsById.has(initialActorId) ? initialActorId : actorOptions[0]?.actorId;
    return id ?? "";
  });

  const [depth, setDepth] = useState(() => clamp(Math.floor(initialDepth), 1, 4));
  const [includeSimilarity, setIncludeSimilarity] = useState(!!initialIncludeSimilarity);
  const [includeDerived, setIncludeDerived] = useState(!!initialIncludeDerived);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(new Set());

  const fullscreenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const isMaximized = isFullscreen || isExpanded;
  const [viewport, setViewport] = useState<Viewport>({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const simRef = useRef<d3.Simulation<SimNode, undefined> | null>(null);
  const graphRef = useRef<{ nodes: SimNode[]; edges: SimEdge[]; nodeByKey: Map<string, SimNode> } | null>(null);

  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement;
      setIsFullscreen(!!fsEl && fsEl === fullscreenRef.current);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isExpanded]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await fullscreenRef.current?.requestFullscreen();
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (!r) return;
      const w = Math.max(0, Math.round(r.width));
      const h = Math.max(0, Math.round(r.height));
      setViewport({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const updateUrl = useCallback(
    (params: { actorId: string; depth: number; includeSimilarity: boolean; includeDerived: boolean }) => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("view", "graph");
        url.searchParams.set("focus", params.actorId);
        url.searchParams.set("depth", String(params.depth));
        url.searchParams.set("similarity", params.includeSimilarity ? "1" : "0");
        url.searchParams.set("derived", params.includeDerived ? "1" : "0");
        window.history.replaceState({}, "", url.toString());
      } catch {
        // ignore
      }
    },
    []
  );

  const fetchGraph = useCallback(
    async (nextActorId: string) => {
      if (!nextActorId) return;
      setLoading(true);
      setError(null);
      setSelectedKey(null);
      setHoverKey(null);

      updateUrl({ actorId: nextActorId, depth, includeSimilarity, includeDerived });

      try {
        const url = new URL("/api/actors/graph", window.location.origin);
        url.searchParams.set("actorId", nextActorId);
        url.searchParams.set("depth", String(depth));
        url.searchParams.set("includeSimilarity", includeSimilarity ? "1" : "0");
        url.searchParams.set("includeDerived", includeDerived ? "1" : "0");
        url.searchParams.set("maxNodes", "180");
        url.searchParams.set("maxEdges", "520");

        const res = await fetch(url.toString(), { method: "GET" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Request failed (${res.status})`);
        }
        const json = (await res.json()) as ApiResponse;
        setData(json);
        const types = [...new Set(json.edges.map((e) => e.type))].sort();
        setEnabledTypes(new Set(types));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load graph");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [depth, includeDerived, includeSimilarity, updateUrl]
  );

  useEffect(() => {
    if (!actorId) return;
    void fetchGraph(actorId);
  }, [actorId, fetchGraph]);

  const allTypes = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.edges.map((e) => e.type))].sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const types = enabledTypes;

    const edges = data.edges.filter((e) => types.has(e.type));
    const keep = new Set<string>([data.center]);
    for (const e of edges) {
      keep.add(e.from);
      keep.add(e.to);
    }
    const nodes = data.nodes.filter((n) => keep.has(n.key));
    return { nodes, edges, center: data.center, truncated: data.truncated };
  }, [data, enabledTypes]);

  const nodeByKey = useMemo(() => {
    const map = new Map<string, ApiNode>();
    for (const n of filtered?.nodes ?? []) map.set(n.key, n);
    return map;
  }, [filtered]);

  const selectedNode = selectedKey ? nodeByKey.get(selectedKey) ?? null : null;

  const selectedStats = useMemo(() => {
    if (!selectedKey || !filtered) return null;
    const incidentEdges = filtered.edges.filter((e) => e.from === selectedKey || e.to === selectedKey);
    const neighborKeys: string[] = [];
    const typeKeys: string[] = [];
    for (const e of incidentEdges) {
      typeKeys.push(e.type);
      neighborKeys.push(e.from === selectedKey ? e.to : e.from);
    }
    const neighborKinds = neighborKeys.map((k) => nodeByKey.get(k)?.kind ?? "unknown");
    return {
      edgeCount: incidentEdges.length,
      typeCounts: groupCounts(typeKeys).slice(0, 8),
      kindCounts: groupCounts(neighborKinds).slice(0, 8),
      neighborKeys: [...new Set(neighborKeys)].slice(0, 10),
    };
  }, [filtered, nodeByKey, selectedKey]);

  const resetView = useCallback(() => {
    setView({ scale: 1, tx: viewport.w / 2, ty: viewport.h / 2 });
  }, [viewport.h, viewport.w]);

  useEffect(() => {
    if (!viewport.w || !viewport.h) return;
    resetView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.w, viewport.h]);

  const drawRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const g = graphRef.current;
      const { w, h } = viewport;
      if (!g || !w || !h) return;

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dark = isDark();
      const bg = dark ? "rgba(9,9,11,0.35)" : "rgba(255,255,255,0.55)";
      const grid = dark ? "rgba(148,163,184,0.06)" : "rgba(15,23,42,0.05)";

      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cw, ch);

      // light grid (helps orientation)
      const { scale, tx, ty } = viewRef.current;
      const step = 120;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      for (let x = -5000; x <= 5000; x += step) {
        ctx.moveTo(x, -5000);
        ctx.lineTo(x, 5000);
      }
      for (let y = -5000; y <= 5000; y += step) {
        ctx.moveTo(-5000, y);
        ctx.lineTo(5000, y);
      }
      ctx.stroke();

      // edges
      for (const e of g.edges) {
        const a = e.source as SimNode;
        const b = e.target as SimNode;
        if (!a || !b) continue;
        const dash = edgeDash(e.type);
        if (dash) ctx.setLineDash(dash.map((v) => v / scale));
        else ctx.setLineDash([]);
        ctx.strokeStyle = edgeStroke(e.type, dark);
        ctx.lineWidth = (e.type === "actor_similar_actor" ? 1.25 : 1.5) / scale;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // nodes
      for (const n of g.nodes) {
        const r = nodeRadius(n);
        const fill = kindFill(n.kind, dark);

        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();

        const key = n.key;
        const isSelected = selectedKey === key;
        const isHover = hoverKey === key;
        if (isSelected || isHover) {
          ctx.lineWidth = (isSelected ? 3 : 2) / scale;
          ctx.strokeStyle = dark ? "rgba(255,255,255,0.85)" : "rgba(15,23,42,0.85)";
          ctx.stroke();
        } else {
          ctx.lineWidth = 1 / scale;
          ctx.strokeStyle = dark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.5)";
          ctx.stroke();
        }
      }

      ctx.restore();

      // labels (screen-space)
      const toScreen = (n: SimNode) => ({
        x: n.x * scale + tx,
        y: n.y * scale + ty,
      });

      const labelNodes: SimNode[] = [];
      const centerNode = g.nodeByKey.get(filtered?.center ?? "") ?? null;
      if (centerNode) labelNodes.push(centerNode);
      const hoverNode = hoverKey ? g.nodeByKey.get(hoverKey) ?? null : null;
      if (hoverNode && hoverNode !== centerNode) labelNodes.push(hoverNode);
      const selectedNode2 = selectedKey ? g.nodeByKey.get(selectedKey) ?? null : null;
      if (selectedNode2 && selectedNode2 !== centerNode && selectedNode2 !== hoverNode) labelNodes.push(selectedNode2);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
      ctx.textBaseline = "top";
      for (const n of labelNodes) {
        const p = toScreen(n);
        const label = n.name;
        const pad = 6;
        const metrics = ctx.measureText(label);
        const bw = Math.ceil(metrics.width + pad * 2);
        const bh = 20;
        const x = Math.round(p.x + 12);
        const y = Math.round(p.y + 12);

        ctx.fillStyle = dark ? "rgba(9,9,11,0.75)" : "rgba(255,255,255,0.80)";
        ctx.strokeStyle = dark ? "rgba(148,163,184,0.35)" : "rgba(15,23,42,0.10)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, 8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = dark ? "rgba(244,244,245,0.95)" : "rgba(15,23,42,0.95)";
        ctx.fillText(label, x + pad, y + 3);
      }

    };

    drawRef.current = draw;
  }, [filtered?.center, filtered?.truncated, hoverKey, selectedKey, viewport]);

  useEffect(() => {
    if (!filtered || !viewport.w || !viewport.h) return;

    simRef.current?.stop();
    simRef.current = null;
    graphRef.current = null;

    const nodes: SimNode[] = filtered.nodes.map((n) => ({
      ...n,
      x: (Math.random() - 0.5) * 320,
      y: (Math.random() - 0.5) * 320,
    }));
    const nodeByKeySim = new Map(nodes.map((n) => [n.key, n] as const));

    const center = nodeByKeySim.get(filtered.center);
    if (center) {
      center.x = 0;
      center.y = 0;
      center.fx = 0;
      center.fy = 0;
    }

    const edges: SimEdge[] = filtered.edges.map((e) => ({
      ...e,
      source: e.from,
      target: e.to,
    }));

    graphRef.current = { nodes, edges, nodeByKey: nodeByKeySim };

    const linkForce = d3
      .forceLink<SimNode, any>(edges)
      .id((d: any) => d.key)
      .distance((l: any) => {
        const t = String(l.type ?? "");
        if (t === "actor_similar_actor") return 90;
        const s = clamp(Number(l.support ?? 0), 0, 1);
        return 140 - s * 60;
      })
      .strength((l: any) => {
        const t = String(l.type ?? "");
        if (t === "actor_similar_actor") return 0.28;
        return 0.22;
      });

    const sim = d3
      .forceSimulation<SimNode>(nodes)
      .force("link", linkForce)
      .force("charge", d3.forceManyBody().strength(-240))
      .force("collide", d3.forceCollide<SimNode>().radius((d) => nodeRadius(d) + 7))
      .force("center", d3.forceCenter(0, 0))
      .alpha(1)
      .alphaDecay(0.05);

    simRef.current = sim;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        drawRef.current?.();
      });
    };
    sim.on("tick", schedule);
    schedule();

    const settle = window.setTimeout(() => {
      sim.alphaTarget(0);
    }, 1200);

    return () => {
      window.clearTimeout(settle);
      window.cancelAnimationFrame(raf);
      sim.stop();
    };
  }, [filtered, viewport.h, viewport.w]);

  // Redraw on hover/selection/view changes.
  useEffect(() => {
    drawRef.current?.();
  }, [hoverKey, selectedKey, view, viewport.w, viewport.h, filtered?.truncated]);

  const pickNodeAt = useCallback((clientX: number, clientY: number) => {
    const g = graphRef.current;
    const el = canvasRef.current;
    if (!g || !el) return null;
    const rect = el.getBoundingClientRect();
    const { scale, tx, ty } = viewRef.current;

    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const x = (px - tx) / scale;
    const y = (py - ty) / scale;

    let best: { key: string; d2: number } | null = null;
    for (let i = g.nodes.length - 1; i >= 0; i--) {
      const n = g.nodes[i]!;
      const r = nodeRadius(n) + 6 / scale;
      const dx = x - n.x;
      const dy = y - n.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && (!best || d2 < best.d2)) best = { key: n.key, d2 };
    }
    return best?.key ?? null;
  }, []);

  const interactionRef = useRef<
    | {
        type: "pan";
        startX: number;
        startY: number;
        startTx: number;
        startTy: number;
        moved: boolean;
      }
    | {
        type: "drag";
        nodeKey: string;
        moved: boolean;
      }
    | null
  >(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);

      const hit = pickNodeAt(e.clientX, e.clientY);
      if (hit && hit !== filtered?.center) {
        const g = graphRef.current;
        const sim = simRef.current;
        const node = g?.nodeByKey.get(hit) ?? null;
        if (node) {
          const rect = canvas.getBoundingClientRect();
          const { scale, tx, ty } = viewRef.current;
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          const x = (px - tx) / scale;
          const y = (py - ty) / scale;
          node.fx = x;
          node.fy = y;
          sim?.alphaTarget(0.25).restart();
          interactionRef.current = { type: "drag", nodeKey: hit, moved: false };
          return;
        }
      }

      const { tx, ty } = viewRef.current;
      interactionRef.current = {
        type: "pan",
        startX: e.clientX,
        startY: e.clientY,
        startTx: tx,
        startTy: ty,
        moved: false,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const it = interactionRef.current;
      if (it?.type === "pan") {
        const dx = e.clientX - it.startX;
        const dy = e.clientY - it.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) it.moved = true;
        setView((v) => ({ ...v, tx: it.startTx + dx, ty: it.startTy + dy }));
        return;
      }

      if (it?.type === "drag") {
        const g = graphRef.current;
        const sim = simRef.current;
        const node = g?.nodeByKey.get(it.nodeKey) ?? null;
        if (!node) return;
        const rect = canvas.getBoundingClientRect();
        const { scale, tx, ty } = viewRef.current;
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const x = (px - tx) / scale;
        const y = (py - ty) / scale;
        node.fx = x;
        node.fy = y;
        it.moved = true;
        sim?.alphaTarget(0.25).restart();
        drawRef.current?.();
        return;
      }

      const hit = pickNodeAt(e.clientX, e.clientY);
      setHoverKey((prev) => (prev === hit ? prev : hit));
    };

    const onPointerUp = (e: PointerEvent) => {
      const it = interactionRef.current;
      interactionRef.current = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      if (it?.type === "drag") {
        const g = graphRef.current;
        const sim = simRef.current;
        const node = g?.nodeByKey.get(it.nodeKey) ?? null;
        if (node) {
          node.fx = null;
          node.fy = null;
        }
        sim?.alphaTarget(0);
        if (!it.moved) setSelectedKey(it.nodeKey);
        return;
      }

      if (it?.type === "pan") {
        if (!it.moved) {
          const hit = pickNodeAt(e.clientX, e.clientY);
          setSelectedKey(hit);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const cur = viewRef.current;
      const zoom = Math.exp(-e.deltaY * 0.001);
      const nextScale = clamp(cur.scale * zoom, 0.25, 2.6);
      const wx = (px - cur.tx) / cur.scale;
      const wy = (py - cur.ty) / cur.scale;
      const nextTx = px - wx * nextScale;
      const nextTy = py - wy * nextScale;
      setView({ scale: nextScale, tx: nextTx, ty: nextTy });
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel as any);
    };
  }, [filtered?.center, pickNodeAt]);

  const applyActorInput = useCallback(() => {
    const id = parseActorIdFromInput(actorInput, actorOptions);
    if (!id) return;
    setActorId(id);
  }, [actorInput, actorOptions]);

  const focusActor = useCallback(
    (id: string) => {
      const opt = optionsById.get(id) ?? { actorId: id, name: id };
      setActorInput(formatActorInput(opt));
      setActorId(id);
    },
    [optionsById]
  );

  const toggleType = useCallback((t: string) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  return (
    <div
      className={clsx(isExpanded && "fixed inset-0 z-50")}
      onClick={() => {
        if (isExpanded) setIsExpanded(false);
      }}
    >
      {isExpanded ? (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
      ) : null}
      <div
        ref={fullscreenRef}
        className={clsx("space-y-4", isExpanded && "relative z-10 h-full overflow-auto p-4 sm:p-6")}
        onClick={(e) => {
          if (isExpanded) e.stopPropagation();
        }}
      >
        <div
          className={clsx(
            "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 backdrop-blur shadow-2xl shadow-black/10 dark:shadow-black/40",
            isExpanded && "min-h-full flex flex-col"
          )}
        >
        <div className="flex flex-col gap-3 px-5 py-4 border-b border-zinc-200/70 dark:border-zinc-800/80">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Actor relationship graph
              </div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">
                Drag nodes, scroll to zoom, click to inspect. Use “Focus” to walk chains.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsExpanded((v) => !v)}
                className="h-9 px-3 inline-flex items-center justify-center rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/40 dark:bg-black/30 text-xs text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white transition-colors"
                aria-pressed={isExpanded}
              >
                {isExpanded ? "Collapse" : "Expand"}
              </button>
              <button
                type="button"
                onClick={resetView}
                className="h-9 px-3 inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/40 dark:bg-black/30 text-xs text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white transition-colors"
              >
                <Icon name="reset" className="h-4 w-4" />
                Reset view
              </button>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-zinc-200/70 dark:border-zinc-800/70 bg-white/40 dark:bg-black/30 text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white transition-colors"
                aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                <Icon name={isFullscreen ? "exitFullscreen" : "fullscreen"} className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            <label className="block flex-1 min-w-[260px]">
              <div className="text-xs text-zinc-600 dark:text-zinc-400">Start actor</div>
              <input
                value={actorInput}
                onChange={(e) => setActorInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyActorInput();
                  }
                }}
                list="actor-graph-options"
                placeholder="Search actors…"
                className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              />
              <datalist id="actor-graph-options">
                {actorOptions.map((o) => (
                  <option key={o.actorId} value={`${o.name} (${o.actorId})`} />
                ))}
              </datalist>
            </label>

            <div className="flex items-end gap-2">
              <label className="block">
                <div className="text-xs text-zinc-600 dark:text-zinc-400">Depth</div>
                <select
                  value={depth}
                  onChange={(e) => setDepth(clamp(Number(e.target.value), 1, 4))}
                  className="mt-1 w-[110px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-2.5 py-2 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                >
                  {[1, 2, 3, 4].map((d) => (
                    <option key={d} value={d}>
                      {d} hop{d === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200 pb-2">
                <input
                  type="checkbox"
                  checked={includeSimilarity}
                  onChange={(e) => setIncludeSimilarity(e.target.checked)}
                />
                Similar actors
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200 pb-2">
                <input
                  type="checkbox"
                  checked={includeDerived}
                  onChange={(e) => setIncludeDerived(e.target.checked)}
                />
                Derived edges
              </label>
              <button
                type="button"
                onClick={applyActorInput}
                className="h-[42px] px-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-sm font-medium hover:opacity-95"
              >
                Load
              </button>
            </div>
          </div>

          {allTypes.length ? (
            <details className="mt-1">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-xs text-zinc-600 dark:text-zinc-400">
                Filters ({enabledTypes.size}/{allTypes.length} relation types)
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {allTypes.map((t) => {
                  const on = enabledTypes.has(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleType(t)}
                      className={clsx(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        on
                          ? "border-blue-600/60 bg-blue-950/20 text-blue-600 dark:text-blue-300"
                          : "border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-black/20 text-zinc-600 dark:text-zinc-400 hover:bg-white dark:hover:bg-black/30"
                      )}
                      aria-pressed={on}
                      title={t}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </details>
          ) : null}

          <details className="mt-2">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-xs text-zinc-600 dark:text-zinc-400">
              Legend
            </summary>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 p-3">
              <div>
                <div className="text-[11px] font-medium tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
                  Nodes
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-zinc-700 dark:text-zinc-200">
                  {(
                    [
                      ["actor", "Actor"],
                      ["campaign", "Campaign"],
                      ["malware", "Malware"],
                      ["infrastructure", "Infrastructure"],
                      ["tool", "Tool"],
                      ["technique", "Technique"],
                      ["cve", "CVE"],
                      ["country", "Country"],
                      ["sector", "Sector"],
                      ["other", "Other"],
                    ] as const
                  ).map(([kind, label]) => {
                    const color =
                      kind === "other"
                        ? kindFill("unknown", darkMode)
                        : kindFill(kind, darkMode);
                    return (
                      <div key={kind} className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: color }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium tracking-wide uppercase text-zinc-600 dark:text-zinc-400">
                  Edges
                </div>
                <div className="mt-2 space-y-2 text-xs text-zinc-700 dark:text-zinc-200">
                  <div className="flex items-center gap-2">
                    <svg width="44" height="10" viewBox="0 0 44 10" aria-hidden="true">
                      <line
                        x1="2"
                        y1="5"
                        x2="42"
                        y2="5"
                        stroke={edgeStroke("kg_relation", darkMode)}
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="min-w-0">
                      Solid = knowledge-graph relation (type controlled by Filters)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg width="44" height="10" viewBox="0 0 44 10" aria-hidden="true">
                      <line
                        x1="2"
                        y1="5"
                        x2="42"
                        y2="5"
                        stroke={edgeStroke("actor_similar_actor", darkMode)}
                        strokeWidth="2"
                        strokeDasharray="6 4"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="min-w-0">
                      Dashed = “Similar actors” (embedding similarity, not evidence)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </details>
        </div>

        <div
          className={clsx(
            "grid",
            isMaximized ? "grid-cols-1 lg:grid-cols-[1fr_360px]" : "grid-cols-1 xl:grid-cols-[1fr_360px]",
            isExpanded && "flex-1"
          )}
        >
          <div className="px-5 py-4">
            <div
              ref={viewportRef}
              className={clsx(
                "relative w-full overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-900/80 bg-white dark:bg-black",
                isMaximized ? "min-h-[520px] h-[calc(100vh-280px)]" : "h-[560px]"
              )}
              style={{
                cursor: interactionRef.current?.type === "drag" ? "grabbing" : "grab",
                clipPath: "inset(0 round 16px)",
                contain: "paint",
                isolation: "isolate",
                transform: "translateZ(0)",
                backfaceVisibility: "hidden",
              }}
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full rounded-2xl"
                style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
                role="img"
                aria-label="Actor relationship graph"
              />

              {loading ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/40 px-4 py-2 text-sm text-zinc-600 dark:text-zinc-300">
                    Loading…
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="max-w-[520px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/40 px-4 py-3 text-sm text-red-600 dark:text-red-300">
                    {error}
                  </div>
                </div>
              ) : null}
            </div>

            {filtered?.truncated ? (
              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  Truncated:
                </span>{" "}
                the graph hit node/edge limits for performance, so it may not show every connection.
              </div>
            ) : null}
          </div>

          <aside className="border-t xl:border-t-0 xl:border-l border-zinc-200/70 dark:border-zinc-800/80 px-5 py-4 space-y-3">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Selection</div>

            {selectedNode ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-3">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {selectedNode.name}
                  </div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
                    {selectedNode.kind}:{selectedNode.entityId}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedNode.kind === "actor" ? (
                      <>
                        <Link
                          href={`/actors/${selectedNode.entityId}`}
                          className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                        >
                          Open profile
                        </Link>
                        <button
                          type="button"
                          onClick={() => focusActor(selectedNode.entityId)}
                          className="inline-flex items-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1.5 text-xs font-medium hover:opacity-95"
                        >
                          Focus
                        </button>
                      </>
                    ) : null}
                    <a
                      href={`/data/kg-entities?q=${encodeURIComponent(selectedNode.entityId)}&kind=${encodeURIComponent(
                        selectedNode.kind
                      )}`}
                      className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                    >
                      KG entity
                    </a>
                    <a
                      href={`/data/kg-relations?q=${encodeURIComponent(selectedNode.entityId)}`}
                      className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-black/30 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/40"
                    >
                      Edges
                    </a>
                  </div>
                </div>

                {selectedStats ? (
                  <div className="space-y-3">
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">
                      {selectedStats.edgeCount} edge{selectedStats.edgeCount === 1 ? "" : "s"} in view
                    </div>

                    {selectedStats.typeCounts.length ? (
                      <div>
                        <div className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                          Relation types
                        </div>
                        <div className="mt-2 space-y-1">
                          {selectedStats.typeCounts.map(([t, c]) => (
                            <div key={t} className="flex items-center justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                              <span className="truncate">{t}</span>
                              <span className="tabular-nums">{c}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {selectedStats.kindCounts.length ? (
                      <div>
                        <div className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                          Neighbor kinds
                        </div>
                        <div className="mt-2 space-y-1">
                          {selectedStats.kindCounts.map(([k, c]) => (
                            <div key={k} className="flex items-center justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                              <span className="truncate">{prettyKind(k)}</span>
                              <span className="tabular-nums">{c}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {selectedNode.kind === "actor" && selectedStats.neighborKeys.length ? (
                      <div>
                        <div className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                          Nearby actors
                        </div>
                        <div className="mt-2 space-y-1">
                          {selectedStats.neighborKeys
                            .map((k) => nodeByKey.get(k))
                            .filter((n): n is ApiNode => !!n && n.kind === "actor")
                            .slice(0, 8)
                            .map((n) => (
                              <button
                                key={n.key}
                                type="button"
                                onClick={() => focusActor(n.entityId)}
                                className="w-full text-left rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-white dark:hover:bg-black/30"
                              >
                                <div className="truncate">{n.name}</div>
                                <div className="mt-0.5 tabular-nums text-[11px] text-zinc-500">{n.entityId}</div>
                              </button>
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-black/20 px-3 py-3 text-sm text-zinc-600 dark:text-zinc-400">
                Click a node to see details.
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
    </div>
  );
}
