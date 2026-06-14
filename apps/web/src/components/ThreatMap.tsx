"use client";

/**
 * ThreatMap — interactive world map of threats.
 *
 * - Each dot = one finding (APT, CVE, attack, TTP, exploit)
 * - Dot color = agent type
 * - Click dot = popup with summary + link to full writeup
 * - Styling matches damianvillarreal.com (zinc-950, Inter, blue-500)
 *
 * Uses D3 for geo projection (Natural Earth), no external map tiles needed.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import type { FeatureCollection } from "geojson";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MapFinding {
  id: string;
  agent: "vuln" | "attack" | "ttp" | "exploit" | "malware";
  title: string;
  summary: string | null;
  severity: string | null;
  cvssScore: string | null;
  cveId: string | null;
  tags: string | null;
  publishedAt: string | null;
  // Geographic origin — inferred from tags/threat actor attribution
  // [longitude, latitude]
  coords: [number, number];
  // Optional: link to full detail page
  href: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_COLOR: Record<string, string> = {
  vuln:    "#3b82f6", // blue-500
  attack:  "#ef4444", // red-500
  ttp:     "#a855f7", // purple-500
  exploit: "#f97316", // orange-500
  malware: "#eab308", // yellow-500
};

const AGENT_LABEL: Record<string, string> = {
  vuln:    "CVE",
  attack:  "Attack",
  ttp:     "TTP",
  exploit: "Exploit",
  malware: "Malware",
};

const SEVERITY_RING: Record<string, string> = {
  critical: "#ef4444",
  high:     "#f97316",
  medium:   "#eab308",
  low:      "#22c55e",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  findings: MapFinding[];
}

interface Popup {
  finding: MapFinding;
  x: number;
  y: number;
}

export function ThreatMap({ findings }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [worldData, setWorldData] = useState<FeatureCollection | null>(null);
  const [dimensions, setDimensions] = useState({ width: 960, height: 500 });

  // ── Load world GeoJSON ──
  useEffect(() => {
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
      .then((r) => r.json())
      .then((topo) => {
        // Convert TopoJSON → GeoJSON inline (avoid topojson dep)
        const { feature } = require("topojson-client") as typeof import("topojson-client");
        const geo = (feature(topo, topo.objects.countries) as any) as FeatureCollection;
        setWorldData(geo);
      })
      .catch(console.error);
  }, []);

  // ── Responsive resize ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) {
        const w = entry.contentRect.width;
        setDimensions({ width: w, height: Math.round(w * 0.52) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Draw map ──
  useEffect(() => {
    if (!svgRef.current || !worldData) return;
    const { width, height } = dimensions;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const projection = d3
      .geoNaturalEarth1()
      .scale(width / 6.2)
      .translate([width / 2, height / 2]);

    const path = d3.geoPath().projection(projection);

    // Graticule (grid lines)
    const graticule = d3.geoGraticule();
    svg
      .append("path")
      .datum(graticule())
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", "#27272a") // zinc-800
      .attr("stroke-width", 0.4);

    // Countries
    svg
      .selectAll("path.country")
      .data(worldData.features)
      .enter()
      .append("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("fill", "#121a2e")   // navy surface
      .attr("stroke", "#3f3f46") // zinc-700
      .attr("stroke-width", 0.5);

    // Sphere outline
    svg
      .append("path")
      .datum({ type: "Sphere" } as Parameters<typeof path>[0])
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", "#3f3f46")
      .attr("stroke-width", 1);

    // ── Dots ──
    const dots = svg
      .selectAll("g.dot")
      .data(findings)
      .enter()
      .append("g")
      .attr("class", "dot")
      .attr("transform", (d) => {
        const p = projection(d.coords);
        return p ? `translate(${p[0]},${p[1]})` : "translate(-9999,-9999)";
      })
      .style("cursor", "pointer");

    // Pulse ring (critical/high only)
    dots
      .filter((d) => d.severity === "critical" || d.severity === "high")
      .append("circle")
      .attr("r", 8)
      .attr("fill", "none")
      .attr("stroke", (d) => SEVERITY_RING[d.severity ?? ""] ?? "#ef4444")
      .attr("stroke-width", 1)
      .attr("opacity", 0.5)
      .each(function () {
        const circle = d3.select(this);
        function pulse() {
          circle
            .attr("r", 5)
            .attr("opacity", 0.6)
            .transition()
            .duration(1400)
            .ease(d3.easeCubicOut)
            .attr("r", 12)
            .attr("opacity", 0)
            .on("end", pulse);
        }
        pulse();
      });

    // Main dot
    dots
      .append("circle")
      .attr("r", 4)
      .attr("fill", (d) => AGENT_COLOR[d.agent] ?? "#3b82f6")
      .attr("stroke", "#060a16") // dark bg
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.9);

    // Click handler
    dots.on("click", function (event: MouseEvent, d: MapFinding) {
      event.stopPropagation();
      const svgRect = svgRef.current!.getBoundingClientRect();
      const containerRect = containerRef.current!.getBoundingClientRect();
      const p = projection(d.coords);
      if (!p) return;

      // Scale SVG coords to container coords
      const scaleX = svgRect.width / dimensions.width;
      const scaleY = svgRect.height / dimensions.height;

      setPopup({
        finding: d,
        x: p[0] * scaleX,
        y: p[1] * scaleY,
      });
    });

    // Dismiss popup on map click
    svg.on("click", () => setPopup(null));
  }, [worldData, findings, dimensions]);

  const parsedTags = useCallback((tagsJson: string | null): string[] => {
    try { return tagsJson ? JSON.parse(tagsJson) : []; }
    catch { return []; }
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950"
    >
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-2">
        {Object.entries(AGENT_LABEL).map(([key, label]) => (
          <span
            key={key}
            className="flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-950/80 backdrop-blur-sm px-2 py-1 rounded-full border border-zinc-800"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: AGENT_COLOR[key] }}
            />
            {label}
          </span>
        ))}
      </div>

      {/* Live indicator */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 text-xs text-zinc-500 bg-zinc-950/80 backdrop-blur-sm px-2 py-1 rounded-full border border-zinc-800">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        Live
      </div>

      {/* SVG Map */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        width="100%"
        className="block bg-[#060a16]"
      />

      {/* Popup */}
      {popup && (
        <div
          className="absolute z-20 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/50 text-sm"
          style={{
            left: Math.min(popup.x + 12, dimensions.width - 300),
            top: Math.max(popup.y - 80, 8),
            // Flip left if near right edge
            ...(popup.x > dimensions.width * 0.7
              ? { left: "auto", right: dimensions.width - popup.x + 12 }
              : {}),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Popup header */}
          <div className="px-4 pt-3 pb-2 border-b border-zinc-800 flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: `${AGENT_COLOR[popup.finding.agent]}20`,
                  color: AGENT_COLOR[popup.finding.agent],
                  border: `1px solid ${AGENT_COLOR[popup.finding.agent]}40`,
                }}
              >
                {AGENT_LABEL[popup.finding.agent]}
              </span>
              {popup.finding.cveId && (
                <span className="text-xs text-zinc-400 tabular-nums tracking-wide">
                  {popup.finding.cveId}
                </span>
              )}
              {popup.finding.severity && (
                <span
                  className="text-xs"
                  style={{ color: SEVERITY_RING[popup.finding.severity] ?? "#71717a" }}
                >
                  {popup.finding.severity}
                </span>
              )}
            </div>
            <button
              onClick={() => setPopup(null)}
              className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0 text-base leading-none"
            >
              ×
            </button>
          </div>

          {/* Title */}
          <div className="px-4 py-2">
            <p className="text-zinc-100 font-medium leading-snug line-clamp-2 text-xs">
              {popup.finding.title}
            </p>
          </div>

          {/* Summary */}
          {popup.finding.summary && (
            <div className="px-4 pb-2">
              <p className="text-zinc-400 text-xs leading-relaxed line-clamp-4">
                {popup.finding.summary}
              </p>
            </div>
          )}

          {/* CVSS score */}
          {popup.finding.cvssScore && (
            <div className="px-4 pb-2 flex items-center gap-2">
              <span className="text-zinc-500 text-xs">CVSS</span>
              <span
                className="text-xs font-bold"
                style={{
                  color:
                    parseFloat(popup.finding.cvssScore) >= 9 ? "#ef4444" :
                    parseFloat(popup.finding.cvssScore) >= 7 ? "#f97316" :
                    parseFloat(popup.finding.cvssScore) >= 4 ? "#eab308" :
                    "#22c55e",
                }}
              >
                {parseFloat(popup.finding.cvssScore).toFixed(1)}
              </span>
            </div>
          )}

          {/* Tags */}
          {parsedTags(popup.finding.tags).length > 0 && (
            <div className="px-4 pb-3 flex flex-wrap gap-1">
              {parsedTags(popup.finding.tags).slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="px-4 py-2 border-t border-zinc-800 flex items-center justify-between">
            <span className="text-xs text-zinc-600">
              {popup.finding.publishedAt
                ? new Date(popup.finding.publishedAt).toLocaleDateString()
                : ""}
            </span>
            <a
              href={popup.finding.href}
              className="text-xs text-blue-500 hover:text-blue-400 transition-colors font-medium"
            >
              Full writeup →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
