import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for Cloudflare Pages deployment
  // See: https://developers.cloudflare.com/pages/framework-guides/nextjs/
  experimental: {
    // Enable when deploying to Cloudflare Pages edge runtime
    // runtime: 'edge',
  },
};

export default nextConfig;
