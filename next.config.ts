import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Set while building the Docker image.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  /* config options here */
  // The badge covers the bottom-left corner of the page, where the image button is.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
