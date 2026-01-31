import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Skip type checking and linting during builds for speed
  // (Still runs in IDE and can be run separately with `tsc` and `eslint`)
  typescript: {
    ignoreBuildErrors: true,
  },
  // Skip static generation for error pages which have issues with client components
  experimental: {
    // Allow larger file uploads in middleware/routes (default is 10MB)
    middlewareClientMaxBodySize: "50mb",
    // Allow larger file uploads for server actions
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
