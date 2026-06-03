import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { DotCursor } from "../components/DotCursor";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Security | Damian Villarreal",
  description:
    "Daily AI-powered threat intelligence: CVEs, cyberattacks, TTPs, exploit drops, and malware — curated by autonomous agents.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${inter.className} h-full`}>
        <body className="h-full flex flex-col bg-[#09090b] text-zinc-200 antialiased tracking-tight" style={{ cursor: "none" }}>
          <nav className="shrink-0 z-10 bg-zinc-950/80 backdrop-blur-sm border-b border-zinc-800">
            <div className="max-w-[90ch] mx-auto px-8 py-4">
              <Nav />
            </div>
          </nav>
          <main className="flex-1 min-h-0">
            {children}
          </main>
          <DotCursor />
        </body>
      </html>
    </ClerkProvider>
  );
}

function Nav() {
  return (
    <nav className="flex items-center gap-6">
      <a
        href="https://damianvillarreal.com"
        className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
      >
        blog
      </a>
      <a
        href="https://damianvillarreal.com/about"
        className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
      >
        about
      </a>
      <a
        href="/"
        className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
      >
        security
      </a>
    </nav>
  );
}
