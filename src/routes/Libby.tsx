import { useEffect, useRef, useState } from "react";
import { Navigate, NavLink } from "react-router";
import { Settings as SettingsIcon } from "lucide-react";
import { api } from "../lib/api";
import { ViewToggle } from "../components/ViewToggle";

// The Libby "browser" is a native child webview the Rust side overlays on the
// main window (see src-tauri/src/libby.rs). This route owns its lifecycle:
// the placeholder div below reports its rect so the webview tracks our layout,
// show on mount, hide on unmount. The webview itself survives navigation away
// so Libby's session and place in the app are kept.
export function Libby() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getLibbyEnabled().then(setEnabled).catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const el = placeholderRef.current;
    if (!el) return;

    const bounds = () => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };

    let shown = false;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!shown) return;
        api.libbySetBounds(bounds()).catch(() => {});
      });
    };

    api
      .libbyShow(bounds())
      .then(() => {
        shown = true;
        // The rect can settle after fonts/layout load; re-sync once shown.
        sync();
      })
      .catch((e) => console.error("libby show failed:", e));

    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sync);
      api.libbyHide().catch(() => {});
    };
  }, [enabled]);

  if (enabled === null) return null;
  if (!enabled) return <Navigate to="/library" replace />;

  return (
    <div className="flex h-[calc(100vh-2.5rem)] flex-col px-6 pb-6">
      <header className="mb-6 flex items-center justify-between gap-6">
        <ViewToggle />
        <NavLink
          to="/settings"
          aria-label="Settings"
          title="Settings"
          className="flex h-9 w-9 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-shelf hover:text-ink"
        >
          <SettingsIcon className="h-4 w-4" />
        </NavLink>
      </header>
      <div
        ref={placeholderRef}
        className="min-h-0 flex-1 overflow-hidden rounded-lg border border-shelf bg-shelf/30"
      />
    </div>
  );
}
