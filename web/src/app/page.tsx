import { readFile } from "node:fs/promises";
import path from "node:path";
import { Stage } from "@/components/Stage";
import { loadState } from "@/lib/state";
import type { AppState } from "@/lib/types";
import type { Mode } from "@/lib/useAppState";

export const dynamic = "force-dynamic";

async function firstReplayFrame(): Promise<AppState | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "replay.json"), "utf8");
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
  return <Stage mode={mode} initial={initial} />;
}
