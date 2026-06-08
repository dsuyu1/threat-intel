import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  Book,
  Bot,
  Compass,
  Database,
  Earth,
  FileText,
  GitBranch,
  GraduationCap,
  KeyRound,
  LandPlot,
  LayoutDashboard,
  LocateFixed,
  Map,
  Network,
  Radar,
  Radiation,
  Rss,
  Search,
  ShelvingUnit,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Users,
  UsersRound,
  Webhook,
} from "lucide-react";

export type PlatformNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type PlatformNavSection = {
  label: string;
  items: PlatformNavItem[];
};

export const PLATFORM_NAV_SECTIONS: PlatformNavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Global view", href: "/global", icon: Earth },
      { label: "Learn", href: "/learn", icon: GraduationCap },
      { label: "MITRE matrix map", href: "/defend", icon: Map },
    ],
  },
  {
    label: "Intel",
    items: [
      { label: "Findings", href: "/findings", icon: Radar },
      { label: "Threat actor library", href: "/actors", icon: UsersRound },
      { label: "Navigator", href: "/navigator", icon: Compass },
      { label: "IOCs", href: "/iocs", icon: LocateFixed },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Risk register", href: "/risk", icon: ShieldAlert },
      { label: "Watchlist", href: "/watchlist", icon: Bookmark },
      { label: "Compliance", href: "/compliance", icon: ShieldCheck },
      { label: "Tabletop exercises", href: "/tabletop", icon: LandPlot },
      { label: "Playbooks", href: "/playbooks", icon: Book },
      { label: "SBOM", href: "/sbom", icon: ShelvingUnit },
      { label: "API keys", href: "/api-keys", icon: KeyRound },
      { label: "Agents", href: "/agents", icon: Bot },
      { label: "Connections", href: "/connections", icon: Webhook },
    ],
  },
  {
    label: "Data",
    items: [
      { label: "Data explorer", href: "/data", icon: Database },
      { label: "Query (KQL)", href: "/data/query", icon: Terminal },
      { label: "Findings", href: "/data/findings", icon: Search },
      { label: "Sources", href: "/data/sources", icon: Rss },
      { label: "Documents", href: "/data/documents", icon: FileText },
      { label: "KG entities", href: "/data/kg-entities", icon: Network },
      { label: "KG relations", href: "/data/kg-relations", icon: GitBranch },
    ],
  },
];

export const PLATFORM_NAV_ITEMS: PlatformNavItem[] = PLATFORM_NAV_SECTIONS.flatMap((s) => s.items);
