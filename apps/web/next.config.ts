import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ti/db"],
  experimental: {
    // This is a monorepo (apps/* + packages/*). Allow Next to reference files outside `apps/web`,
    // which also helps when pnpm resolves dependencies via the root `.pnpm` virtual store.
    externalDir: true,
    // Work around occasional RSC/manifest inconsistencies in dev (especially on Windows + pnpm).
    serverComponentsHmrCache: false,
    // The DevTools segment explorer currently breaks Edge-runtime RSC manifests in Webpack dev.
    devtoolSegmentExplorer: false,
  },
  env: {
    // Clerk's "keyless env drift detection" relies on Node fs, which is not available in Edge runtime.
    // Default to disabled so local dev + Pages builds don't spam errors, but allow override if needed.
    NEXT_PUBLIC_CLERK_KEYLESS_DISABLED: process.env.NEXT_PUBLIC_CLERK_KEYLESS_DISABLED ?? "1",
  },
  webpack(config, { dev }: { dev: boolean }) {
    // In production: disable webpack cache so build output stays
    // under Cloudflare Pages' 25 MiB per-file limit.
    //
    // In dev on Windows: prefer in-memory cache to avoid occasional filesystem
    // cache/manifest inconsistencies (pnpm + long paths + AV can be flaky).
    config.cache = dev ? { type: "memory" } : false;

    // Avoid resolving workspace/virtual-store links to real paths. This helps keep module ids stable
    // across compilers, which is critical for RSC consumer manifests in dev.
    config.resolve = config.resolve ?? {};
    config.resolve.symlinks = false;

    return config;
  },
};

export default nextConfig;
