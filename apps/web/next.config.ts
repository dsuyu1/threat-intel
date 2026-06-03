import type { NextConfig } from "next";
import type { Configuration } from "webpack";

const nextConfig: NextConfig = {
  webpack(config: Configuration, { dev }: { dev: boolean }) {
    // Disable webpack cache in production so build output stays
    // under Cloudflare Pages' 25 MiB per-file limit
    if (!dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
