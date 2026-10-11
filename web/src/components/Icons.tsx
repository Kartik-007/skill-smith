import type { FeedType } from "@/lib/types";

type P = { className?: string; size?: number };

function Svg({ className, size = 16, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

const PATHS: Record<FeedType | "leaf" | "chevron" | "play", React.ReactNode> = {
  signal: <path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z" />,
  gap: (
    <>
      <path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.1A8.5 8.5 0 1 1 21 12z" />
      <path d="M9.8 9.6a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5" />
      <path d="M12 16h.01" />
    </>
  ),
  patch: (
    <path d="M14.7 6.3a4 4 0 0 0-5.3 5.3L3.5 17.5l3 3 5.9-5.9a4 4 0 0 0 5.3-5.3l-2.4 2.4-2.6-.4-.4-2.6z" />
  ),
  verdict: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  recovery: (
    <>
      <path d="M3 12a9 9 0 1 0 2.8-6.5" />
      <path d="M3 4v5h5" />
    </>
  ),
  tripwire: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  lesson: (
    <path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2zM22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z" />
  ),
  skill: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  info: <circle cx="12" cy="12" r="3" />,
  leaf: (
    <>
      <path d="M12 2c3.2 3.6 5.2 7.2 5.2 11.2a5.2 5.2 0 0 1-10.4 0C6.8 9.2 8.8 5.6 12 2z" />
      <path d="M12 22v-9" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  play: <path d="M7 4l13 8-13 8z" />,
};

export function Icon({ name, ...p }: P & { name: keyof typeof PATHS }) {
  return <Svg {...p}>{PATHS[name]}</Svg>;
}

export const FEED_COLOR: Record<FeedType, string> = {
  signal: "#5DA8FF",
  gap: "#FFD53D",
  patch: "#B98BFF",
  verdict: "#00ED64",
  recovery: "#00ED64",
  tripwire: "#FF5D5D",
  lesson: "#FF9D3C",
  skill: "#00ED64",
  info: "#8FA9B3",
};
