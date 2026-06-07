import type { LucideIcon } from "lucide-react";
import { Book, Bot, Compass, Database, Globe, LayoutDashboard, Radar, ShieldAlert, ShieldCheck, Users, Webhook } from "lucide-react";

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
      { label: "Global view", href: "/global", icon: Globe },
    ],
  },
  {
    label: "Intel",
    items: [
      { label: "Findings", href: "/findings", icon: Radar },
      { label: "Threat actor library", href: "/actors", icon: Users },
      { label: "Navigator", href: "/navigator", icon: Compass },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Risk register", href: "/risk", icon: ShieldAlert },
      { label: "Compliance", href: "/risk/compliance", icon: ShieldCheck },
      { label: "Playbooks", href: "/playbooks", icon: Book },
      { label: "Agents", href: "/agents", icon: Bot },
      { label: "Connections", href: "/connections", icon: Webhook },
    ],
  },
  {
    label: "Data",
    items: [{ label: "Data explorer", href: "/data", icon: Database }],
  },
];

export const PLATFORM_NAV_ITEMS: PlatformNavItem[] = PLATFORM_NAV_SECTIONS.flatMap((s) => s.items);
