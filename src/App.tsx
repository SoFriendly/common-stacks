import { Routes, Route, Navigate } from "react-router";
import { Sidebar } from "./components/Sidebar";
import { Library } from "./routes/Library";
import { Search } from "./routes/Search";
import { Downloads } from "./routes/Downloads";
import { Settings } from "./routes/Settings";
import { Browse } from "./routes/Browse";
import { Book } from "./routes/Book";

export default function App() {
  return (
    <div className="relative flex h-full w-full bg-paper text-ink">
      {/* Native macOS drag region — Tauri's WebView intercepts mousedown on
          this attribute. Keep it as `absolute` (not `fixed`) and plain — a
          JS mousedown handler here will fight the native intercept. */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-40 h-10" />
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
