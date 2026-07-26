import { NavLink } from "react-router";
import { cn } from "../lib/utils";
import { useLibbyEnabled } from "../lib/libbyPref";

const baseItems = [
  { to: "/library", label: "Library" },
  { to: "/downloads", label: "Downloads" },
];

export function ViewToggle() {
  const libbyEnabled = useLibbyEnabled();
  const items = libbyEnabled
    ? [...baseItems, { to: "/libby", label: "Libby" }]
    : baseItems;
  return (
    <nav className="inline-flex items-center gap-1 rounded-lg bg-shelf/60 p-1 text-sm">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-1.5 font-display tracking-tight transition-colors",
              isActive
                ? "bg-paper text-ink shadow-sm"
                : "text-ink-soft hover:text-ink",
            )
          }
        >
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
}
