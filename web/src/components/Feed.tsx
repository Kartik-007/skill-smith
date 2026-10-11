"use client";
import { useEffect, useRef } from "react";
import { ago } from "@/lib/derive";
import type { FeedItem, FeedType } from "@/lib/types";
import { FEED_COLOR, Icon } from "./Icons";
import { Panel, PanelHead } from "./ui";

const ACTOR: Partial<Record<FeedType, string>> = {
  signal: "Raindrop",
  gap: "Coder asked",
  patch: "Meta-agent",
  verdict: "Gate",
  tripwire: "Atlas said no",
  recovery: "Night shift",
  lesson: "Lesson",
  skill: "Skill",
};

/** "Gate: KEPT v3" -> ["Gate", "KEPT v3"]; falls back to a per-type actor. */
function split(item: FeedItem): [string | null, string] {
  const m = item.text.match(/^([^:]{2,22}):\s*([\s\S]+)$/);
  if (m) return [m[1], m[2]];
  return [ACTOR[item.type] ?? null, item.text];
}

function verdictOf(item: FeedItem): "kept" | "bad" | null {
  const v = String(item.refs.verdict ?? "").toLowerCase();
  if (v === "kept") return "kept";
  if (v === "rejected" || v === "rolled_back") return "bad";
  if (/\bKEPT\b/.test(item.text)) return "kept";
  if (/\b(REJECTED|ROLLED[ _]BACK)\b/.test(item.text)) return "bad";
  return null;
}

function Body({ text }: { text: string }) {
  // emphasise gate verdict words
  const parts = text.split(/(\bKEPT\b|\bREJECTED\b|\bROLLED[ _]BACK\b)/);
  return (
    <>
      {parts.map((p, i) =>
        /^(KEPT|REJECTED|ROLLED[ _]BACK)$/.test(p) ? (
          <b key={i} className={p === "KEPT" ? "text-leaf" : "text-crush"}>
            {p.replace("_", " ")}
          </b>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function Feed({ feed, nowIso, sample }: { feed: FeedItem[]; nowIso: string; sample: boolean }) {
  const seen = useRef<Set<string> | null>(null);
  const isNew = (id: string) => seen.current !== null && !seen.current.has(id);
  useEffect(() => {
    seen.current = new Set(feed.map((f) => f.id));
  }, [feed]);

  return (
    <Panel>
      <PanelHead title="Evolution feed" sub="failures become lessons, wins become skills" sample={sample} />
      <ol className="fade-bottom min-h-0 flex-1 space-y-1 overflow-hidden">
        {feed.map((item) => {
          const [actor, body] = split(item);
          const trip = item.type === "tripwire";
          const verdict = item.type === "verdict" ? verdictOf(item) : null;
          const color = trip || verdict === "bad" ? "#FF5D5D" : FEED_COLOR[item.type] ?? "#8FA9B3";
          return (
            <li
              key={item.id}
              className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${isNew(item.id) ? "animate-enter" : ""} ${
                trip ? "bg-crush/12 ring-1 ring-crush/50" : ""
              }`}
            >
              <span
                className="mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{ background: `${color}22`, color }}
              >
                <Icon name={trip ? "tripwire" : item.type in FEED_COLOR ? item.type : "info"} size={14} />
              </span>
              <p className={`min-w-0 flex-1 text-[0.95rem] leading-snug ${trip ? "text-[#ffb3b3]" : "text-text/90"}`}>
                {actor ? (
                  <span className="mr-1.5 font-semibold" style={{ color: trip ? "#FF5D5D" : color }}>
                    {actor}:
                  </span>
                ) : null}
                <Body text={body} />
              </p>
              <span className="mt-[2px] shrink-0 font-mono text-[0.75rem] text-faint">{ago(item.ts, nowIso)}</span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
