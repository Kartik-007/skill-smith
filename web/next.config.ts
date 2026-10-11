import path from "node:path";
import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

// The repo-root .env.local holds MONGODB_URI. web/.env.local is normally a symlink to it; if the symlink
// is missing (fresh clone or worktree), load the parent directory's env files directly.
if (!process.env.MONGODB_URI) {
  try {
    const quiet = { info: () => {}, error: () => {} };
    loadEnvConfig(path.resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", quiet);
  } catch {
    // no parent env; the page falls back to sample data
  }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false, // keep the projector screen clean during `npm run dev`
};

export default nextConfig;
