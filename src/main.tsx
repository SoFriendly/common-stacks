import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./styles.css";
import { ensureLoaded as ensureEnrichmentLoaded } from "./lib/enrichment";
import { isMobile } from "./lib/platform";

// Kick off the persistent enrichment cache load in parallel with React mount.
// `get()` returns localStorage-only data synchronously until the disk read
// completes; the disk file is canonical and overrides anything older.
void ensureEnrichmentLoaded();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// Reveal the window only after the React tree has been wired up — including
// Tauri's drag-region attribute. Showing the window before the listeners are
// registered causes the first cold-launch mousedown to be lost, which is why
// dragging used to fail roughly half the time. Mobile WebViews are already
// visible and the window.show permission isn't granted there.
async function revealWindow() {
  if (isMobile) return;
  try {
    const w = getCurrentWindow();
    await w.show();
    await w.setFocus();
  } catch (err) {
    console.error("revealWindow failed", err);
  }
}
if (!isMobile) {
  requestAnimationFrame(() => {
    requestAnimationFrame(revealWindow);
  });
  setTimeout(revealWindow, 500);
}
