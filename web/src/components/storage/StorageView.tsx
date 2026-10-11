"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cx } from "@/components/studio/format";
import { Icon, type IconName } from "@/components/studio/icons";
import type { Row, Store, StoreGroup, StorageSnapshot } from "@/lib/storage/types";

const GROUPS: { id: StoreGroup; label: string; sub: string; dot: string }[] = [
  { id: "atlas", label: "MongoDB Atlas", sub: "memory, state and history", dot: "bg-ok" },
  { id: "raindrop", label: "Raindrop", sub: "what we send, rebuilt from Atlas", dot: "bg-[#6b3fd1]" },
  { id: "truth", label: "Walled off", sub: "only the referee reads this", dot: "bg-faint" },
];

const ICON: Record<string, IconName> = {
  lessons: "bulb",
  skills: "check",
  versions: "patch",
  runs: "box",
  checkpoints: "flag",
  queue: "arm",
  ledger: "brain",
  feed: "search",
  products: "cube",
  truth: "lock",
  "rd-events": "drop",
  "rd-signals": "drop",
  "rd-patches": "drop",
};

export function StorageView({ data, initial }: { data: StorageSnapshot; initial?: string }) {
  const [sel, setSel] = useState<string | null>(initial && data.stores.some((s) => s.id === initial) ? initial : null);
  const store = data.stores.find((s) => s.id === sel) ?? null;

  // keep the selection in the URL so a store can be opened directly (?store=lessons)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (sel) url.searchParams.set("store", sel);
    else url.searchParams.delete("store");
    window.history.replaceState(null, "", url);
  }, [sel]);

  return (
    <main className="grid h-screen grid-cols-[19rem_minmax(0,1fr)] gap-4 p-4">
      <aside className="card flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-line px-5 pt-4 pb-3">
          <div className="flex items-center gap-2 text-[0.7rem] font-medium tracking-wide text-mute uppercase">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            Skill Smith
          </div>
          <h2 className="mt-3 text-[1.05rem] font-semibold">Storage</h2>
          <p className="mt-1 text-[0.8rem] leading-snug text-mute">Everything the system remembers, and where.</p>
        </div>
        <nav className="no-scrollbar min-h-0 flex-1 overflow-y-auto py-2">
          <SideItem active={!sel} onClick={() => setSel(null)} icon="cube" label="Overview" />
          {GROUPS.map((g) => (
            <div key={g.id} className="mt-3">
              <div className="flex items-center gap-2 px-5 pb-1 text-[0.68rem] font-medium tracking-wide text-mute uppercase">
                <span className={cx("h-1.5 w-1.5 rounded-full", g.dot)} />
                {g.label}
              </div>
              {data.stores
                .filter((s) => s.group === g.id)
                .map((s) => (
                  <SideItem
                    key={s.id}
                    active={sel === s.id}
                    onClick={() => setSel(s.id)}
                    icon={ICON[s.id] ?? "db"}
                    label={s.label}
                    count={s.count}
                    locked={s.locked}
                  />
                ))}
            </div>
          ))}
        </nav>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col gap-3">
        <header className="card flex items-center gap-5 px-5 py-3">
          <div className="min-w-0">
            <div className="text-[0.68rem] font-medium tracking-wide text-mute uppercase">What we store</div>
            <div className="truncate text-[1.1rem] font-semibold">{store ? store.label : "Overview"}</div>
          </div>
          <div className="min-w-0 flex-1 truncate border-l border-line pl-5 text-[0.85rem] text-ink-2">
            {store ? store.what : "Atlas holds the robot's memory, its job queue and its history. Raindrop gets a signal for every outcome."}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[0.75rem]">
            {data.source === "live" ? (
              <span className="flex items-center gap-1.5 rounded-md bg-ok-soft px-2 py-1 text-ok">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />
                Live from Atlas · <span className="font-mono">{data.db}</span>
              </span>
            ) : (
              <span className="rounded-md border border-dashed border-line-2 px-2 py-1 text-mute" title={data.error}>
                Snapshot{data.taken_at ? ` · ${data.taken_at.slice(0, 16).replace("T", " ")} UTC` : ""}
              </span>
            )}
            <Link href="/" className="rounded-md border border-line-2 px-2 py-1 text-ink-2 hover:border-ink hover:text-ink">
              Deep dive
            </Link>
            <Link href="/intro" className="rounded-md border border-line-2 px-2 py-1 text-ink-2 hover:border-ink hover:text-ink">
              Intro
            </Link>
          </div>
        </header>

        <div className="card min-h-0 flex-1 overflow-hidden">
          {store ? (
            store.locked ? (
              <Locked store={store} />
            ) : (
              <StoreDetail key={store.id} store={store} />
            )
          ) : (
            <Overview data={data} onOpen={setSel} />
          )}
        </div>
      </section>
    </main>
  );
}

function SideItem({
  active,
  onClick,
  icon,
  label,
  count,
  locked,
}: {
  active: boolean;
  onClick: () => void;
  icon: IconName;
  label: string;
  count?: number | null;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "mx-2 flex w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.88rem] transition-colors",
        active ? "bg-accent text-white" : "text-ink-2 hover:bg-sunk",
      )}
    >
      <Icon name={locked ? "lock" : icon} size={15} className={active ? "text-white" : "text-mute"} />
      <span className="truncate">{label}</span>
      {count != null && (
        <span className={cx("ml-auto font-mono text-[0.72rem] tabular", active ? "text-white/80" : "text-mute")}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

// ---------- overview ----------

function Overview({ data, onOpen }: { data: StorageSnapshot; onOpen: (id: string) => void }) {
  return (
    <div className="no-scrollbar h-full overflow-y-auto p-6">
      {GROUPS.map((g) => {
        const stores = data.stores.filter((s) => s.group === g.id);
        if (!stores.length) return null;
        return (
          <div key={g.id} className="mb-7 last:mb-0">
            <div className="mb-3 flex items-baseline gap-2">
              <span className={cx("h-2 w-2 rounded-full", g.dot)} />
              <h3 className="text-[1rem] font-semibold">{g.label}</h3>
              <span className="text-[0.8rem] text-mute">{g.sub}</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
              {stores.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onOpen(s.id)}
                  className={cx(
                    "group flex flex-col rounded-xl border bg-surface p-4 text-left transition-all hover:border-accent hover:shadow-md",
                    s.locked ? "border-dashed border-line-2" : "border-line",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cx(
                        "grid h-8 w-8 place-items-center rounded-lg",
                        s.locked ? "bg-sunk text-mute" : "bg-accent-soft text-accent",
                      )}
                    >
                      <Icon name={s.locked ? "lock" : ICON[s.id] ?? "db"} size={16} />
                    </span>
                    <span className="text-[0.95rem] font-semibold">{s.label}</span>
                    <span className="ml-auto font-mono text-[1.15rem] font-semibold tabular">
                      {s.count != null ? s.count.toLocaleString() : "hidden"}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[0.7rem] text-faint">{s.location}</div>
                  <p className="mt-2 text-[0.8rem] leading-snug text-ink-2">{s.what}</p>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- one store ----------

function StoreDetail({ store }: { store: Store }) {
  const [open, setOpen] = useState<Row | null>(null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-6 pt-5 pb-4">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[2rem] leading-none font-semibold tabular">
            {store.count != null ? store.count.toLocaleString() : "—"}
          </span>
          <span className="text-[0.9rem] text-mute">documents</span>
          <span className="ml-2 rounded-md bg-sunk px-2 py-0.5 font-mono text-[0.75rem] text-ink-2">{store.location}</span>
          {store.group === "raindrop" && (
            <span className="rounded-md border border-dashed border-line-2 px-2 py-0.5 text-[0.7rem] text-mute">
              as sent, rebuilt from our Atlas records
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Fact label="Written by" value={store.writes} />
          <Fact label="Read by" value={store.reads} />
          {store.feature && <Fact label="How" value={store.feature} accent />}
        </div>
        {store.facets.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {store.facets.map((f) => (
              <span key={f.label} className="rounded-md bg-sunk px-2 py-1 text-[0.75rem] text-ink-2">
                {f.label} <span className="font-mono font-semibold text-ink">{f.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="no-scrollbar min-w-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[0.82rem]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-line text-left text-[0.72rem] text-mute">
                <th className="w-1 py-2 pl-6" />
                {store.columns.map((c) => (
                  <th key={c.key} className={cx("px-3 py-2 font-medium", c.wide && "w-full")}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {store.rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setOpen((o) => (o?.id === r.id ? null : r))}
                  className={cx(
                    "cursor-pointer border-b border-line align-top transition-colors last:border-b-0",
                    open?.id === r.id ? "bg-accent-soft" : "hover:bg-sunk",
                  )}
                >
                  <td className="py-2.5 pl-6">
                    <span
                      className={cx(
                        "mt-1.5 block h-2 w-2 rounded-full",
                        r.tone === "ok" ? "bg-ok" : r.tone === "bad" ? "bg-bad" : "bg-line-2",
                      )}
                    />
                  </td>
                  {store.columns.map((c) => (
                    <td
                      key={c.key}
                      className={cx(
                        "px-3 py-2.5",
                        c.mono && "font-mono text-[0.76rem]",
                        c.wide ? "min-w-[16rem]" : "whitespace-nowrap",
                        c.key === store.columns[0].key ? "text-ink" : "text-ink-2",
                      )}
                    >
                      {r.cells[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {store.sampled && store.count != null && store.count > store.rows.length && (
            <p className="px-6 py-3 text-[0.75rem] text-mute">
              Showing {store.rows.length} of {store.count.toLocaleString()}: the deep dive&apos;s story order first,
              then the most recent.
            </p>
          )}
        </div>

        {open && (
          <div className="animate-enter flex w-[42%] min-w-[24rem] flex-col border-l border-line">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="text-[0.72rem] font-medium tracking-wide text-mute uppercase">
                {store.group === "raindrop" ? "Payload" : "Stored document"}
              </span>
              <span className="truncate font-mono text-[0.72rem] text-ink-2">{open.id}</span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(null)}
                className="ml-auto grid h-6 w-6 place-items-center rounded text-mute hover:bg-sunk hover:text-ink"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <pre className="no-scrollbar min-h-0 flex-1 overflow-auto bg-[#0b141c] px-4 py-3 font-mono whitespace-pre-wrap break-words text-[0.74rem] leading-relaxed text-[#dfe7ef]">
              <Json value={open.raw} />
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cx("rounded-lg px-3 py-2", accent ? "bg-accent-soft" : "bg-sunk")}>
      <div className={cx("text-[0.66rem] font-medium tracking-wide uppercase", accent ? "text-accent" : "text-mute")}>
        {label}
      </div>
      <div className="mt-0.5 text-[0.8rem] leading-snug text-ink-2">{value}</div>
    </div>
  );
}

/** JSON with keys, strings and numbers tinted */
function Json({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? "";
  const parts = text.split(/("(?:[^"\\]|\\.)*"(?=\s*:)|"(?:[^"\\]|\\.)*"|\b-?\d+(?:\.\d+)?(?:e[-+]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (i % 2 === 0) return <span key={i}>{p}</span>;
        const next = parts[i + 1] ?? "";
        if (p.startsWith('"') && /^\s*:/.test(next)) return <span key={i} className="text-[#8fb4ff]">{p}</span>;
        if (p.startsWith('"')) return <span key={i} className="text-[#a5d6a7]">{p}</span>;
        return <span key={i} className="text-[#f2c38b]">{p}</span>;
      })}
    </>
  );
}

// ---------- the truth database: shown, never opened ----------

const TRUTH_FIELDS = [
  ["mass_kg", "how heavy it really is"],
  ["friction", "how slippery it is"],
  ["crush_limit_N", "how hard the fingers can squeeze"],
  ["condition", "dry, wet or shifted contents"],
  ["com_offset_m", "where the weight sits inside"],
  ["noise_seed", "keeps tool readings noisy but repeatable"],
];

function Locked({ store }: { store: Store }) {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="w-full max-w-[44rem]">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-ink text-white">
            <Icon name="lock" size={22} />
          </span>
          <div>
            <div className="text-[1.25rem] font-semibold">{store.label}</div>
            <div className="font-mono text-[0.78rem] text-mute">{store.location}</div>
          </div>
        </div>
        <p className="mt-4 text-[1rem] leading-relaxed text-ink-2">{store.what}</p>
        <div className="mt-5 rounded-xl border border-dashed border-line-2 p-4">
          <div className="mb-2 text-[0.7rem] font-medium tracking-wide text-mute uppercase">
            Fields in each document (values never shown)
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {TRUTH_FIELDS.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-2 text-[0.82rem]">
                <span className="font-mono text-ink">{k}</span>
                <span className="text-mute">{v}</span>
                <span className="ml-auto font-mono tracking-widest text-faint">••••</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Fact label="Read by" value={store.reads} />
          {store.feature && <Fact label="How it's walled off" value={store.feature} accent />}
        </div>
      </div>
    </div>
  );
}
