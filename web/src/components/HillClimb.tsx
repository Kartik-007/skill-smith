"use client";
import { useMemo, useState } from "react";
import { FAMILY_COLOR, baselineVersion, incumbent, pct, secs, signed, usd } from "@/lib/derive";
import type { Family, HarnessVersion } from "@/lib/types";
import { Panel, PanelHead, useSize } from "./ui";

type Kind = "base" | "kept" | "fail" | "running";
type Pt = { v: HarnessVersion; kind: Kind; y: number; scored: boolean; level: number };
type Box = { x0: number; x1: number; y0: number; y1: number };

const LEAF = "#00ED64";
const CRUSH = "#FF5D5D";
const LABEL_PX = 12.5;
const CHAR_W = LABEL_PX * 0.56;

function kindOf(v: HarnessVersion): Kind {
  if (v.version === 0 || v.status === "baseline") return "base";
  if (v.status === "kept") return "kept";
  if (v.status === "running") return "running";
  return "fail";
}

function verdictWord(v: HarnessVersion): string {
  const s = v.status === "running" ? "on trial" : (v.verdict ?? v.status);
  return s.replace("_", " ").toUpperCase();
}

const LINE_H = 14;
type Anchor = "start" | "end" | "middle";
type Label = { x: number; y: number; lines: string[]; anchor: Anchor };

/** Greedy word wrap into at most maxLines lines of maxChars; the last line gets "…" if text is left over. */
function wrap(text: string, maxChars: number, maxLines: number): { lines: string[]; complete: boolean; kept: number } {
  if (maxChars < 4) return { lines: [], complete: false, kept: 0 };
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  let used = 0;
  for (let k = 0; k < words.length; k++) {
    let word = words[k];
    if (word.length > maxChars) word = `${word.slice(0, maxChars - 1)}…`;
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= maxChars) {
      cur = next;
      used = k + 1;
      continue;
    }
    lines.push(cur);
    if (lines.length === maxLines) {
      cur = "";
      break;
    }
    cur = word;
    used = k + 1;
  }
  if (cur) lines.push(cur);
  const complete = used === words.length && !lines.some((l) => l.endsWith("…"));
  if (!complete && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.endsWith("…") ? last : `${last.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
  }
  const kept = lines.join(" ").replace(/…$/, "").length;
  return { lines, complete, kept };
}

function buildPoints(versions: HarnessVersion[]): Pt[] {
  const byV = new Map(versions.map((v) => [v.version, v]));
  const firstScored = versions.find((v) => v.scores?.H != null)?.scores?.H ?? 0;
  let level = baselineVersion(versions)?.scores?.H ?? firstScored;
  return versions.map((v) => {
    const H = v.scores?.H ?? null;
    const kind = kindOf(v);
    const parentH = v.parent != null ? byV.get(v.parent)?.scores?.H : undefined;
    const y = H ?? (kind === "running" ? level : (parentH ?? level));
    const pt = { v, kind, y, scored: H != null, level };
    if ((kind === "base" || kind === "kept") && H != null) level = H;
    return pt;
  });
}

export function HillClimb({ versions, sample, fresh }: { versions: HarnessVersion[]; sample: boolean; fresh: boolean }) {
  const [boxRef, { w, h }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => buildPoints(versions), [versions]);
  const base = baselineVersion(versions);
  const best = incumbent(versions);
  const baseH = base?.scores?.H ?? null;
  const bestH = best?.scores?.H ?? null;
  const last = versions[versions.length - 1];

  const chart = useMemo(() => {
    if (!w || !h || !pts.length) return null;
    const spacingGuess = (w - 60) / pts.length;
    const compact = spacingGuess < 82;
    const padL = 44;
    const padR = 14;
    const padT = 40;
    const padB = compact ? 62 : 48;
    const plotW = Math.max(10, w - padL - padR);
    const plotH = Math.max(10, h - padT - padB);
    const spacing = plotW / pts.length;
    const ys = pts.map((p) => p.y).concat(baseH != null ? [baseH] : []);
    let lo = Math.max(0, Math.floor((Math.min(...ys) - 6) / 10) * 10);
    const hi = Math.min(100, Math.ceil((Math.max(...ys) + 6) / 10) * 10);
    if (hi - lo < 30) lo = Math.max(0, hi - 30);
    const X = (i: number) => padL + (i + 0.5) * spacing;
    const Y = (val: number) => padT + ((hi - val) / Math.max(1, hi - lo)) * plotH;
    const step = hi - lo > 60 ? 20 : 10;
    const ticks: number[] = [];
    for (let t = lo; t <= hi; t += step) ticks.push(t);

    // incumbent path: a step line through baseline and kept versions, extended to the newest version
    let d = "";
    pts.forEach((p, i) => {
      if (!((p.kind === "base" || p.kind === "kept") && p.scored)) return;
      d += d ? ` H ${X(i)} V ${Y(p.y)}` : `M ${X(i)} ${Y(p.y)}`;
    });
    if (d) d += ` H ${X(pts.length - 1)}`;

    // Patch labels. Kept labels sit above the incumbent line, to the right of the dot (where the line runs
    // flat) or to the left; failed ones sit under their cross. A label that collides everywhere is dropped
    // (hover still shows it).
    const placed: Box[] = [];
    const overlaps = (b: Box) => placed.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    pts.forEach((p, i) => {
      placed.push({ x0: X(i) - 9, x1: X(i) + 9, y0: Y(p.y) - 9, y1: Y(p.y) + 9 });
      if (p.kind === "kept") placed.push({ x0: X(i) - 44, x1: X(i) - 9, y0: Y(p.y) - 9, y1: Y(p.y) + 9 }); // "+11", left of the riser
    });
    if (baseH != null) placed.push({ x0: w - padR - 64, x1: w - padR, y0: Y(baseH) + 2, y1: Y(baseH) + 18 }); // "v0 50%"
    const left = padL + 2;
    const right = w - padR;
    // above: dy is the baseline of the LAST line; below: dy is the baseline of the FIRST line
    type Cand = { anchor: Anchor; x: number; dy: number; above: boolean; cap: number };
    const order = pts.map((_, i) => i).sort((a, b) => {
      const rank = (k: Kind) => (k === "kept" ? 0 : k === "base" ? 1 : k === "running" ? 2 : 3);
      return rank(pts[a].kind) - rank(pts[b].kind) || b - a;
    });
    const labels: (Label | null)[] = pts.map(() => null);
    for (const i of order) {
      const p = pts[i];
      const text = p.kind === "base" ? "bare harness" : p.v.patch_text || p.v.patch?.op || "";
      if (!text) continue;
      const x = X(i);
      const y = Y(p.y);
      const failCap = Math.max(1.8 * spacing, 84);
      const cands: Cand[] =
        p.kind === "fail"
          ? [
              { anchor: "middle", x, dy: 24, above: false, cap: failCap },
              { anchor: "middle", x, dy: -16, above: true, cap: failCap },
            ]
          : p.kind === "base"
            ? [
                { anchor: "start", x: x - 6, dy: 24, above: false, cap: 150 },
                { anchor: "start", x: x - 6, dy: -14, above: true, cap: 150 },
              ]
            : [
                { anchor: "start", x: x - 4, dy: -15, above: true, cap: 190 },
                { anchor: "end", x: x + 4, dy: -15, above: true, cap: 190 },
                { anchor: "start", x: x - 4, dy: -31, above: true, cap: 190 },
                { anchor: "end", x: x + 4, dy: -31, above: true, cap: 190 },
                { anchor: "middle", x, dy: 26, above: false, cap: 160 },
              ];
      // first pass wants the whole text; second accepts a truncated label that keeps most of it
      outer: for (const strict of [true, false]) {
        for (const c of cands) {
          const room = c.anchor === "start" ? right - c.x : c.anchor === "end" ? c.x - left : 2 * Math.min(c.x - left, right - c.x);
          const maxChars = Math.floor(Math.min(room, c.cap) / CHAR_W);
          const wr = wrap(text, maxChars, 2);
          if (strict ? !wr.complete : wr.kept < Math.min(text.length, 0.7 * text.length + 2)) continue;
          const n = wr.lines.length;
          const firstY = c.above ? y + c.dy - (n - 1) * LINE_H : y + c.dy;
          const lastY = firstY + (n - 1) * LINE_H;
          if (firstY - LABEL_PX < 2 || lastY > padT + plotH + 6) continue;
          const width = Math.max(...wr.lines.map((l) => l.length)) * CHAR_W;
          const x0 = c.anchor === "start" ? c.x : c.anchor === "end" ? c.x - width : c.x - width / 2;
          const b = { x0: x0 - 3, x1: x0 + width + 3, y0: firstY - LABEL_PX, y1: lastY + 3 };
          if (overlaps(b)) continue;
          placed.push(b);
          labels[i] = { x: c.x, y: firstY, lines: wr.lines, anchor: c.anchor };
          break outer;
        }
      }
    }
    return { padL, padR, padT, padB, plotW, plotH, spacing, X, Y, ticks, d, labels, compact };
  }, [w, h, pts, baseH]);

  const hp = hover != null ? pts[hover] : null;
  const finalBase = base?.scores?.F;
  const finalBest = best?.scores?.F;

  return (
    <Panel glow={fresh}>
      <PanelHead
        title="Hill climb"
        sub="held-out, damage-free items"
        sample={sample}
        right={
          bestH != null ? (
            <span className="flex items-baseline gap-2">
              {baseH != null && best && best.version !== base?.version ? (
                <span className="font-mono text-[1rem] text-mute tabular">v0 {pct(baseH)} →</span>
              ) : null}
              <span className="font-mono text-[1.9rem] font-bold leading-none text-leaf tabular">{pct(bestH)}</span>
            </span>
          ) : null
        }
      />
      <div ref={boxRef} className="relative min-h-0 flex-1" onMouseLeave={() => setHover(null)}>
        {chart ? (
          <svg width={w} height={h} className="absolute inset-0 overflow-visible">
            {chart.ticks.map((t) => (
              <g key={t}>
                <line x1={chart.padL} x2={w - chart.padR} y1={chart.Y(t)} y2={chart.Y(t)} stroke="#15485c" strokeWidth={1} opacity={0.6} />
                <text x={chart.padL - 8} y={chart.Y(t) + 4} textAnchor="end" fontSize={11.5} fill="#5d7d8a" className="font-mono">
                  {t}%
                </text>
              </g>
            ))}

            {baseH != null ? (
              <g>
                <line
                  x1={chart.padL}
                  x2={w - chart.padR}
                  y1={chart.Y(baseH)}
                  y2={chart.Y(baseH)}
                  stroke="#8fa9b3"
                  strokeWidth={1.25}
                  strokeDasharray="5 5"
                  opacity={0.75}
                />
                <text x={w - chart.padR} y={chart.Y(baseH) + 15} textAnchor="end" fontSize={11.5} fill="#8fa9b3" className="font-mono">
                  v0 {pct(baseH)}
                </text>
              </g>
            ) : null}

            {chart.d ? (
              <path d={chart.d} fill="none" stroke={LEAF} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />
            ) : null}

            {pts.map((p, i) => {
              const x = chart.X(i);
              const y = chart.Y(p.y);
              const s = p.v.scores;
              const delta = s?.delta_H ?? (p.scored && p.kind !== "base" ? p.y - p.level : null);
              const vColor = p.kind === "kept" ? LEAF : p.kind === "fail" ? CRUSH : p.kind === "running" ? "#e8f1ee" : "#8fa9b3";
              return (
                <g key={p.v.version}>
                  {p.kind === "fail" && p.scored && Math.abs(chart.Y(p.level) - y) > 2 ? (
                    <line x1={x} x2={x} y1={chart.Y(p.level)} y2={y} stroke={CRUSH} strokeWidth={1.5} strokeDasharray="3 4" opacity={0.7} />
                  ) : null}

                  {p.kind === "fail" ? (
                    <g stroke={CRUSH} strokeWidth={3} strokeLinecap="round" opacity={p.scored ? 1 : 0.7}>
                      <line x1={x - 6.5} y1={y - 6.5} x2={x + 6.5} y2={y + 6.5} />
                      <line x1={x - 6.5} y1={y + 6.5} x2={x + 6.5} y2={y - 6.5} />
                    </g>
                  ) : p.kind === "running" ? (
                    <g>
                      <circle cx={x} cy={y} r={7} fill="none" stroke={LEAF} strokeWidth={2} strokeDasharray="3 3">
                        <animateTransform attributeName="transform" type="rotate" from={`0 ${x} ${y}`} to={`360 ${x} ${y}`} dur="4s" repeatCount="indefinite" />
                      </circle>
                      <circle cx={x} cy={y} r={7} fill="none" stroke={LEAF} strokeWidth={1.5}>
                        <animate attributeName="r" values="7;16" dur="1.6s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.6;0" dur="1.6s" repeatCount="indefinite" />
                      </circle>
                    </g>
                  ) : (
                    <circle
                      cx={x}
                      cy={y}
                      r={p.kind === "kept" ? 7 : 6}
                      fill={p.kind === "kept" ? LEAF : "#8fa9b3"}
                      stroke="#001e2b"
                      strokeWidth={2.5}
                    />
                  )}

                  {p.kind === "kept" && delta != null ? (
                    <text x={x - 11} y={y + 4.5} textAnchor="end" fontSize={13} fontWeight={700} fill={LEAF} className="font-mono">
                      {signed(delta)}
                    </text>
                  ) : null}

                  {/* x axis: version, then cost and cycle time */}
                  <text x={x} y={chart.padT + chart.plotH + 20} textAnchor="middle" fontSize={13.5} fontWeight={700} fill={vColor} className="font-mono">
                    v{p.v.version}
                  </text>
                  {chart.compact ? (
                    <>
                      <text x={x} y={chart.padT + chart.plotH + 36} textAnchor="middle" fontSize={11} fill="#8fa9b3" className="font-mono">
                        {s?.cost_usd != null ? usd(s.cost_usd) : ""}
                      </text>
                      <text x={x} y={chart.padT + chart.plotH + 50} textAnchor="middle" fontSize={11} fill="#8fa9b3" className="font-mono">
                        {s?.cycle_s != null ? secs(s.cycle_s) : ""}
                      </text>
                    </>
                  ) : (
                    <text x={x} y={chart.padT + chart.plotH + 37} textAnchor="middle" fontSize={11} fill="#8fa9b3" className="font-mono">
                      {s?.cost_usd != null || s?.cycle_s != null ? `${usd(s?.cost_usd)} · ${secs(s?.cycle_s)}` : ""}
                    </text>
                  )}

                  {/* hover target */}
                  <rect
                    x={x - chart.spacing / 2}
                    y={0}
                    width={chart.spacing}
                    height={h}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                  />
                </g>
              );
            })}

            {chart.labels.map((l, i) =>
              l ? (
                <text
                  key={`l${pts[i].v.version}`}
                  x={l.x}
                  y={l.y}
                  textAnchor={l.anchor}
                  fontSize={LABEL_PX}
                  fontWeight={pts[i].kind === "kept" ? 600 : 400}
                  fill={pts[i].kind === "kept" ? "#c9f7dc" : pts[i].kind === "fail" ? "#ff9b9b" : "#8fa9b3"}
                  pointerEvents="none"
                >
                  {l.lines.map((line, k) => (
                    <tspan key={k} x={l.x} dy={k === 0 ? 0 : LINE_H}>
                      {line}
                    </tspan>
                  ))}
                </text>
              ) : null,
            )}
          </svg>
        ) : null}

        {hp && chart ? (
          <Tooltip
            p={hp}
            x={chart.X(hover!)}
            y={chart.Y(hp.y)}
            w={w}
          />
        ) : null}
      </div>

      <footer className="mt-2 shrink-0 space-y-1 border-t border-line/60 pt-2 text-[0.9rem]">
        {finalBase != null && finalBest != null && best && best.version !== base?.version ? (
          <div className="flex items-baseline gap-2">
            <span className="text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-mute">final exam</span>
            <span className="font-mono tabular text-text">
              v0 {pct(finalBase)} → best <span className="font-bold text-leaf">{pct(finalBest)}</span>
            </span>
            <span className="text-faint">snacks no agent has ever seen</span>
          </div>
        ) : null}
        {last ? <LatestVerdict v={last} /> : null}
      </footer>
    </Panel>
  );
}

function LatestVerdict({ v }: { v: HarnessVersion }) {
  const kind = kindOf(v);
  if (kind === "base") return <div className="truncate text-mute">v0 baseline measured · waiting for the first patch</div>;
  const color = kind === "kept" ? "text-leaf" : kind === "fail" ? "text-crush" : "text-text";
  const dH = v.scores?.delta_H;
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 font-mono font-bold">v{v.version}</span>
      <span className={`shrink-0 font-bold tracking-wide ${color}`}>
        {kind === "running" ? <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-leaf align-middle" /> : null}
        {verdictWord(v)}
        {dH != null && kind !== "running" ? ` ${signed(dH)} pts` : ""}
      </span>
      <span className="truncate text-mute">
        {kind === "running" ? `${v.patch_text} · evaluating on held-out orders` : v.verdict_reason || v.patch_text}
      </span>
    </div>
  );
}

function Tooltip({ p, x, y, w }: { p: Pt; x: number; y: number; w: number }) {
  const v = p.v;
  const s = v.scores;
  const left = Math.min(Math.max(x - 150, 0), Math.max(0, w - 300));
  const above = y > 150;
  const fam = Object.entries(s?.by_family ?? {}).filter(([, n]) => (n ?? 0) > 0) as [Family, number][];
  return (
    <div
      className="pointer-events-none absolute z-10 w-[300px] rounded-xl border border-line-2 bg-ink/95 p-3 text-[0.85rem] shadow-2xl"
      style={{ left, top: above ? undefined : y + 18, bottom: above ? `calc(100% - ${y - 18}px)` : undefined }}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[1rem] font-bold">v{v.version}</span>
        <span className={`font-semibold ${p.kind === "kept" ? "text-leaf" : p.kind === "fail" ? "text-crush" : "text-mute"}`}>
          {p.kind === "base" ? "BASELINE" : verdictWord(v)}
        </span>
      </div>
      {v.patch_text ? <div className="mt-1 font-mono text-text">{v.patch_text}</div> : null}
      {v.verdict_reason || v.rationale ? <div className="mt-1 text-mute">{v.verdict_reason || v.rationale}</div> : null}
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[0.8rem] text-text/90 tabular">
        <span>held-out {p.scored ? pct(s?.H) : "not run"}</span>
        <span>train {pct(s?.T)}</span>
        <span>p_better {s?.p_better != null ? s.p_better.toFixed(2) : "–"}</span>
        <span>Δ held-out {signed(s?.delta_H) || "–"}</span>
        <span>cost {usd(s?.cost_usd)}</span>
        <span>cycle {secs(s?.cycle_s)}</span>
      </div>
      {fam.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {fam.map(([f, n]) => (
            <span key={f} className="rounded px-1.5 py-px text-[0.75rem] font-semibold" style={{ color: FAMILY_COLOR[f], boxShadow: `inset 0 0 0 1px ${FAMILY_COLOR[f]}88` }}>
              {f} {n}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
