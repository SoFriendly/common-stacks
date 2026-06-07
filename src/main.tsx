import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./styles.css";
import { ensureLoaded as ensureEnrichmentLoaded } from "./lib/enrichment";

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
// dragging used to fail roughly half the time. On mobile WebViews the window
// is already visible and `show()` rejects; the catch is the mobile-skip path —
// don't gate on CSS media queries here (touchscreen Windows devices match
// `pointer: coarse` and would stay hidden forever).
async function revealWindow() {
  try {
    const w = getCurrentWindow();
    await w.show();
    await w.setFocus();
  } catch (err) {
    console.error("revealWindow failed", err);
  }
}
requestAnimationFrame(() => {
  requestAnimationFrame(revealWindow);
});
setTimeout(revealWindow, 500);
