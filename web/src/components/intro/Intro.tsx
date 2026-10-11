"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cx } from "@/components/studio/format";
import { Icon } from "@/components/studio/icons";
import { DurableDiagram, type DurableBuild } from "./DurableDiagram";
import { LoopDiagram, type Build } from "./LoopDiagram";

// A 20-30 second keynote intro: problem, idea, how it works. Arrow keys / space / click advance;
// the play button (or ?auto=1) runs it on a timer.

type Beat =
  | { kind: "problem" }
  | { kind: "idea" }
  | { kind: "how"; build: Build; caption: string }
  | { kind: "durable"; build: DurableBuild; caption: string };

const BEATS: { beat: Beat; secs: number }[] = [
  { beat: { kind: "problem" }, secs: 6 },
  { beat: { kind: "idea" }, secs: 6 },
  {
    beat: {
      kind: "how",
      build: "loop",
      caption:
        "The coder writes a program, the robot runs it, and a referee grades it on hidden physics. What worked and what failed goes into Atlas memory, and between versions a meta-agent proposes one change that the gate keeps only if scores go up.",
    },
    secs: 9,
  },
  {
    beat: {
      kind: "durable",
      build: "resume",
      caption:
        "Every step of an order is a leased job in an Atlas queue, and its result and exact physics state commit together. Kill the worker mid-step and a new one resumes from the checkpoint: pixel diff 0, order still 3/3.",
    },
    secs: 8,
  },
];

const DEEP_DIVE_HANDOFF = "/?at=v2";

export function Intro({ auto }: { auto?: boolean }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(!!auto);
  const [elapsed, setElapsed] = useState(0);
  const n = BEATS.length;

  const go = useCallback(
    (to: number) => {
      setI(Math.max(0, Math.min(n - 1, to)));
      setElapsed(0);
    },
    [n],
  );

  // stepping past the last slide hands over to the deep dive, paused right before v2's run
  const router = useRouter();
  const next = useCallback(() => {
    if (i === n - 1) router.push(DEEP_DIVE_HANDOFF);
    else go(i + 1);
  }, [i, n, go, router]);

  // timer for autoplay
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setElapsed((e) => e + (now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    if (!playing || elapsed < BEATS[i].secs) return;
    if (i === n - 1) setPlaying(false);
    else go(i + 1);
  }, [elapsed, playing, i, n, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") go(i - 1);
      else if (e.key === "p") setPlaying((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go, next]);

  // the harness version ticks v0 → v1 → v2 in time with the pulse on the loop diagram
  const beat = BEATS[i].beat;
  const [version, setVersion] = useState(0);
  const looping = beat.kind === "how" && beat.build === "loop";
  useEffect(() => {
    if (!looping) {
      setVersion(0);
      return;
    }
    const id = setInterval(() => setVersion((v) => Math.min(2, v + 1)), 3200);
    return () => clearInterval(id);
  }, [looping]);

  const section = beat.kind === "problem" ? 0 : beat.kind === "idea" ? 1 : beat.kind === "how" ? 2 : 3;

  return (
    <main
      className="relative flex h-screen flex-col overflow-hidden px-[5vw] pt-8 pb-6"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgb(23 23 26 / 0.08) 1px, transparent 1px)",
        backgroundSize: "26px 26px",
      }}
    >
      <header className="flex items-center gap-3">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
        <span className="font-mono text-[0.85rem] tracking-[0.18em] text-ink-2 uppercase">
          Skill Smith
        </span>
        <nav className="ml-8 flex gap-6 font-mono text-[0.75rem] tracking-[0.14em] uppercase">
          {["The problem", "Our solution", "How it works", "Never loses its place"].map((label, k) => (
            <button
              key={label}
              type="button"
              onClick={() => go(k)}
              className={cx(
                "transition-colors",
                k === section ? "text-accent" : "text-faint hover:text-mute",
              )}
            >
              {String(k + 1).padStart(2, "0")} {label}
            </button>
          ))}
        </nav>
        <Link
          href="/"
          className="ml-auto flex items-center gap-2 rounded-full border border-line-2 bg-surface px-4 py-2 text-[0.85rem] text-ink-2 transition-colors hover:border-ink hover:text-ink"
        >
          Deep dive <Icon name="arrowRight" size={15} />
        </Link>
      </header>

      <div className="relative min-h-0 flex-1" onClick={next}>
        {beat.kind === "problem" && <Problem key="p" />}
        {beat.kind === "idea" && <Idea key="i" />}
        {beat.kind === "how" && (
          <How
            key="h"
            build={beat.build}
            caption={beat.caption}
            version={version}
          />
        )}
        {beat.kind === "durable" && <Durable key="d" build={beat.build} caption={beat.caption} />}
      </div>

      <footer className="flex items-center gap-4">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            if (!playing && i === n - 1 && elapsed >= BEATS[i].secs) go(0);
            setPlaying((p) => !p);
          }}
          className="grid h-9 w-9 place-items-center rounded-full bg-ink text-white"
        >
          <Icon name={playing ? "pause" : "play"} size={15} />
        </button>
        <div className="flex flex-1 gap-1.5">
          {BEATS.map((b, k) => (
            <button
              key={k}
              type="button"
              aria-label={`Beat ${k + 1}`}
              onClick={() => go(k)}
              style={{ flexGrow: b.secs }}
              className="h-1.5 basis-0 overflow-hidden rounded-full bg-line"
            >
              <span
                className="block h-full bg-accent"
                style={{
                  width:
                    k < i
                      ? "100%"
                      : k > i
                        ? "0%"
                        : `${Math.min(100, (elapsed / b.secs) * 100)}%`,
                }}
              />
            </button>
          ))}
        </div>
        <span className="font-mono text-[0.75rem] text-faint">← → to step</span>
      </footer>
    </main>
  );
}

function Eyebrow({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="font-mono text-[0.85rem] tracking-[0.18em] text-accent uppercase">
      {n} · {children}
    </div>
  );
}

function Problem() {
  return (
    <section className="animate-enter grid h-full grid-cols-[1fr_1.15fr] items-center gap-[4vw]">
      <div>
        <Eyebrow n="01">The problem</Eyebrow>
        <h1 className="mt-5 text-[3.6rem] leading-[1.05] font-semibold tracking-tight">
          Robots struggle with objects they were never trained on.
        </h1>
        <p className="mt-6 max-w-[34rem] text-[1.3rem] leading-relaxed text-mute">
          A new box, a dented carton, a damp can. Retraining for every new item
          is slow and expensive.
        </p>
      </div>
      <figure>
        <div className="relative overflow-hidden rounded-2xl border border-line bg-[#0f1c27] shadow-xl">
          <video
            src="/videos/show-STORY-v0-1791748521_STORY_v0_r0.mp4"
            autoPlay
            muted
            loop
            playsInline
            className="aspect-video w-full object-cover"
          />
          <div className="absolute right-4 bottom-4 left-4 flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-surface px-3 py-1.5 text-[1rem] font-semibold text-bad shadow">
              0 / 3 packed
            </span>
            {["Crushed", "Collision", "Slipped"].map((s, k) => (
              <span
                key={s}
                style={{ animationDelay: `${600 + k * 250}ms` }}
                className="animate-enter rounded-lg bg-bad-soft px-3 py-1.5 text-[0.9rem] text-bad shadow"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
        <figcaption className="mt-4 text-[1.05rem] text-mute">
          Fig. 1. Our robot packing lunch for Dev Ittycheria, CEO of MongoDB.
          Attempt one.
        </figcaption>
      </figure>
    </section>
  );
}

const STAIRS = [
  { v: "v0", score: 29, note: "day one" },
  { v: "v1", score: 77, note: "remembers what worked" },
  { v: "v2", score: 96, note: "remembers what failed" },
];

function Idea() {
  return (
    <section className="animate-enter grid h-full grid-cols-[1fr_1fr] items-center gap-[4vw]">
      <div>
        <Eyebrow n="02">Our solution</Eyebrow>
        <h1 className="mt-5 text-[3.6rem] leading-[1.05] font-semibold tracking-tight">
          An AI coach that rewrites the robot&apos;s playbook.
          <br />
          <span className="text-accent">No retraining.</span>
        </h1>
        <p className="mt-6 max-w-[34rem] text-[1.3rem] leading-relaxed text-mute">
          After each round, the coach reads what broke and changes one thing in
          the playbook: what to remember, which rules, which tools. It keeps the
          change only if the robot scores higher on a test.
        </p>
      </div>
      <div className="flex flex-col">
        <div className="flex h-[22rem] items-end gap-6 border-b border-line-2 px-4">
          {STAIRS.map((s, k) => (
            <div
              key={s.v}
              className="flex flex-1 flex-col items-center justify-end"
            >
              <span className="mb-2 font-mono text-[1.6rem] font-semibold tabular">
                {s.score}%
              </span>
              <div
                className={cx(
                  "w-full rounded-t-lg",
                  k === STAIRS.length - 1 ? "bg-accent" : "bg-line-2",
                )}
                style={{
                  height: `${s.score * 2.6}px`,
                  animation: `enter 600ms ${200 + k * 250}ms both`,
                  transformOrigin: "bottom",
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-6 px-4">
          {STAIRS.map((s) => (
            <div key={s.v} className="flex-1 text-center">
              <div className="font-mono text-[1rem] font-semibold">{s.v}</div>
              <div className="text-[0.85rem] text-mute">{s.note}</div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-3 text-[0.9rem]">
          <span className="rounded-full bg-surface px-4 py-1.5 text-ink-2 shadow-sm ring-1 ring-line">
            Same AI model, never retrained:{" "}
            <span className="font-medium">Haiku 5.5</span>
          </span>
          <span className="rounded-full bg-surface px-4 py-1.5 text-ink-2 shadow-sm ring-1 ring-line">
            Never-seen snacks: <span className="font-medium">78% → 100%</span>
          </span>
        </div>
        <div className="mt-2 text-center font-mono text-[0.7rem] tracking-[0.12em] text-faint uppercase">
          Damage-free items, training orders
        </div>
      </div>
    </section>
  );
}

function How({
  build,
  caption,
  version,
}: {
  build: Build;
  caption: string;
  version: number;
}) {
  return (
    <section className="animate-enter flex h-full flex-col pt-6">
      <div className="flex items-baseline gap-6">
        <Eyebrow n="03">How it works</Eyebrow>
        <h2 className="text-[1.9rem] font-semibold tracking-tight">
          Run, grade, remember, rewrite, repeat.
        </h2>
      </div>
      <div className="card mt-5 flex min-h-0 flex-1 flex-col overflow-hidden px-8 pt-4 pb-5">
        <div className="min-h-0 flex-1">
          <LoopDiagram build={build} version={version} />
        </div>
        <p
          key={caption}
          className="animate-enter mt-2 max-w-[70rem] text-[1.2rem] leading-snug text-ink-2"
        >
          {caption}
        </p>
      </div>
    </section>
  );
}

function Durable({ build, caption }: { build: DurableBuild; caption: string }) {
  return (
    <section className="animate-enter flex h-full flex-col pt-6">
      <div className="flex items-baseline gap-6">
        <Eyebrow n="04">Never loses its place</Eyebrow>
        <h2 className="text-[1.9rem] font-semibold tracking-tight">
          Kill it mid-move. It picks up exactly where it stopped.
        </h2>
      </div>
      <div className="card mt-5 flex min-h-0 flex-1 flex-col overflow-hidden px-8 pt-4 pb-5">
        <div className="min-h-0 flex-1">
          <DurableDiagram build={build} />
        </div>
        <p key={caption} className="animate-enter mt-2 max-w-[70rem] text-[1.2rem] leading-snug text-ink-2">
          {caption}
        </p>
      </div>
    </section>
  );
}
