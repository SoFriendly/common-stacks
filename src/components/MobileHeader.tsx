import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import {
  Search as SearchIcon,
  X,
  Library as LibraryIcon,
  Download as DownloadIcon,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { FormatFilter } from "./FormatFilter";
import { useMobileSearch } from "../lib/mobileSearch";
import { tap } from "../lib/haptics";

interface TabItem {
  to: string;
  label: string;
  Icon: LucideIcon;
}

const items: TabItem[] = [
  { to: "/library", label: "Library", Icon: LibraryIcon },
  { to: "/downloads", label: "Downloads", Icon: DownloadIcon },
  { to: "/settings", label: "Settings", Icon: SettingsIcon },
];

export function MobileHeader() {
  const { pathname } = useLocation();
  const { open, query, openSearch, closeSearch, setQuery, submit } = useMobileSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchAllowed = pathname.startsWith("/library");

  useEffect(() => {
    if (!searchAllowed && open) closeSearch();
  }, [searchAllowed, open, closeSearch]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <div
      className="sticky top-0 z-30 bg-paper/95 pb-8 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center gap-2 px-3">
        {open ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
              inputRef.current?.blur();
            }}
            className="relative my-1 flex-1"
          >
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search titles, authors, ISBNs…"
              className="w-full rounded-md border border-shelf bg-paper py-2 pr-9 pl-8 font-display text-base text-ink placeholder:text-ink-soft/70 focus:border-spine focus:outline-none"
            />
            <button
              type="button"
              onClick={closeSearch}
              aria-label="Close search"
              className="absolute top-1/2 right-1 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-ink-soft"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <>
            <div className="flex w-16 items-center justify-start">
              <FormatFilter />
            </div>
            <nav className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-shelf/60 p-1 text-sm">
              {items.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  aria-label={label}
                  onClick={() => tap(8)}
                  className={({ isActive }) =>
                    cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 font-display tracking-tight transition-colors",
                      isActive
                        ? "bg-paper text-ink shadow-sm ring-1 ring-shelf"
                        : "text-ink-soft",
                    )
                  }
                >
                  <Icon className="h-5 w-5" />
                  <span className="hidden sm:inline">{label}</span>
                </NavLink>
              ))}
            </nav>
            <div className="flex w-16 items-center justify-end">
              {searchAllowed && (
                <button
                  type="button"
                  onClick={openSearch}
                  aria-label="Search"
                  className="flex h-10 w-10 items-center justify-center rounded-md text-ink-soft"
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
