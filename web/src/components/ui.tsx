"use client";
import { useEffect, useRef, useState } from "react";

export function Panel({
  className = "",
  children,
  glow = false,
}: {
  className?: string;
  children: React.ReactNode;
  glow?: boolean;
}) {
  return (
    <section
      className={`relative flex min-h-0 min-w-0 flex-col rounded-2xl border bg-panel/60 p-4 backdrop-blur-sm transition-[border-color,box-shadow] duration-700 ${
        glow ? "border-leaf/70 shadow-[0_0_32px_-6px_rgb(0_237_100/0.45)]" : "border-line/80"
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelHead({
  title,
  sub,
  right,
  sample,
}: {
  title: string;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  sample?: boolean;
}) {
  return (
    <header className="mb-3 flex shrink-0 items-baseline justify-between gap-4">
      <div className="flex min-w-0 items-baseline gap-3">
        <h2 className="shrink-0 text-[0.8rem] font-semibold uppercase tracking-[0.22em] text-leaf">{title}</h2>
        {sub ? <span className="truncate text-[0.95rem] text-mute">{sub}</span> : null}
        {sample ? (
          <span
            title="This panel is showing sample data because its collection is empty"
            className="shrink-0 rounded border border-line-2 px-1.5 py-px text-[0.65rem] uppercase tracking-widest text-faint"
          >
            sample
          </span>
        ) : null}
      </div>
      {right ? <div className="shrink-0 text-right text-[0.9rem] text-mute">{right}</div> : null}
    </header>
  );
}

/** Size of an element, tracked with ResizeObserver. 0x0 until mounted. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.w - width) < 1 && Math.abs(s.h - height) < 1 ? s : { w: width, h: height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    // fonts can land after first layout
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return [ref, size] as const;
}
