"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { META, buildTimeline, harnessVersionIndex, locate } from "@/lib/story/timeline";
import type { Story } from "@/lib/story/types";
import { usePlayback } from "@/lib/story/usePlayback";
import { FlowStrip } from "./FlowStrip";
import { HarnessPanel, type Change } from "./HarnessPanel";
import { IterationsPanel } from "./IterationsPanel";
import { MetaStage } from "./MetaStage";
import { RunStage } from "./RunStage";
import { Timeline } from "./Timeline";

export function Studio({ story, autoplay }: { story: Story; autoplay?: boolean }) {
  const tl = useMemo(() => buildTimeline(story), [story]);
  const pb = usePlayback(tl.total, { autoplay });
  const cursor = locate(tl, pb.t);
  const hvi = harnessVersionIndex(cursor, story);
  const harness = story.versions[hvi];

  // the change the left panel highlights: proposed (meta, from the patch state on) or just applied (next run)
  let change: Change | null = null;
  if (cursor.kind === "meta" && cursor.state >= META.patch) {
    const tr = story.transitions[cursor.ti];
    change = { ...tr.patch, state: hvi > cursor.ti ? "applied" : "pending" };
  } else if (cursor.kind === "run" && cursor.vi > 0) {
    change = { ...story.transitions[cursor.vi - 1].patch, state: "applied" };
  }

  const { toggle, seek, setRate, t } = pb;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight") seek(t + 5);
      else if (e.key === "ArrowLeft") seek(t - 5);
      else if (e.key === "1" || e.key === "2") setRate(Number(e.key));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek, setRate, t]);

  const objective = story.objective;

  return (
    <main className="grid h-screen grid-cols-[19rem_minmax(0,1fr)_17rem] gap-4 p-4">
      <HarnessPanel version={harness.version} genome={harness.genome} change={change} />

      <section className="flex min-h-0 min-w-0 flex-col gap-3">
        <header className="card flex items-center gap-5 px-5 py-3">
          <div className="min-w-0">
            <div className="text-[0.68rem] font-medium tracking-wide text-mute uppercase">Objective</div>
            <div className="truncate text-[1.1rem] font-semibold">{objective.title}</div>
          </div>
          <div className="min-w-0 flex-1 truncate border-l border-line pl-5 text-[0.85rem] text-ink-2">
            {objective.goal}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[0.75rem]">
            <span className="rounded-md bg-sunk px-2 py-1 text-ink-2">
              Same model every version: <span className="font-medium">{story.versions[0].run.plan.model}</span>
            </span>
            {story.source === "mock" && (
              <span className="rounded-md border border-dashed border-line-2 px-2 py-1 text-mute">sample data</span>
            )}
            <Link href="/intro" className="rounded-md border border-line-2 px-2 py-1 text-ink-2 hover:border-ink hover:text-ink">
              Intro
            </Link>
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          {cursor.kind === "run" ? (
            <RunStage
              story={story}
              version={story.versions[cursor.vi]}
              phase={cursor.phase}
              local={cursor.local}
              p={cursor.p}
              playing={pb.playing}
              rate={pb.rate}
            />
          ) : (
            <MetaStage tr={story.transitions[cursor.ti]} state={cursor.state} p={cursor.p} />
          )}
        </div>

        {cursor.kind === "run" && (
          <FlowStrip story={story} version={story.versions[cursor.vi]} phase={cursor.phase} p={cursor.p} />
        )}

        <Timeline
          story={story}
          tl={tl}
          t={pb.t}
          playing={pb.playing}
          rate={pb.rate}
          onToggle={pb.toggle}
          onSeek={pb.seek}
          onRate={pb.setRate}
        />
      </section>

      <IterationsPanel story={story} tl={tl} cursor={cursor} t={pb.t} onSeek={pb.seek} />
    </main>
  );
}
