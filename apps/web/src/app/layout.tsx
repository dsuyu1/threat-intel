export const runtime = "edge";

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Threat Intel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.className} h-full dark`} suppressHydrationWarning>
      <body
        className="h-full flex flex-col overflow-hidden bg-white text-zinc-900 dark:bg-[#141414] dark:text-zinc-200 antialiased tracking-tight"
      >
        <ClerkProvider>
          <Script id="theme-init" strategy="beforeInteractive">{`
          (() => {
            try {
              const key = "theme";
              const stored = localStorage.getItem(key);
              const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
              const theme = stored === "light" || stored === "dark" ? stored : (systemDark ? "dark" : "light");
              document.documentElement.classList.toggle("dark", theme === "dark");
              document.documentElement.style.colorScheme = theme;
            } catch {}
          })();
        `}</Script>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
