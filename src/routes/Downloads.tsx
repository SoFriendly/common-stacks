import { useEffect, useState } from "react";
import { api, type DownloadedFile } from "../lib/api";
import { openPath } from "@tauri-apps/plugin-opener";

type View = "grid" | "list";

export function Downloads() {
  const [files, setFiles] = useState<DownloadedFile[]>([]);
  const [view, setView] = useState<View>("grid");

  async function refresh() {
    setFiles(await api.listDownloads());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleOpen(path: string) {
    await openPath(path);
  }

  async function handleReveal(path: string) {
    await api.revealDownload(path);
  }

  async function handleDelete(path: string) {
    await api.deleteDownload(path);
    refresh();
  }

  async function handleRename(file: DownloadedFile) {
    const next = window.prompt("Rename to:", file.name);
    if (!next || next === file.name) return;
    await api.renameDownload(file.path, next);
    refresh();
  }

  return (
    <div className="px-10 pb-16">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Downloads</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Books saved to your CommonStacks folder.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView("grid")}
            className={`rounded px-3 py-1.5 text-sm ${
              view === "grid" ? "bg-ink text-paper" : "text-ink-soft"
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => setView("list")}
            className={`rounded px-3 py-1.5 text-sm ${
              view === "list" ? "bg-ink text-paper" : "text-ink-soft"
            }`}
          >
            List
          </button>
        </div>
      </header>

      {files.length === 0 ? (
        <p className="text-sm text-ink-soft">Nothing downloaded yet.</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-5 gap-y-8">
          {files.map((f) => (
            <div key={f.path} className="flex flex-col">
              <button
                onClick={() => handleOpen(f.path)}
                className="flex aspect-[2/3] items-center justify-center rounded-md bg-shelf p-3 text-center font-display text-sm text-ink-soft shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-lg"
              >
                {f.name}
              </button>
              <div className="mt-2 flex gap-2 text-[11px] text-ink-soft">
                <button onClick={() => handleReveal(f.path)} className="hover:text-ink">
                  Reveal
                </button>
                <button onClick={() => handleRename(f)} className="hover:text-ink">
                  Rename
                </button>
                <button onClick={() => handleDelete(f.path)} className="hover:text-ink">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-shelf text-left text-xs uppercase tracking-wider text-ink-soft">
            <tr>
              <th className="py-2">Name</th>
              <th className="py-2">Size</th>
              <th className="py-2">Modified</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.path} className="border-b border-shelf/50">
                <td className="py-2">
                  <button onClick={() => handleOpen(f.path)} className="hover:underline">
                    {f.name}
                  </button>
                </td>
                <td className="py-2 text-ink-soft">{formatSize(f.size)}</td>
                <td className="py-2 text-ink-soft">{formatDate(f.modified_ms)}</td>
                <td className="py-2 text-right text-xs">
                  <button onClick={() => handleReveal(f.path)} className="mr-2 text-ink-soft hover:text-ink">
                    Reveal
                  </button>
                  <button onClick={() => handleRename(f)} className="mr-2 text-ink-soft hover:text-ink">
                    Rename
                  </button>
                  <button onClick={() => handleDelete(f.path)} className="text-ink-soft hover:text-ink">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(ms: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}
