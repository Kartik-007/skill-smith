import type { Action, Family } from "@/lib/story/types";

export const FAMILY_LABEL: Record<Family, string> = {
  crush: "Crushed",
  slip: "Slipped",
  collision: "Collision",
  tip: "Tipped",
  in_box: "Not in box",
  over_budget: "Over budget",
  ordering: "Crushed by stack",
};

/** "soft · 5 N" — the level and, when known, the continuous value */
export function fmtGrip(a: Action): string {
  return a.grip_N != null ? `${a.grip} · ${a.grip_N} N` : a.grip;
}

export function fmtSpeed(a: Action): string {
  return a.speed_mps != null ? `${a.speed} · ${a.speed_mps} m/s` : a.speed;
}

export function fmtValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "on" : "off";
  if (v == null || v === "") return "none";
  return String(v);
}

export function humanKey(k: string): string {
  return k.replace(/_/g, " ");
}

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}
