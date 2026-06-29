import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  api,
  type DownloadedFile,
  type EpubMetadata,
  type SendTargetInfo,
} from "../lib/api";
import { DefaultCover } from "../components/DefaultCover";
import { MoreHorizontal, Settings as SettingsIcon } from "lucide-react";
import { ViewToggle } from "../components/ViewToggle";
import { useIsMobile, revealLabel } from "../lib/platform";
import { FormatFilter } from "../components/FormatFilter";
import { useFormatFilter } from "../lib/formatFilter";
import { NavLink, useNavigate } from "react-router";
import {
  SendProgressModal,
  type SendModalState,
} from "../components/SendProgressModal";
import { EmptyState } from "../components/EmptyState";
import { tap } from "../lib/haptics";

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
  const [sendModal, setSendModal] = useState<SendModalState | null>(null);
  const [formatFilter] = useFormatFilter();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const effectiveView = isMobile ? "grid" : view;

  const filteredItems = items.filter((it) => {
    if (formatFilter === "all") return true;
    const isAudio = badgeForExtension(it.file.extension) === "Audiobook";
    return formatFilter === "audiobooks" ? isAudio : !isAudio;
  });

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
      await api.openDownload(path);
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
    const needsSetup =
      target.schema.some((f) => f.required) && !target.configured;
    if (needsSetup) {
      if (
        window.confirm(`${target.descriptor.name} isn't configured. Open Settings now?`)
      ) {
        window.location.assign("/settings");
      }
      return;
    }
    const title = file.meta?.title ?? stripExt(file.file.name);
    setSendModal({ kind: "sending", target, title, steps: [] });
    try {
      const r = await api.sendBook(
        {
          target_id: target.descriptor.id,
          file_path: file.file.path,
          title: file.meta?.title,
          author: file.meta?.authors[0],
        },
        (p) => {
          setSendModal((prev) => {
            if (!prev) return prev;
            const steps = [...prev.steps];
            const last = steps[steps.length - 1];
            // Collapse consecutive events in the same stage so the per-image
            // loop replaces one line in place instead of spamming the list.
            if (last && last.stage === p.stage) {
              steps[steps.length - 1] = p;
            } else {
              steps.push(p);
            }
            return { ...prev, steps };
          });
        },
      );
      setSendModal((prev) => {
        const steps = prev?.steps ?? [];
        if (r.ok) {
          return { kind: "done", target, title, message: r.message, steps };
        }
        return {
          kind: "error",
          target,
          title,
          message: friendlyError(r.message, target.descriptor.id),
          steps,
        };
      });
    } catch (e) {
      setSendModal((prev) => ({
        kind: "error",
        target,
        title,
        message: friendlyError(String(e), target.descriptor.id),
        steps: prev?.steps ?? [],
      }));
    }
  }

  return (
    <div className={isMobile ? "px-4 pt-4 pb-4" : "px-6 pb-16"}>
      <SendProgressModal state={sendModal} onClose={() => setSendModal(null)} />
      {!isMobile && (
        <header className="mb-6 flex items-center justify-between gap-6">
          <div className="flex items-center gap-1">
            <ViewToggle />
            <FormatFilter />
          </div>
          <div className="flex items-center gap-2">
            <div className="mr-2 flex overflow-hidden rounded-md bg-shelf/60 p-0.5 text-sm">
              <button
                onClick={() => setView("grid")}
                className={`rounded px-3 py-1 ${
                  view === "grid" ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
                }`}
              >
                Grid
              </button>
              <button
                onClick={() => setView("list")}
                className={`rounded px-3 py-1 ${
                  view === "list" ? "bg-paper text-ink shadow-sm" : "text-ink-soft"
                }`}
              >
                List
              </button>
            </div>
            <NavLink
              to="/settings"
              aria-label="Settings"
              title="Settings"
              className="flex h-9 w-9 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-shelf hover:text-ink"
            >
              <SettingsIcon className="h-4 w-4" />
            </NavLink>
          </div>
        </header>
      )}

      {isMobile && filteredItems.length > 0 && (
        <div className="mb-4 px-1 text-sm text-ink-soft">
          {filteredItems.length} {filteredItems.length === 1 ? "download" : "downloads"}
        </div>
      )}

      {filteredItems.length === 0 ? (
        items.length === 0 ? (
          <EmptyState
            title="No books here yet"
            description={
              <>
                Downloaded books land in your Common Stacks folder. Browse a
                library, open a book, and pick a format to start your shelf.
              </>
            }
            primary={{ label: "Browse the library", onClick: () => navigate("/library") }}
          />
        ) : (
          <p className="text-sm text-ink-soft">
            No {formatFilter === "audiobooks" ? "audiobooks" : "books"} in your
            downloads.
          </p>
        )
      ) : effectiveView === "grid" ? (
        <div
          className={
            isMobile
              ? "grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-7"
              : "grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-5 gap-y-10"
          }
        >
          {filteredItems.map((it) => (
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
          items={filteredItems}
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
  const badge = badgeForExtension(file.extension);
  const isAudiobook = badge === "Audiobook";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const longPressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  useEffect(() => {
    if (!menuOpen || isMobile) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [isMobile, menuOpen]);

  function withClose(fn: () => void) {
    return () => {
      setMenuOpen(false);
      fn();
    };
  }

  function startLongPress() {
    if (!isMobile) return;
    longPressed.current = false;
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      tap(18);
      setMenuOpen(true);
    }, 450);
  }

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  return (
    <div className="group/card flex flex-col">
      <div
        className="relative"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        <button
          onPointerDown={startLongPress}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onPointerLeave={clearLongPress}
          onClick={() => {
            if (longPressed.current) {
              longPressed.current = false;
              return;
            }
            onOpen();
          }}
          className={`relative w-full overflow-hidden rounded-lg bg-shelf shadow-sm ring-1 ring-black/5 transition duration-150 hover:shadow-lg active:scale-[0.99] ${
            isAudiobook ? "aspect-square" : "aspect-[2/3]"
          }`}
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
          {badge && (
            <span className="absolute top-1.5 left-1.5 rounded-full bg-ink/85 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-paper backdrop-blur-sm">
              {badge}
            </span>
          )}
        </button>

        <div ref={menuRef} className="absolute top-2 right-2 z-20">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              tap(8);
              setMenuOpen((v) => !v);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="More actions"
            className={`flex items-center justify-center bg-paper/90 text-ink shadow-sm ring-1 ring-black/10 backdrop-blur transition-opacity ${
              isMobile
                ? "h-9 w-9 rounded-full opacity-100"
                : menuOpen
                ? "opacity-100"
                : "opacity-0 group-hover/card:opacity-100 focus:opacity-100"
            }`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && isMobile && (
            <MobileActionSheet
              title={displayTitle}
              isAudiobook={isAudiobook}
              sendTargets={sendTargets}
              onClose={() => setMenuOpen(false)}
              onOpen={withClose(onOpen)}
              onRename={withClose(onRename)}
              onDelete={withClose(onDelete)}
              onSend={(target) => withClose(() => onSend(target))()}
            />
          )}
          {menuOpen && !isMobile && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-md border border-shelf bg-paper shadow-lg ring-1 ring-black/10"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Send-to targets only show for non-audiobook files. Every
                  current target (Kindle, Crosspoint, WebDAV) is e-reader /
                  document-oriented; sending an m4b to a Kindle is just
                  going to waste the user's time. */}
              {!isAudiobook &&
                sendTargets
                  .filter((t) => {
                    if (!t.enabled) return false;
                    const needsSetup =
                      t.schema.some((f) => f.required) && !t.configured;
                    return !needsSetup;
                  })
                  .map((t) => (
                    <MenuItem
                      key={t.descriptor.id}
                      onClick={withClose(() => onSend(t))}
                    >
                      Send to {t.descriptor.name.replace(/^Send to /, "")}
                    </MenuItem>
                  ))}
              {!isAudiobook &&
                sendTargets.some(
                  (t) =>
                    t.enabled &&
                    !(t.schema.some((f) => f.required) && !t.configured),
                ) && <div className="my-1 border-t border-shelf" />}
              <MenuItem onClick={withClose(onReveal)}>{revealLabel}</MenuItem>
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

function MobileActionSheet({
  title,
  isAudiobook,
  sendTargets,
  onClose,
  onOpen,
  onRename,
  onDelete,
  onSend,
}: {
  title: string;
  isAudiobook: boolean;
  sendTargets: SendTargetInfo[];
  onClose: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onSend: (target: SendTargetInfo) => void;
}) {
  const availableTargets = sendTargets.filter((t) => {
    if (!t.enabled) return false;
    const needsSetup = t.schema.some((f) => f.required) && !t.configured;
    return !needsSetup;
  });

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/25"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Download actions"
        className="max-h-[calc(100dvh-5rem)] w-[min(100vw,36rem)] overflow-y-auto rounded-t-3xl bg-paper px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-spine/70" />
        <div className="mb-3 line-clamp-2 px-1 font-display text-lg leading-tight text-ink min-[560px]:text-xl">
          {title}
        </div>
        <div className="overflow-hidden rounded-2xl border border-shelf bg-white/55">
          <MenuItem onClick={onOpen}>Open</MenuItem>
          {!isAudiobook &&
            availableTargets.map((target) => (
              <MenuItem
                key={target.descriptor.id}
                onClick={() => onSend(target)}
              >
                Send to {target.descriptor.name.replace(/^Send to /, "")}
              </MenuItem>
            ))}
          <MenuItem onClick={onRename}>Rename...</MenuItem>
          <MenuItem onClick={onDelete} danger>
            Delete
          </MenuItem>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl bg-shelf text-base font-medium text-ink active:bg-spine/40"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
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
      className={`block min-h-11 w-full px-3 py-2 text-left text-sm transition-colors hover:bg-shelf active:bg-shelf ${
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

function friendlyError(raw: string, targetId?: string): string {
  const cleaned = raw
    .replace(/error sending request for url \([^)]*\)\.?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const looksLikeConnectivity =
    /Could not reach|error sending request|connection refused|connect timed out|dns error|no such host/i.test(
      raw,
    );
  if (targetId === "crosspoint" && looksLikeConnectivity) {
    return "Couldn't reach the Crosspoint Reader. Make sure you navigate to File Transfer → Join a Network on your Crosspoint device, and that it's on the same Wi-Fi network as this computer.";
  }
  if (targetId === "crosspoint" && /sd card/i.test(raw)) {
    return `${cleaned} — make sure the destination folder exists on the Crosspoint's SD card (you can change it in Settings → Send-to targets).`;
  }
  return cleaned || raw;
}

const AUDIO_EXTS = new Set(["m4b", "mp3", "m4a", "aac", "opus", "ogg", "flac", "wav"]);

function badgeForExtension(ext: string | undefined | null): string | null {
  if (!ext) return null;
  const e = ext.toLowerCase();
  if (AUDIO_EXTS.has(e)) return "Audiobook";
  if (e === "pdf") return "PDF";
  if (e === "cbz" || e === "cbr") return "Comic";
  // EPUB and unknown formats render without a badge (epub is the default
  // assumption; unknown is noise).
  return null;
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
