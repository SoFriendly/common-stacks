import { Routes, Route, Navigate } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { Library } from "./routes/Library";
import { Search } from "./routes/Search";
import { Downloads } from "./routes/Downloads";
import { Settings } from "./routes/Settings";
import { Browse } from "./routes/Browse";
import { Book } from "./routes/Book";

export default function App() {
  async function handleDragStart(e: React.MouseEvent) {
    if (e.button !== 0) return;
    try {
      await getCurrentWindow().startDragging();
    } catch {
      // ignore — non-Tauri environments (e.g. browser preview)
    }
  }

  return (
    <div className="relative flex h-full w-full bg-paper text-ink">
      {/* Full-width drag bar overlaying the top of the window. Uses both the
          declarative attribute (when WebKit honors it) and a programmatic
          mousedown handler so dragging is reliable across cold starts. */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragStart}
        className="fixed inset-x-0 top-0 z-50 h-10"
      />
      <Sidebar />
      <main className="flex-1 overflow-y-auto pt-10">
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<Library />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/book" element={<Book />} />
          <Route path="/search" element={<Search />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
