"use client";
import { useState } from "react";
import { shortName } from "@/lib/derive";
import type { LiveRequest, ProductOption } from "@/lib/types";

type Sent = { id: string; name: string; product_id: string };

const STATUS_WORD: Record<string, string> = {
  new: "queued",
  queued: "queued",
  picked: "packing",
  running: "packing",
  planning: "packing",
  done: "packed",
  failed: "failed",
};

export function LiveOrderForm({
  products,
  requests,
  disabled,
}: {
  products: ProductOption[];
  requests: LiveRequest[];
  disabled: string | null;
}) {
  const [name, setName] = useState("");
  const [productId, setProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firstByName = [...products].sort((a, b) => shortName(a.id, a.label).localeCompare(shortName(b.id, b.label)))[0];
  const chosen = productId || firstByName?.id || "";
  const tracked = sent ? requests.find((r) => r.id === sent.id) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || busy) return;
    const n = name.trim();
    if (!n) {
      setError("Type your name");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/live-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, product_id: chosen }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `error ${r.status}`);
      setSent({ id: j.id, name: j.name, product_id: j.product_id });
      setName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex shrink-0 items-center gap-2 border-t border-line/60 pt-3">
      <span className="shrink-0 text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-mute">Your turn</span>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder="Your name"
        aria-label="Your name"
        className="h-9 w-[9.5rem] min-w-0 rounded-lg border border-line-2 bg-ink/70 px-3 text-[0.95rem] text-text placeholder:text-faint focus:border-leaf focus:outline-none"
      />
      <select
        value={chosen}
        onChange={(e) => setProductId(e.target.value)}
        aria-label="Snack"
        className="h-9 w-[11rem] min-w-0 rounded-lg border border-line-2 bg-ink/70 px-2 text-[0.95rem] text-text focus:border-leaf focus:outline-none"
      >
        {products
          .map((p) => ({ id: p.id, name: shortName(p.id, p.label) }))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      <button
        type="submit"
        disabled={busy || Boolean(disabled)}
        title={disabled ?? undefined}
        className="h-9 shrink-0 rounded-lg bg-leaf px-4 text-[0.95rem] font-bold text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Sending…" : "Pack it"}
      </button>
      <span className="min-w-0 truncate text-[0.9rem]">
        {error ? (
          <span className="text-crush">{error}</span>
        ) : sent ? (
          <span className="text-leaf">
            {STATUS_WORD[tracked?.status ?? "new"] ?? tracked?.status} for {sent.name} ·{" "}
            <span className="text-text/80">{shortName(sent.product_id)}</span>
          </span>
        ) : disabled ? (
          <span className="text-faint">{disabled}</span>
        ) : (
          <span className="text-faint">the robot packs it live</span>
        )}
      </span>
    </form>
  );
}
