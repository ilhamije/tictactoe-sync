import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
});

// Detect if we are explicitly forcing Turbo mode
const isTurbo = process.env.TURBOPACK === "1";

const nextConfig: NextConfig = {
  // In Next.js 16, turbopack is a top-level property
  // We leave it empty to satisfy the build error while using Webpack plugins
  turbopack: {},

  // In Next.js 16, this is now a top-level property
  allowedDevOrigins: [
    "192.168.0.122",
    "192.168.0.122:3000",
    "localhost:3000"
  ],

  // Keep webpack as a function to ensure the PWA plugin can hook into it
  webpack: (config) => {
    return config;
  },
};

// If Turbo is enabled, we MUST skip the PWA wrapper because it's Webpack-only
export default isTurbo ? nextConfig : withPWA(nextConfig);