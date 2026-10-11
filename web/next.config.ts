import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

// The repo-root .env.local holds MONGODB_URI. web/.env.local is normally a symlink to it; if the symlink
// is missing (fresh clone or worktree), load the repo root's env files directly.
if (!process.env.MONGODB_URI) {
  const cwd = process.cwd();
  const repoRoot = [path.resolve(cwd, ".."), cwd].find((d) => existsSync(path.join(d, ".env.local")));
  if (repoRoot) {
    try {
      const quiet = { info: () => {}, error: () => {} };
      loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production", quiet);
    } catch {
      // no usable env; the page falls back to sample data
    }
  }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // a second dev server in the same folder (another session) needs its own build dir
  distDir: process.env.NEXT_DIST_DIR || ".next",
  devIndicators: false, // keep the projector screen clean during `npm run dev`
  // Media the core writes after the server started is not in Next's static file list; fall back to a route
  // that reads it from disk. Files that were there at startup are still served statically.
  async rewrites() {
    return [
      { source: "/videos/:path*", destination: "/api/media/videos/:path*" },
      { source: "/frames/:path*", destination: "/api/media/frames/:path*" },
    ];
  },
};

export default nextConfig;
