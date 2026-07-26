import { useEffect, useRef, useState } from "react";
import { Navigate, NavLink } from "react-router";
import { Settings as SettingsIcon } from "lucide-react";
import { api, type LibbyDownloadResult } from "../lib/api";
import { ViewToggle } from "../components/ViewToggle";
import { useIsAndroid } from "../lib/platform";

// The Libby "browser" is a native child webview the Rust side overlays on the
// main window (see src-tauri/src/libby.rs). This route owns its lifecycle:
// the placeholder div below reports its rect so the webview tracks our layout,
// show on mount, hide on unmount. The webview itself survives navigation away
// so Libby's session and place in the app are kept.
export function Libby() {
  const isAndroid = useIsAndroid();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getLibbyEnabled().then(setEnabled).catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (!enabled || isAndroid) return;
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
  }, [enabled, isAndroid]);

  if (enabled === null) return null;
  if (!enabled) return <Navigate to="/library" replace />;
  if (isAndroid) return <AndroidLibby />;

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

// Android: libbyapp.com renders in an iframe inside the main webview. The
// injected script reaches the cross-origin frame via Android's document-start
// script API; book context and download requests arrive here as JSON strings
// through window.__csLibbyBridge (installed by MainActivity.kt) and are
// relayed to the Rust commands. Because the iframe is ordinary DOM (unlike
// the desktop native overlay), the confirmation modal renders in React.
function AndroidLibby() {
  const [modal, setModal] = useState<LibbyDownloadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__csLibbyBridge = (
      raw: string,
    ) => {
      try {
        const msg = JSON.parse(raw) as { kind: string; data: never };
        if (msg.kind === "context") {
          api.libbyReportContext(msg.data).catch(() => {});
        } else if (msg.kind === "download") {
          api
            .libbyAndroidDownload(msg.data)
            .then(setModal)
            .catch((e) => setError(String(e)));
        }
      } catch {
        // Malformed bridge message — ignore.
      }
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__csLibbyBridge;
    };
  }, []);

  return (
    <div className="h-[calc(100dvh-3.5rem-5.25rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full">
      <iframe
        src="https://libbyapp.com"
        title="Libby"
        className="h-full w-full border-0"
        allow="autoplay; encrypted-media"
      />
      {(modal || error) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-6 backdrop-blur-sm"
          onClick={() => {
            setModal(null);
            setError(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-paper p-8 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {modal?.cover && (
              <img
                src={modal.cover}
                alt=""
                className="mx-auto mb-5 block w-36 rounded-lg object-cover shadow-lg"
                style={{ aspectRatio: "2 / 3" }}
              />
            )}
            <div className="font-display text-xl leading-snug tracking-tight">
              {error ? (
                "The download didn't finish"
              ) : (
                <>
                  {modal?.title ? <em>{modal.title}</em> : "Your loan"} is now
                  available in your Downloads
                </>
              )}
            </div>
            <div className="mt-2 text-xs text-ink-soft">
              {error
                ? error
                : "Open the Downloads tab to send it to your reader."}
            </div>
            <button
              onClick={() => {
                setModal(null);
                setError(null);
              }}
              className="mt-6 rounded-lg bg-ink px-6 py-2.5 text-sm font-semibold text-paper"
            >
              Keep Browsing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
