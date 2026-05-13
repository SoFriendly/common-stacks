import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";
import { DefaultCover } from "./DefaultCover";

interface Props {
  title: string;
  authors?: string[];
  cover?: string;
  /** Small format badge overlaid on the cover ("Audiobook", "PDF", etc.) */
  badge?: string;
  /** Render the cover as a square (e.g. for audiobooks) instead of 2:3. */
  square?: boolean;
  className?: string;
  onClick?: () => void;
}

type CoverState =
  | { kind: "loading" }
  | { kind: "real" }
  | { kind: "icon"; natural: number }
  | { kind: "failed" };

const SMALL_IMAGE_PX = 96; // anything narrower than this is treated as an icon

export function CoverCard({ title, authors, cover, badge, square, className, onClick }: Props) {
  const [state, setState] = useState<CoverState>(
    cover ? { kind: "loading" } : { kind: "failed" },
  );
  // Reset the load state whenever the cover URL changes — otherwise once we
  // hit "failed" or "icon" the component permanently skips rendering the
  // <img>, so a later enrichment can never recover from a broken thumbnail.
  const lastCoverRef = useRef<string | undefined>(cover);
  useEffect(() => {
    if (lastCoverRef.current === cover) return;
    lastCoverRef.current = cover;
    setState(cover ? { kind: "loading" } : { kind: "failed" });
  }, [cover]);

  const author = authors?.[0];

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-36 shrink-0 flex-col text-left transition-transform hover:-translate-y-1",
        className,
      )}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-md bg-shelf shadow-sm ring-1 ring-black/5 transition-shadow group-hover:shadow-lg",
          square ? "aspect-square" : "aspect-[2/3]",
        )}
      >
        {cover && state.kind !== "failed" && state.kind !== "icon" && (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className={cn(
              "h-full w-full object-cover transition-opacity",
              state.kind === "loading" ? "opacity-0" : "opacity-100",
            )}
            onLoad={(e) => {
              const w = e.currentTarget.naturalWidth;
              if (w > 0 && w < SMALL_IMAGE_PX) {
                setState({ kind: "icon", natural: w });
              } else {
                setState({ kind: "real" });
              }
            }}
            onError={() => setState({ kind: "failed" })}
          />
        )}
        {(state.kind === "failed" || state.kind === "icon" || state.kind === "loading") && (
          <DefaultCover title={title} author={author} className="absolute inset-0 h-full w-full" />
        )}
        {state.kind === "icon" && cover && !author && (
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              src={cover}
              alt=""
              aria-hidden
              className="h-10 w-10 opacity-70 mix-blend-luminosity grayscale"
              style={{ imageRendering: "auto" }}
            />
          </div>
        )}
        {badge && (
          <span className="absolute top-1.5 left-1.5 rounded-full bg-ink/85 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-paper backdrop-blur-sm">
            {badge}
          </span>
        )}
      </div>
      <div className="mt-2 line-clamp-2 font-display text-sm leading-snug text-ink">
        {title}
      </div>
      {authors && authors.length > 0 && (
        <div className="line-clamp-2 break-words text-xs text-ink-soft [overflow-wrap:anywhere]">
          {authors.join(", ")}
        </div>
      )}
    </button>
  );
}
