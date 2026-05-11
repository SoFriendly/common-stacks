import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./styles.css";

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
// dragging used to fail roughly half the time.
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
// Safety net: if for any reason the rAF chain doesn't run, still show
// the window after a short delay so we never end up invisible forever.
setTimeout(revealWindow, 500);
