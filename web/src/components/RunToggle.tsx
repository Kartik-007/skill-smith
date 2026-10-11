import Link from "next/link";

export type RunId = "v1" | "v2";

const RUNS: { id: RunId; label: string; hint: string }[] = [
  { id: "v1", label: "Run 1", hint: "Recorded v1 run: fixed grip levels, train 29 → 96%" },
  { id: "v2", label: "Run 2", hint: "Harder v2 task: hidden conditions, continuous grip; one kept patch in 12" },
];

/** Switches the screen between the two recorded runs. The choice lives in the URL (?run=v2), so it survives reloads. */
export function RunToggle({ run, autoplay }: { run: RunId; autoplay?: boolean }) {
  return (
    <nav
      aria-label="Recorded run"
      className="fixed right-6 bottom-5 z-50 flex items-center gap-1 rounded-lg border border-line bg-surface p-1 text-[0.75rem] shadow-sm"
    >
      {RUNS.map((r) => (
        <Link
          key={r.id}
          href={`/?run=${r.id}${autoplay ? "&autoplay=1" : ""}`}
          title={r.hint}
          aria-current={r.id === run ? "page" : undefined}
          className={
            r.id === run
              ? "rounded-md bg-ink px-2.5 py-1 font-medium text-surface"
              : "rounded-md px-2.5 py-1 text-ink-2 hover:bg-sunk hover:text-ink"
          }
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}
