import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip static generation for error pages which have issues with client components
  experimental: {
    // Use PPR (Partial Prerendering) which handles client components better
  },
};

export default nextConfig;
