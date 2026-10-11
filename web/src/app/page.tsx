import { readFile } from "node:fs/promises";
import path from "node:path";
import { Stage } from "@/components/Stage";
import { THEATER_VIEWS } from "@/lib/derive";
import { publicDir } from "@/lib/paths";
import { loadState } from "@/lib/state";
import type { AppState } from "@/lib/types";
import type { Mode } from "@/lib/useAppState";

export const dynamic = "force-dynamic";

async function firstReplayFrame(): Promise<AppState | null> {
  try {
    const raw = await readFile(path.join(publicDir(), "replay.json"), "utf8");
    const data = JSON.parse(raw) as AppState | AppState[];
    const first = Array.isArray(data) ? data[0] : data;
    return first ? { ...first, source: "replay" } : null;
  } catch {
    return null;
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const mode: Mode = sp.replay === "1" ? "replay" : sp.mock === "1" ? "mock" : "live";
  const initial = mode === "replay" ? await firstReplayFrame() : await loadState({ forceMock: mode === "mock" });
  // ?view=v0|best|live opens the theater on one screen (keys 1-4 switch at runtime)
  const view = THEATER_VIEWS.find((v) => v === sp.view);
  return <Stage mode={mode} initial={initial} view={view} />;
}
