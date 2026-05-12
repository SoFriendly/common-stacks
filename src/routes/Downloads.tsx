import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  api,
  type DownloadedFile,
  type EpubMetadata,
  type SendTargetInfo,
} from "../lib/api";
import { openPath } from "@tauri-apps/plugin-opener";
import { DefaultCover } from "../components/DefaultCover";
import { MoreHorizontal } from "lucide-react";

function BackLink() {
  return (
    <Link
      to="/library"
      className="mb-4 inline-block text-xs text-ink-soft hover:text-ink"
    >
      ← Library
    </Link>
  );
}

type View = "grid" | "list";

interface FileWithMeta {
  file: DownloadedFile;
  meta?: EpubMetadata;
  inspecting: boolean;
}

export function Downloads() {
  const [items, setItems] = useState<FileWithMeta[]>([]);
  const [view, setView] = useState<View>("grid");
  const [sendTargets, setSendTargets] = useState<SendTargetInfo[]>([]);

  useEffect(() => {
    api.listSendTargets().then(setSendTargets);
  }, []);

  async function refresh() {
    const files = await api.listDownloads();
    setItems(files.map((file) => ({ file, inspecting: file.extension === "epub" })));
    // Inspect EPUBs in parallel; non-EPUBs stay as-is.
    files.forEach((file) => {
      if (file.extension !== "epub") return;
      api
        .inspectDownload(file.path)
        .then((meta) => {
          setItems((prev) =>
            prev.map((it) =>
              it.file.path === file.path ? { ...it, meta, inspecting: false } : it,
            ),
          );
        })
        .catch(() => {
          setItems((prev) =>
            prev.map((it) =>
              it.file.path === file.path ? { ...it, inspecting: false } : it,
            ),
          );
        });
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleOpen(path: string) {
    try {
      await openPath(path);
    } catch (e) {
      window.alert(`Open failed: ${e}`);
    }
  }
  async function handleReveal(path: string) {
    try {
      await api.revealDownload(path);
    } catch (e) {
      window.alert(`Reveal failed: ${e}`);
    }
  }
  async function handleDelete(path: string) {
    if (!window.confirm("Delete this file?")) return;
    try {
      await api.deleteDownload(path);
    } catch (e) {
      window.alert(`Delete failed: ${e}`);
      return;
    }
    refresh();
  }
  async function handleRename(file: DownloadedFile) {
    const next = window.prompt("Rename to:", file.name);
    if (!next || next === file.name) return;
    try {
      await api.renameDownload(file.path, next);
    } catch (e) {
      window.alert(`Rename failed: ${e}`);
      return;
    }
    refresh();
  }

  async function handleSend(file: FileWithMeta, target: SendTargetInfo) {
    if (!target.configured) {
      if (window.confirm(`${target.descriptor.name} isn't configured. Open Settings now?`)) {
        window.location.assign("/settings");
      }
      return;
    }
    try {
      const r = await api.sendBook({
        target_id: target.descriptor.id,
        file_path: file.file.path,
        title: file.meta?.title,
        author: file.meta?.authors[0],
      });
      if (r.ok) window.alert(r.message);
      else window.alert(`Send failed: ${r.message}`);
    } catch (e) {
      window.alert(`Send failed: ${e}`);
    }
  }

  return (
    <div className="px-10 pb-16">
      <BackLink />
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

      {items.length === 0 ? (
        <p className="text-sm text-ink-soft">Nothing downloaded yet.</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-5 gap-y-10">
          {items.map((it) => (
            <DownloadGridCard
              key={it.file.path}
              item={it}
              sendTargets={sendTargets}
              onOpen={() => handleOpen(it.file.path)}
              onReveal={() => handleReveal(it.file.path)}
              onRename={() => handleRename(it.file)}
              onDelete={() => handleDelete(it.file.path)}
              onSend={(target) => handleSend(it, target)}
            />
          ))}
        </div>
      ) : (
        <DownloadList
          items={items}
          onOpen={handleOpen}
          onReveal={handleReveal}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

function DownloadGridCard({
  item,
  sendTargets,
  onOpen,
  onReveal,
  onRename,
  onDelete,
  onSend,
}: {
  item: FileWithMeta;
  sendTargets: SendTargetInfo[];
  onOpen: () => void;
  onReveal: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSend: (target: SendTargetInfo) => void;
}) {
  const { file, meta } = item;
  const displayTitle = meta?.title ?? stripExt(file.name);
  const author = meta?.authors[0];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  function withClose(fn: () => void) {
    return () => {
      setMenuOpen(false);
      fn();
    };
  }

  return (
    <div className="group/card flex flex-col">
      <div className="relative">
        <button
          onClick={onOpen}
          className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-shelf shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-lg"
        >
          {meta?.cover_data_url ? (
            <img
              src={meta.cover_data_url}
              alt={displayTitle}
              className="h-full w-full object-cover"
            />
          ) : (
            <DefaultCover
              title={displayTitle}
              author={author}
              className="h-full w-full"
            />
          )}
          {item.inspecting && (
            <div className="absolute inset-0 flex items-end p-2">
              <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-white">
                reading…
              </span>
            </div>
          )}
        </button>

        <div ref={menuRef} className="absolute top-2 right-2 z-20">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="More actions"
            className={`flex h-7 w-7 items-center justify-center rounded-md bg-paper/90 text-ink shadow-sm ring-1 ring-black/10 backdrop-blur transition-opacity ${
              menuOpen
                ? "opacity-100"
                : "opacity-0 group-hover/card:opacity-100 focus:opacity-100"
            }`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-md border border-shelf bg-paper shadow-lg ring-1 ring-black/10"
              onClick={(e) => e.stopPropagation()}
            >
              {sendTargets.map((t) => (
                <MenuItem
                  key={t.descriptor.id}
                  onClick={withClose(() => onSend(t))}
                >
                  Send to {t.descriptor.name.replace(/^Send to /, "")}
                  {!t.configured && (
                    <span className="ml-1 text-[10px] text-ink-soft">(setup)</span>
                  )}
                </MenuItem>
              ))}
              {sendTargets.length > 0 && (
                <div className="my-1 border-t border-shelf" />
              )}
              <MenuItem onClick={withClose(onReveal)}>Reveal in Finder</MenuItem>
              <MenuItem onClick={withClose(onRename)}>Rename…</MenuItem>
              <MenuItem onClick={withClose(onDelete)} danger>
                Delete
              </MenuItem>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 line-clamp-2 font-display text-sm leading-snug text-ink">
        {displayTitle}
      </div>
      {author && (
        <div className="line-clamp-1 text-xs text-ink-soft">{author}</div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      role="menuitem"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-shelf ${
        danger ? "text-red-700" : "text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function DownloadList({
  items,
  onOpen,
  onReveal,
  onRename,
  onDelete,
}: {
  items: FileWithMeta[];
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
  onRename: (file: DownloadedFile) => void;
  onDelete: (path: string) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-shelf text-left text-xs uppercase tracking-wider text-ink-soft">
        <tr>
          <th className="py-2">Title</th>
          <th className="py-2">Author</th>
          <th className="py-2">Size</th>
          <th className="py-2">Modified</th>
          <th className="py-2"></th>
        </tr>
      </thead>
      <tbody>
        {items.map(({ file, meta }) => (
          <tr key={file.path} className="border-b border-shelf/50">
            <td className="py-2">
              <button onClick={() => onOpen(file.path)} className="hover:underline">
                {meta?.title ?? stripExt(file.name)}
              </button>
            </td>
            <td className="py-2 text-ink-soft">{meta?.authors[0] ?? ""}</td>
            <td className="py-2 text-ink-soft">{formatSize(file.size)}</td>
            <td className="py-2 text-ink-soft">{formatDate(file.modified_ms)}</td>
            <td className="py-2 text-right text-xs">
              <button onClick={() => onReveal(file.path)} className="mr-2 text-ink-soft hover:text-ink">
                Reveal
              </button>
              <button onClick={() => onRename(file)} className="mr-2 text-ink-soft hover:text-ink">
                Rename
              </button>
              <button onClick={() => onDelete(file.path)} className="text-ink-soft hover:text-ink">
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
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
