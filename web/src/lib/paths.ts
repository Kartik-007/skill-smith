import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

/** web/public on disk. `npm run dev|start` runs from web/; `next start web` from the repo root also works. */
export function publicDir(): string {
  const here = path.join(process.cwd(), "public");
  if (existsSync(here)) return here;
  const fromRoot = path.join(process.cwd(), "web", "public");
  return existsSync(fromRoot) ? fromRoot : here;
}
