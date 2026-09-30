import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // standalone: self-contained server bundle for the Docker image (ADR-0007)
  output: "standalone",
  // Pinned, never inferred: a stray lockfile above the repo makes Next nest
  // the standalone server one directory deeper than the Dockerfile copies it
  // from, so a local build stops matching the image (ADR-0007).
  outputFileTracingRoot: __dirname,
  // Emitted for the source-map upload and deleted before the image is
  // assembled — never served (ADR-0010 as amended 2026-09-30).
  productionBrowserSourceMaps: true,
};

export default withSentryConfig(nextConfig, {
  // Never report build usage to sentry.io: nothing we run is theirs to count.
  telemetry: false,
  silent: true,
  // The build never talks to the error service: debug IDs are stamped offline
  // by `scripts/sourcemaps.sh inject`, and CI's `sourcemaps` job uploads them, so a
  // slow or absent vendor can never fail or stall an image build (ADR-0010 as
  // amended 2026-09-30).
  sourcemaps: { disable: true },
  release: { create: false, finalize: false, setCommits: false },
});
