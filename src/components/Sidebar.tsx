import { NavLink } from "react-router";
import { BookOpen, Search, Download, Settings as Cog } from "lucide-react";
import { cn } from "../lib/utils";

const items = [
  { to: "/library", label: "Library", Icon: BookOpen },
  { to: "/search", label: "Search", Icon: Search },
  { to: "/downloads", label: "Downloads", Icon: Download },
  { to: "/settings", label: "Settings", Icon: Cog },
];

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-shelf bg-paper/80 backdrop-blur">
      <div className="px-5 pt-12 pb-8">
        <div className="font-display text-2xl tracking-tight text-ink">CommonStacks</div>
        <div className="mt-0.5 text-xs text-ink-soft">wander the stacks</div>
      </div>
      <nav className="flex flex-col gap-1 px-3">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-shelf text-ink"
                  : "text-ink-soft hover:bg-shelf/60 hover:text-ink",
              )
            }
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
