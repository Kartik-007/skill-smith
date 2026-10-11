import { readFile } from "node:fs/promises";
import path from "node:path";
import { Studio } from "@/components/studio/Studio";
import { MOCK_STORY } from "@/lib/story/mock";
import type { Story } from "@/lib/story/types";

// The recorded run, exported from Atlas by `skillsmith export-story` into public/story_v1.json: every version's
// story-order run, retrieved memory, clips and gate numbers are real. The sample story is only a fallback if the
// file is missing (the screen then shows a "sample data" badge).
async function loadStory(): Promise<Story> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "public", "story_v1.json"), "utf8")) as Story;
  } catch {
    return MOCK_STORY;
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  return <Studio story={await loadStory()} autoplay={sp.autoplay === "1"} />;
}
