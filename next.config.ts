import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone: self-contained server bundle for the Docker image (ADR-0007)
  output: "standalone",
  // Pinned, never inferred: a stray lockfile above the repo makes Next nest
  // the standalone server one directory deeper than the Dockerfile copies it
  // from, so a local build stops matching the image (ADR-0007).
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
