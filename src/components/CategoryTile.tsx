import { cn } from "../lib/utils";

interface Props {
  title: string;
  className?: string;
  onClick?: () => void;
}

// Same palette as DefaultCover so categories feel like part of the shelf.
const PALETTES: { bg: string; ink: string; accent: string }[] = [
  { bg: "#2b3a2f", ink: "#f1e7d0", accent: "#c9a86a" },
  { bg: "#5a3825", ink: "#f4e9d6", accent: "#d6a85a" },
  { bg: "#1e3a5f", ink: "#e8e4d5", accent: "#c7b07a" },
  { bg: "#7a2e2e", ink: "#f1e7d0", accent: "#d6a85a" },
  { bg: "#3d3a4f", ink: "#ece5d2", accent: "#bfa46a" },
  { bg: "#2e4a3f", ink: "#ece5d2", accent: "#cfa85a" },
  { bg: "#4a2e3f", ink: "#ece5d2", accent: "#c7a86a" },
  { bg: "#1f2a2e", ink: "#e6dfc8", accent: "#b89968" },
  { bg: "#5e4a2e", ink: "#f1e7d0", accent: "#e0c186" },
  { bg: "#264046", ink: "#ece5d2", accent: "#c0a165" },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function CategoryTile({ title, className, onClick }: Props) {
  const palette = PALETTES[hash(title) % PALETTES.length];
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-36 shrink-0 flex-col text-left transition-transform hover:-translate-y-1",
        className,
      )}
    >
      <div
        className="relative flex aspect-[2/3] w-full items-center justify-center overflow-hidden rounded-md p-4 text-center shadow-sm ring-1 ring-black/5 transition-shadow group-hover:shadow-lg"
        style={{ backgroundColor: palette.bg, color: palette.ink }}
      >
        <span className="font-display text-base leading-snug">{title}</span>
        <span
          aria-hidden
          className="absolute bottom-3 right-3 text-xs"
          style={{ color: palette.accent, letterSpacing: 2 }}
        >
          →
        </span>
      </div>
    </button>
  );
}
