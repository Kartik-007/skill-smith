import { cx } from "@/components/studio/format";
import { Icon, type IconName } from "@/components/studio/icons";

// Durable execution in one picture, from the recorded kill -9 demo (v2 harness, story order):
// every queue step commits its result and an exact physics checkpoint to Atlas in one transaction; a killed
// worker's lease expires, a new worker claims the step and restores the last checkpoint. Frames are the real
// renders: the last committed checkpoint and the scene right after restoring it (pixel diff 0).

// copies of /frames/demo-STORY-v2-1791748627_STORY_v2_r0_1_ckpt.png and ..._1_restored_a2.png, kept in git
const BEFORE = "/durable/checkpoint_before.png";
const AFTER = "/durable/restored_after.png";

type Step = { label: string; sub: string; state: "done" | "killed" | "resumed" | "pending" };
const STEPS: Step[] = [
  { label: "Plan", sub: "coder writes pack()", state: "done" },
  { label: "Place 1", sub: "cupcakes", state: "done" },
  { label: "Place 2", sub: "cereal", state: "killed" },
  { label: "Place 3", sub: "Nesquik", state: "pending" },
  { label: "Verify", sub: "referee totals", state: "pending" },
];

const delay = (k: number) => ({ animationDelay: `${300 + k * 450}ms` });

export function DurableDiagram() {
  return (
    <div className="flex h-full flex-col gap-5">
      {/* the queue */}
      <div className="flex items-stretch gap-2">
        {STEPS.map((s, k) => (
          <div key={s.label} className="flex flex-1 items-center gap-2">
            <div
              style={delay(k)}
              className={cx(
                "animate-enter flex-1 rounded-xl border bg-surface px-4 py-3",
                s.state === "killed" ? "border-bad ring-4 ring-bad-soft" : "border-line",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-[1.05rem] font-semibold">{s.label}</span>
                {s.state === "done" && <Icon name="check" size={15} className="text-ok" />}
                {s.state === "killed" && (
                  <span className="rounded bg-bad px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-white">
                    kill -9
                  </span>
                )}
              </div>
              <div className="text-[0.85rem] text-mute">{s.sub}</div>
            </div>
            {k < STEPS.length - 1 && <Icon name="arrowRight" size={16} className="shrink-0 text-faint" />}
          </div>
        ))}
      </div>

      {/* what is in Atlas after each committed step */}
      <div style={delay(5)} className="animate-enter flex items-center gap-3 rounded-xl bg-accent-soft px-5 py-3">
        <Icon name="db" size={20} className="shrink-0 text-accent" />
        <p className="text-[1.05rem] leading-snug text-ink-2">
          <span className="font-semibold text-ink">Every step commits to Atlas in one transaction:</span> its result,
          an exact physics checkpoint (<span className="font-mono text-[0.95rem]">mj_getState</span>) and
          &ldquo;step done&rdquo;. It only commits if the worker still holds the step&apos;s lease.
        </p>
      </div>

      {/* recovery */}
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-3">
        <Phase k={6} icon="x" tone="bad" title="Worker killed mid-item" body="Place 2 stops halfway. Nothing it did is committed." />
        <Icon name="arrowRight" size={18} className="self-center text-faint" />
        <Phase
          k={7}
          icon="lock"
          tone="mute"
          title="Lease expires (8 s)"
          body="No heartbeat, so a new worker claims Place 2 as attempt 2."
        />
        <Icon name="arrowRight" size={18} className="self-center text-faint" />
        <Phase
          k={8}
          icon="db"
          tone="ok"
          title="Restore checkpoint 1"
          body="Physics state at t = 6.28 s loaded from Atlas. The order finishes 3/3."
        />
      </div>

      <div style={delay(9)} className="animate-enter grid min-h-0 flex-1 grid-cols-2 gap-4">
        <Frame src={BEFORE} caption="Last committed checkpoint (before the kill)" />
        <Frame src={AFTER} caption="New worker, right after restoring it" badge="pixel diff 0" />
      </div>
    </div>
  );
}

function Phase({
  k,
  icon,
  tone,
  title,
  body,
}: {
  k: number;
  icon: IconName;
  tone: "bad" | "mute" | "ok";
  title: string;
  body: string;
}) {
  return (
    <div style={delay(k)} className="animate-enter flex flex-col rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center gap-2">
        <span
          className={cx(
            "grid h-7 w-7 place-items-center rounded-lg",
            tone === "bad" ? "bg-bad-soft text-bad" : tone === "ok" ? "bg-ok-soft text-ok" : "bg-sunk text-mute",
          )}
        >
          <Icon name={icon} size={15} />
        </span>
        <span className="text-[1.05rem] font-semibold">{title}</span>
      </div>
      <p className="mt-1.5 text-[0.95rem] leading-snug text-ink-2">{body}</p>
    </div>
  );
}

function Frame({ src, caption, badge }: { src: string; caption: string; badge?: string }) {
  return (
    <figure className="flex min-h-0 min-w-0 flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-[#0f1c27]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={caption} className="h-full w-full object-cover" />
        {badge && (
          <span className="absolute right-3 bottom-3 rounded-lg bg-ok px-3 py-1 font-mono text-[0.95rem] font-semibold text-white shadow">
            {badge}
          </span>
        )}
      </div>
      <figcaption className="mt-1.5 text-[0.9rem] text-mute">{caption}</figcaption>
    </figure>
  );
}
