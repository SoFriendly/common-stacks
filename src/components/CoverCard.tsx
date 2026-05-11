import { useState } from "react";
import { cn } from "../lib/utils";
import { DefaultCover } from "./DefaultCover";

interface Props {
  title: string;
  authors?: string[];
  cover?: string;
  className?: string;
  onClick?: () => void;
}

type CoverState =
  | { kind: "loading" }
  | { kind: "real" }
  | { kind: "icon"; natural: number }
  | { kind: "failed" };

const SMALL_IMAGE_PX = 96; // anything narrower than this is treated as an icon

export function CoverCard({ title, authors, cover, className, onClick }: Props) {
  const [state, setState] = useState<CoverState>(
    cover ? { kind: "loading" } : { kind: "failed" },
  );
  const author = authors?.[0];

  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-36 shrink-0 flex-col text-left transition-transform hover:-translate-y-1",
        className,
      )}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-shelf shadow-sm ring-1 ring-black/5 transition-shadow group-hover:shadow-lg">
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
