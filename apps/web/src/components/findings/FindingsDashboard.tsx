"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buildHref, clamp, parsePositiveInt } from "../../lib/search-params";
import { normalizeMitreTechniqueId } from "../../lib/mitre";
import { FindingCard, type FindingCardModel } from "../FindingCard";

type SortKey = "cvss" | "date" | "type";
type SortDir = "asc" | "desc";

export type FindingsSearchParams = {
  q?: string;
  type?: string;
  mitreId?: string;
  minCvss?: string;
  maxCvss?: string;
  minEpss?: string;
  days?: string;
  from?: string;
  to?: string;
  hasPoc?: string;
  band?: string;
  sort?: SortKey;
  dir?: SortDir;
  page?: string;
  limit?: string;
  hideDismissed?: string;
};

type CvssBand = "exploited" | "critical" | "high" | "medium" | "low" | "unscored";

const BAND_ORDER: CvssBand[] = ["exploited", "critical", "high", "medium", "low", "unscored"];

const BAND_META: Record<CvssBand, { label: string; hint: string; border: string }> = {
  exploited: {
    label: "Actively exploited / KEV",
    hint: "Urgent attention",
    border: "border-l-fuchsia-500",
  },
  critical: { label: "Critical", hint: "CVSS 9.0+", border: "border-l-red-500" },
  high: { label: "High", hint: "CVSS 7.0–8.9", border: "border-l-orange-500" },
  medium: { label: "Medium", hint: "CVSS 4.0–6.9", border: "border-l-yellow-500" },
  low: { label: "Low", hint: "CVSS < 4.0", border: "border-l-zinc-500" },
  unscored: { label: "Unscored", hint: "No CVSS", border: "border-l-zinc-700" },
};

const TYPE_KEYS = ["vuln", "exploit", "malware", "attack", "ttp"] as const;

const TYPE_LABEL: Record<(typeof TYPE_KEYS)[number], string> = {
  vuln: "CVE",
  exploit: "Exploit",
  malware: "Malware",
  attack: "Attack",
  ttp: "TTP",
};

type DatePreset = "today" | "7d" | "30d" | "custom";

function isTypingTarget(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return Boolean(node.closest?.("[contenteditable='true']"));
}

function parseCvss(value: string | null) {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseEpss(value: string | null) {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 1) return null;
  return n;
}

function hasTag(tags: string[], t: string) {
  const needle = t.toLowerCase();
  return tags.some((x) => x.toLowerCase() === needle);
}

function isExploited(r: FindingCardModel) {
  return hasTag(r.tags, "actively-exploited") || hasTag(r.tags, "kev");
}

function hasPoc(r: FindingCardModel) {
  if (r.pocUrl) return true;
  return hasTag(r.tags, "githubpoc");
}

function whenIso(r: FindingCardModel) {
  return r.publishedAt ?? r.createdAt;
}

function cvssBand(r: FindingCardModel): CvssBand {
  if (isExploited(r)) return "exploited";
  const s = parseCvss(r.cvssScore);
  if (s == null) return "unscored";
  if (s >= 9) return "critical";
  if (s >= 7) return "high";
  if (s >= 4) return "medium";
  return "low";
}

function normalizeBand(value: string | undefined): CvssBand | null {
  const v = String(value ?? "").trim().toLowerCase();
  return (BAND_ORDER as readonly string[]).includes(v) ? (v as CvssBand) : null;
}

function normalizeType(value: string | undefined) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v === "cve" || v === "vuln") return "vuln";
  if (v === "exploit") return "exploit";
  if (v === "malware") return "malware";
  if (v === "attack") return "attack";
  if (v === "ttp") return "ttp";
  return null;
}

function normalizeSort(value: string | undefined): SortKey {
  if (value === "cvss" || value === "date" || value === "type") return value;
  return "date";
}

function normalizeDir(value: string | undefined): SortDir {
  if (value === "asc" || value === "desc") return value;
  return "desc";
}

function isIsoDateOnly(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function parseDateOnly(v: string | undefined) {
  if (!v || !isIsoDateOnly(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toDateOnly(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateFromPreset(preset: Exclude<DatePreset, "custom">) {
  const now = new Date();
  const d = new Date(now);
  if (preset === "today") d.setDate(d.getDate() - 1);
  if (preset === "7d") d.setDate(d.getDate() - 7);
  if (preset === "30d") d.setDate(d.getDate() - 30);
  return d;
}

type TriageState = { reviewedIds: string[]; dismissedIds: string[] };
const TRIAGE_KEY = "ti_findings_triage_v1";

function loadTriage(): TriageState {
  try {
    const raw = localStorage.getItem(TRIAGE_KEY);
    if (!raw) return { reviewedIds: [], dismissedIds: [] };
    const parsed = JSON.parse(raw) as any;
    return {
      reviewedIds: Array.isArray(parsed.reviewedIds) ? parsed.reviewedIds.map(String) : [],
      dismissedIds: Array.isArray(parsed.dismissedIds) ? parsed.dismissedIds.map(String) : [],
    };
  } catch {
    return { reviewedIds: [], dismissedIds: [] };
  }
}

function saveTriage(state: TriageState) {
  try {
    localStorage.setItem(TRIAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows: FindingCardModel[]) {
  const header = [
    "id",
    "agent",
    "cveId",
    "title",
    "severity",
    "cvssScore",
    "epssScore",
    "publishedAt",
    "sourceUrl",
    "pocUrl",
    "tags",
  ];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    const needs = /[",\n]/.test(s);
    const out = s.replace(/"/g, '""');
    return needs ? `"${out}"` : out;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.agent,
        r.cveId ?? "",
        r.title,
        r.severity ?? "",
        r.cvssScore ?? "",
        r.epssScore ?? "",
        r.publishedAt ?? "",
        r.sourceUrl ?? "",
        r.pocUrl ?? "",
        r.tags.join("|"),
      ]
        .map(esc)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function FindingsDashboard({
  rows,
  initialSearchParams,
}: {
  rows: FindingCardModel[];
  initialSearchParams: FindingsSearchParams;
}) {
  const router = useRouter();
  const mitreId = normalizeMitreTechniqueId(initialSearchParams.mitreId);

  const [query, setQuery] = useState(() => String(initialSearchParams.q ?? ""));
  const [type, setType] = useState<(typeof TYPE_KEYS)[number] | null>(() => {
    const t = normalizeType(initialSearchParams.type);
    return (t && (TYPE_KEYS as readonly string[]).includes(t) ? (t as any) : null) as any;
  });
  const [bandFilter, setBandFilter] = useState<CvssBand | null>(() =>
    normalizeBand(initialSearchParams.band)
  );
  const initialMinCvss = (() => {
    const n = Number(initialSearchParams.minCvss ?? 0);
    return Number.isFinite(n) ? clamp(n, 0, 10) : 0;
  })();
  const initialMaxCvss = (() => {
    const n = Number(initialSearchParams.maxCvss ?? 10);
    const v = Number.isFinite(n) ? clamp(n, 0, 10) : 10;
    return Math.max(v, initialMinCvss);
  })();

  const [minCvss, setMinCvss] = useState<number>(() => initialMinCvss);
  const [maxCvss, setMaxCvss] = useState<number>(() => initialMaxCvss);

  const [minEpss, setMinEpss] = useState<number>(() => {
    const n = Number(initialSearchParams.minEpss ?? 0);
    return Number.isFinite(n) ? clamp(n, 0, 100) : 0;
  });

  const [preset, setPreset] = useState<DatePreset>(() => {
    const days = String(initialSearchParams.days ?? "").trim();
    if (days === "1") return "today";
    if (days === "7") return "7d";
    if (days === "30") return "30d";
    if (initialSearchParams.from || initialSearchParams.to) return "custom";
    return "7d";
  });
  const [from, setFrom] = useState<string>(() => {
    const v = String(initialSearchParams.from ?? "");
    return isIsoDateOnly(v) ? v : "";
  });
  const [to, setTo] = useState<string>(() => {
    const v = String(initialSearchParams.to ?? "");
    return isIsoDateOnly(v) ? v : "";
  });

  const [hasPocOnly, setHasPocOnly] = useState<boolean>(() => initialSearchParams.hasPoc === "1");
  const [hideDismissed, setHideDismissed] = useState<boolean>(() => initialSearchParams.hideDismissed === "1");
  const [sortKey, setSortKey] = useState<SortKey>(() => normalizeSort(initialSearchParams.sort));
  const [sortDir, setSortDir] = useState<SortDir>(() => normalizeDir(initialSearchParams.dir));
  const [limit, setLimit] = useState<number>(() => clamp(parsePositiveInt(initialSearchParams.limit, 25), 25, 50));
  const [page, setPage] = useState<number>(() => parsePositiveInt(initialSearchParams.page, 1));

  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [triage, setTriage] = useState<TriageState | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [toast, setToast] = useState<string>("");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const cardRefs = useRef(new Map<string, HTMLDivElement | null>());
  const lastHrefRef = useRef<string>("");
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTriage(loadTriage());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 800);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!moreOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const el = moreMenuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setMoreOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!checked.size) setMoreOpen(false);
  }, [checked.size]);

  const triageSets = useMemo(() => {
    const reviewed = new Set((triage?.reviewedIds ?? []).map(String));
    const dismissed = new Set((triage?.dismissedIds ?? []).map(String));
    return { reviewed, dismissed };
  }, [triage]);

  const dateRange = useMemo(() => {
    if (preset === "custom") {
      const fromDate = parseDateOnly(from);
      const toDate = parseDateOnly(to);
      // Make "to" inclusive by using an exclusive end boundary.
      const toExclusive = toDate ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000) : null;
      return { from: fromDate, to: toExclusive };
    }
    return { from: dateFromPreset(preset), to: null as Date | null };
  }, [preset, from, to]);

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (type && r.agent !== type) return false;

      if (bandFilter) {
        if (cvssBand(r) !== bandFilter) return false;
      } else {
        const score = parseCvss(r.cvssScore);
        if (minCvss > 0) {
          if (score == null) return false;
          if (score < minCvss) return false;
        }
        if (maxCvss < 10) {
          if (score == null) return false;
          if (score > maxCvss) return false;
        }
      }

      if (minEpss > 0) {
        const epss = parseEpss(r.epssScore);
        if (epss == null) return false;
        if (epss * 100 < minEpss) return false;
      }

      if (hasPocOnly && !hasPoc(r)) return false;

      if (hideDismissed && triageSets.dismissed.has(r.id)) return false;

      if (dateRange.from) {
        const d = new Date(whenIso(r));
        if (!Number.isNaN(d.getTime()) && d < dateRange.from) return false;
      }
      if (dateRange.to) {
        const d = new Date(whenIso(r));
        if (!Number.isNaN(d.getTime()) && d >= dateRange.to) return false;
      }

      if (normalizedQuery) {
        const hay = [
          r.title,
          r.summary ?? "",
          r.cveId ?? "",
          r.sourceTitle ?? "",
          r.sourceUrl ?? "",
          r.pocUrl ?? "",
          r.tags.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(normalizedQuery)) return false;
      }

      return true;
    });
  }, [
    rows,
    type,
    bandFilter,
    minCvss,
    maxCvss,
    minEpss,
    hasPocOnly,
    hideDismissed,
    triageSets.dismissed,
    dateRange,
    normalizedQuery,
  ]);

  const groupCounts = useMemo(() => {
    const counts = new Map<CvssBand, number>();
    for (const band of BAND_ORDER) counts.set(band, 0);
    for (const r of filtered) counts.set(cvssBand(r), (counts.get(cvssBand(r)) ?? 0) + 1);
    return counts;
  }, [filtered]);

  const typeOptionCounts = useMemo(() => {
    const counts: Record<string, number> = { vuln: 0, exploit: 0, malware: 0, attack: 0, ttp: 0 };
    for (const r of rows) {
      if (bandFilter) {
        if (cvssBand(r) !== bandFilter) continue;
      } else {
        const score = parseCvss(r.cvssScore);
        if (minCvss > 0) {
          if (score == null || score < minCvss) continue;
        }
        if (maxCvss < 10) {
          if (score == null || score > maxCvss) continue;
        }
      }
      if (minEpss > 0) {
        const epss = parseEpss(r.epssScore);
        if (epss == null || epss * 100 < minEpss) continue;
      }
      if (hasPocOnly && !hasPoc(r)) continue;
      if (hideDismissed && triageSets.dismissed.has(r.id)) continue;
      if (dateRange.from) {
        const d = new Date(whenIso(r));
        if (!Number.isNaN(d.getTime()) && d < dateRange.from) continue;
      }
      if (dateRange.to) {
        const d = new Date(whenIso(r));
        if (!Number.isNaN(d.getTime()) && d >= dateRange.to) continue;
      }
      if (normalizedQuery) {
        const hay = [
          r.title,
          r.summary ?? "",
          r.cveId ?? "",
          r.sourceTitle ?? "",
          r.sourceUrl ?? "",
          r.pocUrl ?? "",
          r.tags.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(normalizedQuery)) continue;
      }
      counts[r.agent] = (counts[r.agent] ?? 0) + 1;
    }
    return counts;
  }, [rows, bandFilter, minCvss, maxCvss, minEpss, hasPocOnly, hideDismissed, triageSets.dismissed, dateRange, normalizedQuery]);

  const sorted = useMemo(() => {
    const buckets = new Map<CvssBand, FindingCardModel[]>();
    for (const band of BAND_ORDER) buckets.set(band, []);
    for (const r of filtered) buckets.get(cvssBand(r))?.push(r);

    const cmp = (a: FindingCardModel, b: FindingCardModel) => {
      if (sortKey === "type") {
        const la = TYPE_LABEL[a.agent as any] ?? a.agent;
        const lb = TYPE_LABEL[b.agent as any] ?? b.agent;
        const v = la.localeCompare(lb);
        return sortDir === "asc" ? v : -v;
      }
      if (sortKey === "cvss") {
        const sa = parseCvss(a.cvssScore) ?? -1;
        const sb = parseCvss(b.cvssScore) ?? -1;
        const v = sa - sb;
        return sortDir === "asc" ? v : -v;
      }

      const da = new Date(whenIso(a)).getTime();
      const db = new Date(whenIso(b)).getTime();
      const v = da - db;
      return sortDir === "asc" ? v : -v;
    };

    const out: FindingCardModel[] = [];
    for (const band of BAND_ORDER) {
      const bucket = buckets.get(band) ?? [];
      bucket.sort(cmp);
      out.push(...bucket);
    }
    return out;
  }, [filtered, sortKey, sortDir]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(sorted.length / limit)), [sorted.length, limit]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paged = useMemo(() => {
    const start = (page - 1) * limit;
    return sorted.slice(start, start + limit);
  }, [sorted, page, limit]);

  const pageGrouped = useMemo(() => {
    const m = new Map<CvssBand, FindingCardModel[]>();
    for (const b of BAND_ORDER) m.set(b, []);
    for (const r of paged) m.get(cvssBand(r))?.push(r);
    return m;
  }, [paged]);

  const activePocs = useMemo(() => {
    // Keep PoCs visible by default (they tend to be unscored when they first land).
    // If the user is already filtering by CVSS or PoC-only, don't add extra noise.
    if (hasPocOnly) return [];
    if (bandFilter) return [];
    if (minEpss > 0) return [];
    if (minCvss > 0 || maxCvss < 10) return [];

    const pocs = filtered.filter(hasPoc);
    pocs.sort((a, b) => new Date(whenIso(b)).getTime() - new Date(whenIso(a)).getTime());
    return pocs.slice(0, 6);
  }, [filtered, hasPocOnly, bandFilter, minEpss, minCvss, maxCvss]);

  const activePocsTotal = useMemo(() => {
    if (hasPocOnly) return 0;
    if (bandFilter) return 0;
    if (minEpss > 0) return 0;
    if (minCvss > 0 || maxCvss < 10) return 0;
    return filtered.filter(hasPoc).length;
  }, [filtered, hasPocOnly, bandFilter, minEpss, minCvss, maxCvss]);

  const visibleIds = useMemo(() => paged.map((r) => r.id), [paged]);

  const filteredIds = useMemo(() => sorted.map((r) => r.id), [sorted]);

  const selectedRows = useMemo(() => {
    if (!checked.size) return [];
    return rows.filter((r) => checked.has(r.id));
  }, [rows, checked]);

  const selectedMeta = useMemo(() => {
    if (!checked.size) return { dismissed: 0, reviewed: 0 };
    let dismissed = 0;
    let reviewed = 0;
    for (const id of checked) {
      if (triageSets.dismissed.has(id)) dismissed += 1;
      if (triageSets.reviewed.has(id)) reviewed += 1;
    }
    return { dismissed, reviewed };
  }, [checked, triageSets.dismissed, triageSets.reviewed]);

  const currentParams: FindingsSearchParams = useMemo(() => {
    const p: FindingsSearchParams = {};
    if (query.trim()) p.q = query.trim();
    if (type) p.type = type;
    if (mitreId) p.mitreId = mitreId;
    if (bandFilter) p.band = bandFilter;
    if (minCvss > 0) p.minCvss = String(minCvss);
    if (maxCvss < 10) p.maxCvss = String(maxCvss);
    if (minEpss > 0) p.minEpss = String(minEpss);
    if (hasPocOnly) p.hasPoc = "1";
    if (hideDismissed) p.hideDismissed = "1";
    p.sort = sortKey;
    p.dir = sortDir;
    p.page = String(page);
    p.limit = String(limit);
    if (preset !== "custom") p.days = preset === "today" ? "1" : preset === "7d" ? "7" : "30";
    else {
      if (isIsoDateOnly(from)) p.from = from;
      if (isIsoDateOnly(to)) p.to = to;
    }
    return p;
  }, [
    query,
    type,
    mitreId,
    bandFilter,
    minCvss,
    maxCvss,
    minEpss,
    hasPocOnly,
    hideDismissed,
    sortKey,
    sortDir,
    page,
    limit,
    preset,
    from,
    to,
  ]);

  useEffect(() => {
    const href = buildHref("/findings", currentParams as any, {});
    if (href === lastHrefRef.current) return;
    lastHrefRef.current = href;
    window.history.replaceState(null, "", href);
  }, [currentParams]);

  const toggleChecked = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = () => setChecked(new Set());

  const selectAllVisible = useCallback(() => {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }, [visibleIds]);

  const selectAllFiltered = useCallback(() => {
    if (!filteredIds.length) return;
    if (filteredIds.length > 200) {
      if (!confirm(`Select all ${filteredIds.length} results?`)) return;
    }
    setChecked(new Set(filteredIds));
  }, [filteredIds]);

  const markReviewed = () => {
    if (!triage || !checked.size) return;
    const reviewed = new Set(triage.reviewedIds);
    for (const id of checked) reviewed.add(id);
    const next = { ...triage, reviewedIds: Array.from(reviewed) };
    setTriage(next);
    saveTriage(next);
    setToast(`Marked reviewed: ${checked.size}`);
    clearSelection();
  };

  const unreview = () => {
    if (!triage || !checked.size) return;
    const reviewed = new Set(triage.reviewedIds);
    let changed = 0;
    for (const id of checked) {
      if (reviewed.delete(id)) changed += 1;
    }
    const next = { ...triage, reviewedIds: Array.from(reviewed) };
    setTriage(next);
    saveTriage(next);
    setToast(changed ? `Unreviewed: ${changed}` : "No reviewed items selected");
    clearSelection();
  };

  const dismiss = () => {
    if (!triage || !checked.size) return;
    const dismissed = new Set(triage.dismissedIds);
    for (const id of checked) dismissed.add(id);
    const next = { ...triage, dismissedIds: Array.from(dismissed) };
    setTriage(next);
    saveTriage(next);
    setToast(`Dismissed: ${checked.size}`);
    clearSelection();
  };

  const undismiss = () => {
    if (!triage || !checked.size) return;
    const dismissed = new Set(triage.dismissedIds);
    let changed = 0;
    for (const id of checked) {
      if (dismissed.delete(id)) changed += 1;
    }
    const next = { ...triage, dismissedIds: Array.from(dismissed) };
    setTriage(next);
    saveTriage(next);
    setToast(changed ? `Restored: ${changed}` : "No dismissed items selected");
    clearSelection();
  };

  const exportJson = () => {
    if (!selectedRows.length) return;
    downloadText(
      `findings-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(selectedRows, null, 2),
      "application/json"
    );
  };

  const exportCsv = () => {
    if (!selectedRows.length) return;
    downloadText(
      `findings-export-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(selectedRows),
      "text/csv"
    );
  };

  const sendToJira = async () => {
    if (!selectedRows.length) return;
    if (!confirm(`Send ${selectedRows.length} finding(s) to Jira automation webhooks?`)) return;
    try {
      const res = await fetch("/api/integrations/jira-automation/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingIds: selectedRows.map((r) => r.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setToast(`Sent to Jira: ${data.sent ?? 0}`);
      clearSelection();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to send to Jira");
    }
  };

  const sendToSlack = async () => {
    if (!selectedRows.length) return;
    if (!confirm(`Send ${selectedRows.length} finding(s) to Slack webhooks?`)) return;
    try {
      const res = await fetch("/api/integrations/slack-webhooks/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingIds: selectedRows.map((r) => r.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setToast(`Sent to Slack: ${data.sent ?? 0}`);
      clearSelection();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to send to Slack");
    }
  };

  const sendToTeams = async () => {
    if (!selectedRows.length) return;
    if (!confirm(`Send ${selectedRows.length} finding(s) to Microsoft Teams webhooks?`)) return;
    try {
      const res = await fetch("/api/integrations/microsoft-teams/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingIds: selectedRows.map((r) => r.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setToast(`Sent to Teams: ${data.sent ?? 0}`);
      clearSelection();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to send to Teams");
    }
  };

  const sendToDiscord = async () => {
    if (!selectedRows.length) return;
    if (!confirm(`Send ${selectedRows.length} finding(s) to Discord webhooks?`)) return;
    try {
      const res = await fetch("/api/integrations/discord-webhooks/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingIds: selectedRows.map((r) => r.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setToast(`Sent to Discord: ${data.sent ?? 0}`);
      clearSelection();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to send to Discord");
    }
  };

  const sendToSoar = async () => {
    if (!selectedRows.length) return;
    if (!confirm(`Send ${selectedRows.length} finding(s) to SOAR webhooks?`)) return;
    try {
      const res = await fetch("/api/integrations/soar-webhooks/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingIds: selectedRows.map((r) => r.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setToast(`Sent to SOAR: ${data.sent ?? 0}`);
      clearSelection();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to send to SOAR");
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (!visibleIds.length) return;

      if ((e.key === "A" || e.key === "a") && e.shiftKey) {
        e.preventDefault();
        selectAllVisible();
        setToast(`Selected ${visibleIds.length}`);
        return;
      }

      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const current = focusId ?? visibleIds[0];
        const idx = visibleIds.indexOf(current);
        const nextIdx =
          e.key === "j"
            ? Math.min(visibleIds.length - 1, Math.max(0, idx + 1))
            : Math.max(0, idx - 1);
        const nextId = visibleIds[nextIdx] ?? visibleIds[0];
        setFocusId(nextId);
        const el = cardRefs.current.get(nextId);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }

      if (e.key === " " || e.key === "Spacebar") {
        if (!focusId) return;
        e.preventDefault();
        toggleChecked(focusId);
        return;
      }

      if (e.key === "Enter") {
        if (!focusId) return;
        const row = paged.find((r) => r.id === focusId);
        if (!row) return;
        e.preventDefault();
        if (row.sourceUrl) window.open(row.sourceUrl, "_blank", "noopener,noreferrer");
        else router.push(`/findings/${row.id}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visibleIds, focusId, paged, router, selectAllVisible, toggleChecked]);

  const chips = useMemo(() => {
    const out: Array<{ label: string; onRemove: () => void }> = [];
    if (query.trim()) out.push({ label: `Search: ${query.trim()}`, onRemove: () => setQuery("") });
    if (type) out.push({ label: `Type: ${TYPE_LABEL[type]}`, onRemove: () => setType(null) });
    if (bandFilter) out.push({ label: `Band: ${BAND_META[bandFilter].label}`, onRemove: () => setBandFilter(null) });
    if (minCvss > 0) out.push({ label: `Min CVSS: ${minCvss.toFixed(1)}`, onRemove: () => setMinCvss(0) });
    if (maxCvss < 10) out.push({ label: `Max CVSS: ${maxCvss.toFixed(1)}`, onRemove: () => setMaxCvss(10) });
    if (minEpss > 0) out.push({ label: `Min EPSS: ${minEpss.toFixed(0)}%`, onRemove: () => setMinEpss(0) });
    if (preset !== "7d") {
      if (preset === "today") out.push({ label: "Date: Today", onRemove: () => setPreset("7d") });
      else if (preset === "30d") out.push({ label: "Date: Last 30d", onRemove: () => setPreset("7d") });
      else out.push({ label: `Date: ${from || "…"} → ${to || "…"}`, onRemove: () => setPreset("7d") });
    }
    if (hasPocOnly) out.push({ label: "Has PoC", onRemove: () => setHasPocOnly(false) });
    if (hideDismissed) out.push({ label: "Hide dismissed", onRemove: () => setHideDismissed(false) });
    return out;
  }, [query, type, bandFilter, minCvss, maxCvss, minEpss, preset, from, to, hasPocOnly, hideDismissed]);

  const resetAll = () => {
    setQuery("");
    setType(null);
    setBandFilter(null);
    setMinCvss(0);
    setMaxCvss(10);
    setMinEpss(0);
    setPreset("7d");
    setFrom("");
    setTo("");
    setHasPocOnly(false);
    setHideDismissed(false);
    setSortKey("date");
    setSortDir("desc");
    setLimit(25);
    setPage(1);
    clearSelection();
  };

  const hasAnyActive =
    chips.length > 0 || sortKey !== "date" || sortDir !== "desc" || limit !== 25 || page !== 1;

  return (
      <div className="mx-auto max-w-[1600px] px-6 sm:px-8 py-10 space-y-6">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Findings</h1>
            <p className="text-sm text-zinc-500">
              Latest CVEs, attacks, TTPs, exploit drops, and malware — generated by autonomous agents.
            </p>
          </div>
          <a
            href="/integrations/jira-automation"
            className="shrink-0 text-xs text-blue-500 hover:text-blue-400 transition-colors"
          >
            Jira automations →
          </a>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-xs text-zinc-300">
          <span className="font-medium text-zinc-200">Note:</span> AI is increasingly used for vulnerability research,
          and many public PoCs are fake or hallucinated. Always validate PoCs and use discretion before actioning.
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
              }}
              placeholder='Search "WordPress", "Termix", "CVE-2026-…"'
              className="w-full rounded-xl border border-[color:var(--ti-border)] bg-[color:var(--ti-card)] px-4 py-2 text-sm text-[color:var(--ti-fg)] placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
            />
          <div className="flex items-center gap-2">
            <select
              value={sortKey}
              onChange={(e) => {
                setSortKey(normalizeSort(e.target.value));
                setPage(1);
              }}
              className="rounded-xl border border-[color:var(--ti-border)] bg-[color:var(--ti-card)] px-3 py-2 text-sm text-[color:var(--ti-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ti-ring)]"
              aria-label="Sort by"
            >
              <option value="date">Sort: Date</option>
              <option value="cvss">Sort: CVSS</option>
              <option value="type">Sort: Type</option>
            </select>
            <button
              type="button"
              onClick={() => {
                setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                setPage(1);
              }}
              className="rounded-xl border border-[color:var(--ti-border)] bg-[color:var(--ti-card)] px-3 py-2 text-sm text-[color:var(--ti-fg)] hover:bg-white/85 dark:hover:bg-white/5 transition-colors"
              aria-label="Toggle sort direction"
              title="Toggle sort direction"
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </div>

        {chips.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => {
                  c.onRemove();
                  setPage(1);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                <span className="truncate max-w-[360px]">{c.label}</span>
                <span className="text-zinc-500">×</span>
              </button>
            ))}
            {hasAnyActive ? (
              <button type="button" onClick={resetAll} className="text-xs text-zinc-500 hover:text-zinc-300">
                Clear all
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
        <aside className="lg:sticky lg:top-6 space-y-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-4">
            <div className="space-y-2">
              <div className="text-xs font-medium text-zinc-400">Type</div>
              <div className="grid grid-cols-2 gap-2">
                {TYPE_KEYS.map((k) => {
                  const active = type === k;
                  const count = typeOptionCounts[k] ?? 0;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setType(active ? null : k);
                        setPage(1);
                      }}
                      className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                        active
                          ? "border-blue-600/60 bg-blue-950/40 text-blue-200"
                          : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                      }`}
                      aria-pressed={active}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>{TYPE_LABEL[k]}</span>
                        <span className="tabular-nums text-zinc-500">{count}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-zinc-400">Min CVSS</div>
                <div className="text-xs tabular-nums text-zinc-400">{minCvss.toFixed(1)}</div>
              </div>
              <input
                type="range"
                min={0}
                max={maxCvss}
                step={0.1}
                value={minCvss}
                onChange={(e) => {
                  const next = clamp(Number(e.target.value), 0, 10);
                  setMinCvss(next);
                  if (next > maxCvss) setMaxCvss(next);
                  setPage(1);
                }}
                className="w-full"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={maxCvss}
                  step={0.1}
                  value={minCvss}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const next = Number.isFinite(n) ? clamp(n, 0, 10) : 0;
                    setMinCvss(next);
                    if (next > maxCvss) setMaxCvss(next);
                    setPage(1);
                  }}
                  className="w-[92px] rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs text-zinc-200"
                />
                <button
                  type="button"
                  onClick={() => {
                    setMinCvss(0);
                    setPage(1);
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-zinc-400">Max CVSS</div>
                <div className="text-xs tabular-nums text-zinc-400">{maxCvss.toFixed(1)}</div>
              </div>
              <input
                type="range"
                min={minCvss}
                max={10}
                step={0.1}
                value={maxCvss}
                onChange={(e) => {
                  const next = clamp(Number(e.target.value), 0, 10);
                  setMaxCvss(next);
                  if (next < minCvss) setMinCvss(next);
                  setPage(1);
                }}
                className="w-full"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={minCvss}
                  max={10}
                  step={0.1}
                  value={maxCvss}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const next = Number.isFinite(n) ? clamp(n, 0, 10) : 10;
                    setMaxCvss(next);
                    if (next < minCvss) setMinCvss(next);
                    setPage(1);
                  }}
                  className="w-[92px] rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs text-zinc-200"
                />
                <button
                  type="button"
                  onClick={() => {
                    setMaxCvss(10);
                    setPage(1);
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-zinc-400">Min EPSS</div>
                <div className="text-xs tabular-nums text-zinc-400">{minEpss.toFixed(0)}%</div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={minEpss}
                onChange={(e) => {
                  const next = clamp(Number(e.target.value), 0, 100);
                  setMinEpss(next);
                  setPage(1);
                }}
                className="w-full"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={minEpss}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const next = Number.isFinite(n) ? clamp(n, 0, 100) : 0;
                    setMinEpss(next);
                    setPage(1);
                  }}
                  className="w-[92px] rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs text-zinc-200"
                />
                <button
                  type="button"
                  onClick={() => {
                    setMinEpss(0);
                    setPage(1);
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Reset
                </button>
              </div>
              <div className="text-[11px] text-zinc-500">Filters out findings without EPSS enrichment.</div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-zinc-400">Date range</div>
              <select
                value={preset}
                onChange={(e) => {
                  const next = e.target.value as DatePreset;
                  setPreset(next);
                  if (next !== "custom") {
                    setFrom("");
                    setTo("");
                  } else {
                    setFrom(toDateOnly(dateFromPreset("7d")));
                    setTo(toDateOnly(new Date()));
                  }
                  setPage(1);
                }}
                className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="today">Today</option>
                <option value="7d">Last 7d</option>
                <option value="30d">Last 30d</option>
                <option value="custom">Custom</option>
              </select>

              {preset === "custom" ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[11px] text-zinc-500 mb-1">From</div>
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => {
                        setFrom(e.target.value);
                        setPage(1);
                      }}
                      className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-200"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500 mb-1">To</div>
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => {
                        setTo(e.target.value);
                        setPage(1);
                      }}
                      className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs text-zinc-200"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={hasPocOnly}
                  onChange={(e) => {
                    setHasPocOnly(e.target.checked);
                    setPage(1);
                  }}
                />
                Has PoC
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={hideDismissed}
                  onChange={(e) => {
                    setHideDismissed(e.target.checked);
                    setPage(1);
                  }}
                />
                Hide dismissed
              </label>
            </div>

            <div className="text-[11px] text-zinc-500">
              Shortcuts: <span className="font-mono">j/k</span> navigate ·{" "}
              <span className="font-mono">Space</span> select ·{" "}
              <span className="font-mono">Enter</span> open source ·{" "}
              <span className="font-mono">Shift+A</span> select page
            </div>
          </div>
        </aside>

        <section className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-zinc-400">
              Showing <span className="tabular-nums">{paged.length}</span> of{" "}
              <span className="tabular-nums">{sorted.length}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
              >
                Prev
              </button>
              <span className="text-xs text-zinc-500">
                Page <span className="tabular-nums">{page}</span> /{" "}
                <span className="tabular-nums">{totalPages}</span>
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>

          {!sorted.length ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 text-sm text-zinc-400">
              No findings match your filters.
            </div>
          ) : null}

          {activePocs.length ? (
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base md:text-lg font-semibold text-zinc-200">
                      Active PoCs
                    </h2>
                    <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400 tabular-nums">
                      {activePocsTotal}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    PoC-linked findings (including unscored).
                  </p>
                </div>
                <Link
                  href={buildHref("/findings", currentParams as any, {
                    hasPoc: "1",
                    band: undefined,
                    minCvss: undefined,
                    maxCvss: undefined,
                    sort: "date",
                    dir: "desc",
                    page: "1",
                  })}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
                >
                  View all
                </Link>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                {activePocs.map((finding) => (
                  <div
                    key={finding.id}
                    role="link"
                    tabIndex={0}
                    className="block cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
                    onClick={() => router.push(`/findings/${finding.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/findings/${finding.id}`);
                      }
                    }}
                  >
                    <FindingCard
                      finding={finding}
                      className={["pl-6", "border-l-4", "border-l-orange-500"].join(" ")}
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {BAND_ORDER.filter((b) => (pageGrouped.get(b)?.length ?? 0) > 0).map((band) => {
            const total = groupCounts.get(band) ?? 0;
            const items = pageGrouped.get(band) ?? [];
            const meta = BAND_META[band];
            return (
              <section key={band} className="space-y-3">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base md:text-lg font-semibold text-zinc-200">
                        {meta.label}
                      </h2>
                      <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400 tabular-nums">
                        {total}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500">{meta.hint}</p>
                  </div>
                  <Link
                    href={buildHref("/findings", currentParams as any, {
                      band,
                      minCvss: undefined,
                      maxCvss: undefined,
                      sort: "date",
                      dir: "desc",
                      page: "1",
                    })}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
                  >
                    View all
                  </Link>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                  {items.map((finding) => {
                    const selected = checked.has(finding.id);
                    const dismissed = triageSets.dismissed.has(finding.id);
                    const reviewed = triageSets.reviewed.has(finding.id);
                    const focused = focusId === finding.id;

                    return (
                      <div
                        key={finding.id}
                        ref={(el) => {
                          cardRefs.current.set(finding.id, el);
                        }}
                        className={`relative ${focused ? "ring-2 ring-blue-600/40 rounded-xl" : ""}`}
                        onMouseEnter={() => setFocusId(finding.id)}
                      >
                        <div className="absolute left-3 top-3 z-10">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleChecked(finding.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>

                        {dismissed ? (
                          <div className="absolute right-3 top-3 z-10 rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-500">
                            Dismissed
                          </div>
                        ) : reviewed ? (
                          <div className="absolute right-3 top-3 z-10 rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-500">
                            Reviewed
                          </div>
                        ) : null}

                        <Link
                          href={`/findings/${finding.id}`}
                          className="block"
                          onClick={(e) => {
                            const target = e.target as HTMLElement | null;
                            if (target?.closest("input[type='checkbox']")) e.preventDefault();
                          }}
                        >
                          <FindingCard
                            finding={finding}
                            className={[
                              "pl-6",
                              "border-l-4",
                              meta.border,
                              dismissed ? "opacity-60" : "",
                            ].join(" ")}
                          />
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {totalPages > 1 && page < totalPages ? (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
              >
                Next page
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {checked.size ? (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-4 z-40 w-[min(980px,calc(100vw-24px))]">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/90 backdrop-blur px-4 py-3 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="text-sm text-zinc-200">
                <span className="tabular-nums font-medium">{checked.size}</span> selected
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:ml-auto">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllVisible}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
                  >
                    Select page
                  </button>
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900"
                  >
                    Select all
                  </button>
                </div>

                <div className="hidden sm:block h-5 w-px bg-zinc-800/80 mx-1" aria-hidden="true" />

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={markReviewed}
                    className="rounded-lg bg-zinc-100 text-zinc-900 px-3 py-1.5 text-xs font-medium hover:bg-white"
                  >
                    Mark reviewed
                  </button>
                  <button
                    type="button"
                    onClick={dismiss}
                    className="rounded-lg bg-rose-600/90 text-white px-3 py-1.5 text-xs font-medium hover:bg-rose-600"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={sendToJira}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
                  >
                    Create Jira ticket
                  </button>
                  <button
                    type="button"
                    onClick={sendToSlack}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
                  >
                    Send to Slack
                  </button>

                  <div className="relative" ref={moreMenuRef}>
                    <button
                      type="button"
                      onClick={() => setMoreOpen((v) => !v)}
                      className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
                      aria-haspopup="menu"
                      aria-expanded={moreOpen}
                    >
                      More…
                    </button>

                    {moreOpen ? (
                      <div
                        role="menu"
                        className="absolute right-0 mt-2 z-50 w-56 rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl p-1"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoreOpen(false);
                            unreview();
                          }}
                          disabled={selectedMeta.reviewed === 0}
                          className="w-full text-left rounded-lg px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                        >
                          Unreview
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoreOpen(false);
                            undismiss();
                          }}
                          disabled={selectedMeta.dismissed === 0}
                          className="w-full text-left rounded-lg px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                        >
                          Restore
                        </button>

                        <div className="my-1 h-px bg-zinc-800/80" role="separator" />

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoreOpen(false);
                            void sendToTeams();
                          }}
                          disabled={!selectedRows.length}
                          className="w-full text-left rounded-lg px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                        >
                          Send to Teams
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoreOpen(false);
                            void sendToDiscord();
                          }}
                          disabled={!selectedRows.length}
                          className="w-full text-left rounded-lg px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                        >
                          Send to Discord
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoreOpen(false);
                            void sendToSoar();
                          }}
                          disabled={!selectedRows.length}
                          className="w-full text-left rounded-lg px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                        >
                          Send to SOAR
                        </button>

                        <div className="my-1 h-px bg-zinc-800/80" role="separator" />

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoreOpen(false);
                            exportJson();
                          }}
                          disabled={!selectedRows.length}
                          className="w-full text-left rounded-lg px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                        >
                          Export JSON
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMoreOpen(false);
                            exportCsv();
                          }}
                          disabled={!selectedRows.length}
                          className="w-full text-left rounded-lg px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
                        >
                          Export CSV
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      clearSelection();
                    }}
                    className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed right-4 top-4 z-50 rounded-xl border border-zinc-800 bg-zinc-950/90 backdrop-blur px-4 py-2 text-sm text-zinc-200 shadow-xl">
          {toast}
        </div>
      ) : null}

      {showBackToTop ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed right-4 bottom-4 z-30 rounded-full border border-zinc-800 bg-zinc-950/90 backdrop-blur px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900"
          aria-label="Back to top"
        >
          ↑ Top
        </button>
      ) : null}
    </div>
  );
}
