import { useEffect, useRef, useState } from "react";
import { Filter, Check } from "lucide-react";
import { useFormatFilter, type FormatFilter as Value } from "../lib/formatFilter";

const OPTIONS: { value: Value; label: string }[] = [
  { value: "all", label: "All" },
  { value: "books", label: "Books" },
  { value: "audiobooks", label: "Audiobooks" },
];

export function FormatFilter() {
  const [value, setValue] = useFormatFilter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const active = value !== "all";
  const label = OPTIONS.find((o) => o.value === value)?.label ?? "All";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Filter by format"
        title={`Filter: ${label}`}
        className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
          active
            ? "bg-shelf text-ink"
            : "text-ink-soft hover:bg-shelf hover:text-ink"
        }`}
      >
        <Filter className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-1 w-40 overflow-hidden rounded-md border border-shelf bg-paper shadow-lg ring-1 ring-black/10"
        >
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                setValue(o.value);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-ink hover:bg-shelf"
            >
              <span>{o.label}</span>
              {value === o.value && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
