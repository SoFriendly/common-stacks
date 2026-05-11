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

export function CoverCard({ title, authors, cover, className, onClick }: Props) {
  const [failed, setFailed] = useState(false);
  const showCover = cover && !failed;
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
        {showCover ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <DefaultCover title={title} author={author} className="h-full w-full" />
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
