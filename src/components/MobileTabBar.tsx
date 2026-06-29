import { Link, useLocation } from "react-router";
import {
  Download as DownloadIcon,
  Library as LibraryIcon,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
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

export function MobileTabBar() {
  const { pathname } = useLocation();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-shelf/70 bg-paper/96 px-2 pt-1.5 pb-[calc(0.45rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(26,24,20,0.06)] backdrop-blur-xl">
      <div className="mx-auto grid max-w-md grid-cols-3">
        {items.map(({ to, label, Icon }) => {
          const isActive = isTabActive(pathname, to);
          return (
            <Link
              key={to}
              to={to}
              onClick={() => tap(8)}
              aria-current={isActive ? "page" : undefined}
              className="group flex min-h-[4.25rem] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[11px] font-medium text-ink-soft outline-none transition-colors"
            >
              <span
                className={cn(
                  "flex h-8 w-16 items-center justify-center rounded-full transition-[background-color,color,transform] duration-200 ease-out group-active:scale-95",
                  isActive
                    ? "bg-accent/14 text-accent"
                    : "text-ink-soft group-active:bg-shelf/80 group-active:text-ink",
                )}
              >
                <Icon
                  className="h-5 w-5"
                  strokeWidth={isActive ? 2.35 : 1.95}
                />
              </span>
              <span
                className={cn(
                  "leading-5 transition-colors",
                  isActive ? "font-semibold text-accent" : "text-ink-soft",
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function isTabActive(pathname: string, to: string): boolean {
  if (pathname === to || pathname.startsWith(`${to}/`)) return true;
  return to === "/library" && (pathname === "/browse" || pathname === "/book");
}
