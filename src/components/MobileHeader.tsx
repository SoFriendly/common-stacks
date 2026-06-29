import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import {
  ChevronLeft,
  Search as SearchIcon,
  X,
} from "lucide-react";
import { FormatFilter } from "./FormatFilter";
import { useMobileSearch } from "../lib/mobileSearch";
import { tap } from "../lib/haptics";

export function MobileHeader() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { open, query, openSearch, closeSearch, setQuery, submit } = useMobileSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchAllowed = pathname.startsWith("/library");
  const filterAllowed = pathname.startsWith("/library") || pathname.startsWith("/downloads");
  const canGoBack = pathname.startsWith("/book") || pathname.startsWith("/browse");
  const title = titleForPath(pathname, params);

  useEffect(() => {
    if (!searchAllowed && open) closeSearch();
  }, [searchAllowed, open, closeSearch]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <div
      className="sticky top-0 z-30 border-b border-shelf/60 bg-paper/95 backdrop-blur-xl"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex min-h-14 items-center gap-2 px-3">
        {open ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
              inputRef.current?.blur();
            }}
            className="relative flex-1"
          >
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search titles, authors, ISBNs…"
              className="h-11 w-full rounded-xl border border-shelf bg-white/70 pr-10 pl-9 text-base text-ink placeholder:text-ink-soft/70 focus:border-spine focus:outline-none"
            />
            <button
              type="button"
              onClick={closeSearch}
              aria-label="Close search"
              className="absolute top-1/2 right-1 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-soft active:bg-shelf"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <>
            <div className="flex w-11 items-center justify-start">
              {canGoBack ? (
                <button
                  type="button"
                  onClick={() => {
                    tap(8);
                    navigate(-1);
                  }}
                  aria-label="Back"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft active:bg-shelf active:text-ink"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
              ) : (
                filterAllowed && <FormatFilter mobile />
              )}
            </div>
            <div className="min-w-0 flex-1 text-center">
              <div className="truncate font-display text-xl tracking-tight text-ink">
                {title}
              </div>
            </div>
            <div className="flex w-11 items-center justify-end">
              {searchAllowed && (
                <button
                  type="button"
                  onClick={() => {
                    tap(8);
                    openSearch();
                  }}
                  aria-label="Search"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft active:bg-shelf active:text-ink"
                >
                  <SearchIcon className="h-5 w-5" />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function titleForPath(pathname: string, params: URLSearchParams): string {
  if (pathname.startsWith("/downloads")) return "Downloads";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/book")) return "Book";
  if (pathname.startsWith("/browse")) return params.get("title") || "Browse";
  return "Library";
}
