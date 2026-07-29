import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone: self-contained server bundle for the Docker image (ADR-0007)
  output: "standalone",
};

export default nextConfig;
