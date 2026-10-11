"use client";
import { ago, shortName } from "@/lib/derive";
import type { QueueOrder, QueueSnapshot, QueueStep, Recovery } from "@/lib/types";
import { Icon } from "./Icons";
import { Panel, PanelHead, useSize } from "./ui";

const ROW_H = 31;

function Square({ s }: { s: QueueStep }) {
  const glyph = s.kind === "plan" ? "P" : s.kind === "verify" ? "V" : String(s.step_idx);
  const base = "relative flex h-[24px] w-[24px] items-center justify-center rounded-[6px] font-mono text-[0.7rem] font-bold";
  const cls =
    s.status === "done"
      ? "bg-leaf/85 text-ink"
      : s.status === "leased"
        ? "animate-lease border-2 border-leaf bg-leaf/20 text-leaf"
        : s.status === "failed"
          ? "bg-crush text-ink"
          : "border border-line-2 text-faint";
  return (
    <span
      className={`${base} ${cls}`}
      title={`${s.kind}${s.label ? ` ${s.label}` : ""} · ${s.status}${s.attempts > 1 ? ` · attempt ${s.attempts}` : ""}`}
    >
      {glyph}
      {s.attempts > 1 ? (
        <span className="absolute -right-1.5 -top-1.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-tip px-0.5 text-[0.6rem] font-bold leading-none text-ink">
          ↻
        </span>
      ) : null}
    </span>
  );
}

function rowStatus(o: QueueOrder): { text: string; tone: string } {
  const leased = o.steps.find((s) => s.status === "leased");
  if (leased) {
    const what =
      leased.kind === "plan"
        ? "coder planning"
        : leased.kind === "verify"
          ? "referee checking"
          : `placing ${shortName(leased.label, leased.label)}`;
    const left = leased.lease_remaining_s;
    if (left != null && left <= 0) return { text: `${what} · lease expired, waiting for a worker`, tone: "text-tip" };
    const attempt = leased.attempts > 1 ? ` · attempt ${leased.attempts}` : "";
    return { text: `${what} · lease ${left ?? "?"}s${attempt}`, tone: "text-text" };
  }
  const failed = o.steps.find((s) => s.status === "failed");
  if (failed) return { text: `failed at step ${failed.step_idx}`, tone: "text-crush" };
  if (o.steps.length && o.steps.every((s) => s.status === "done")) return { text: "done", tone: "text-leaf/80" };
  if (o.steps.some((s) => s.status === "done")) return { text: "waiting for a worker", tone: "text-mute" };
  return { text: "queued", tone: "text-faint" };
}

function QueueRows({ queue }: { queue: QueueSnapshot }) {
  const [ref, { h }] = useSize<HTMLDivElement>();
  const maxRows = Math.max(1, Math.floor(h / ROW_H));
  const orders = queue.orders;
  // stable order; scroll the window to keep the active orders in view
  const firstOpen = orders.findIndex((o) => o.steps.some((s) => s.status !== "done"));
  const start = Math.max(0, Math.min(firstOpen < 0 ? orders.length - maxRows : firstOpen - 1, orders.length - maxRows));
  const shown = orders.slice(start, start + maxRows);
  const hiddenBefore = start;
  const hiddenAfter = Math.max(0, orders.length - start - shown.length);

  return (
    <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden">
      {orders.length === 0 ? <div className="pt-2 text-mute">batch created, no steps yet</div> : null}
      {shown.map((o) => {
        const st = rowStatus(o);
        return (
          <div key={o.order_run_id} className="flex items-center gap-3" style={{ height: ROW_H }}>
            <span className="w-[4.6rem] shrink-0 font-mono text-[0.95rem] font-semibold text-text">
              {o.order_id}
              {o.repeat != null ? <span className="ml-1 text-[0.75rem] font-normal text-faint">r{o.repeat}</span> : null}
            </span>
            <span className="flex shrink-0 gap-1.5">
              {o.steps.map((s) => (
                <Square key={s.id} s={s} />
              ))}
            </span>
            <span className={`truncate text-[0.9rem] ${st.tone}`}>{st.text}</span>
          </div>
        );
      })}
      {hiddenBefore + hiddenAfter > 0 ? (
        <div className="absolute bottom-0 right-0 rounded bg-panel/90 px-1.5 text-[0.75rem] text-faint">
          {hiddenBefore ? `${hiddenBefore} done above` : ""}
          {hiddenBefore && hiddenAfter ? " · " : ""}
          {hiddenAfter ? `${hiddenAfter} more queued` : ""}
        </div>
      ) : null}
    </div>
  );
}

function RecoveryCard({ r, nowIso }: { r: Recovery | null; nowIso: string }) {
  if (!r) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-line-2 text-center text-[0.9rem] text-mute">
        Kill a worker mid-order.
        <br />
        It resumes from the exact physics state.
      </div>
    );
  }
  const fresh = Date.parse(nowIso) - Date.parse(r.ts) < 30_000;
  const exact = r.pixel_diff === 0;
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border p-2.5 transition-[border-color,box-shadow] duration-700 ${
        fresh ? "animate-glow border-leaf" : "border-line/80 bg-ink-2/40"
      }`}
    >
      <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[0.95rem] font-semibold text-text">
          <Icon name="recovery" size={15} className="shrink-0 text-leaf" />
          Recovered
          {r.order_run_id ? <span className="font-mono text-mute">{r.order_run_id.split(":").slice(-2).join(" r")}</span> : null}
          {r.step_idx != null ? <span>step {r.step_idx}</span> : null}
          {r.attempt != null ? <span className="text-tip">attempt {r.attempt}</span> : null}
        </span>
        <span className="shrink-0 font-mono text-[0.8rem] text-faint">{ago(r.ts, nowIso)}</span>
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        {(
          [
            ["before kill", r.before_frame],
            ["after restore", r.after_frame],
          ] as const
        ).map(([label, src]) => (
          <figure key={label} className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg bg-black ring-1 ring-line">
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={label} className="absolute inset-0 h-full w-full object-cover" />
            ) : null}
            <figcaption className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-text/90">
              {label}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-2 flex shrink-0 items-center gap-2 text-[0.85rem]">
        <span
          className={`shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 font-mono font-bold ${exact ? "bg-leaf text-ink" : "bg-tip/20 text-tip"}`}
        >
          pixel diff {r.pixel_diff ?? "?"}
        </span>
        <span className="truncate text-mute">{exact ? "same physics state, restored from Atlas" : "restored from Atlas checkpoint"}</span>
      </div>
    </div>
  );
}

export function NightShift({
  queue,
  recovery,
  nowIso,
  sampleQueue,
  sampleRecovery,
  children,
}: {
  queue: QueueSnapshot | null;
  recovery: Recovery | null;
  nowIso: string;
  sampleQueue: boolean;
  sampleRecovery: boolean;
  children?: React.ReactNode;
}) {
  const pctDone = queue && queue.n_steps ? Math.round((queue.n_done / queue.n_steps) * 100) : 0;
  const fresh = recovery ? Date.parse(nowIso) - Date.parse(recovery.ts) < 30_000 : false;
  return (
    <Panel glow={fresh}>
      <PanelHead
        title="Night shift"
        sub="durable queue on Atlas · checkpoints every step"
        sample={sampleQueue || sampleRecovery}
        right={
          queue ? (
            <span className="font-mono tabular">
              {queue.kind} v{queue.version ?? "?"} · {queue.n_done}/{queue.n_steps} steps
              {queue.workers.length ? ` · ${queue.workers.length} worker${queue.workers.length > 1 ? "s" : ""}` : ""}
              {queue.status !== "running" ? ` · ${queue.status}` : ""}
            </span>
          ) : null
        }
      />
      {queue ? (
        <div className="-mt-1 mb-2 h-1 shrink-0 overflow-hidden rounded-full bg-line/60">
          <div className="h-full rounded-full bg-leaf transition-[width] duration-700" style={{ width: `${pctDone}%` }} />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-h-0 min-w-0 flex-[1.15] flex-col">
          {queue ? <QueueRows queue={queue} /> : <div className="text-mute">no batch yet</div>}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <RecoveryCard r={recovery} nowIso={nowIso} />
        </div>
      </div>
      {children}
    </Panel>
  );
}
