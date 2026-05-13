import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { api, type Acquisition, type Entry, type EnrichedMetadata } from "../lib/api";
import { DefaultCover } from "../components/DefaultCover";
import { set as cacheEnrichment, applyToEntry, get as getCachedEnrichment, ensureLoaded as ensureEnrichmentLoaded } from "../lib/enrichment";
import { classifyAcquisition, entryFormats, formatLabel as formatKindLabel } from "../lib/format";

/** State passed via navigation when clicking a cover. */
export interface BookNavState {
  sourceId: string;
  sourceName?: string;
  entry: Entry;
  /** Optional: alternate sources for merged search results. */
  alternateSources?: { source_id: string; source_name: string; entry_id: string }[];
}

type DownloadState =
  | { kind: "idle" }
  | { kind: "downloading"; href: string }
  | { kind: "done"; href: string; path: string }
  | { kind: "error"; href: string; message: string };

const FORMAT_RANK: Record<string, number> = {
  epub: 0,
  azw3: 1,
  mobi: 2,
  pdf: 3,
  cbz: 4,
  cbr: 5,
  txt: 6,
};

const MIME_LABEL: Record<string, string> = {
  "application/epub+zip": "EPUB",
  "application/pdf": "PDF",
  "application/x-mobipocket-ebook": "MOBI",
  "application/vnd.amazon.ebook": "AZW3",
  "application/x-cbz": "CBZ",
  "application/vnd.comicbook+zip": "CBZ",
  "application/x-cbr": "CBR",
  "application/vnd.comicbook-rar": "CBR",
  "text/plain": "TXT",
  "application/zip": "ZIP",
};

function formatLabel(a: Acquisition): string {
  const kind = classifyAcquisition(a);
  if (kind === "audiobook") return "Audiobook";
  if (kind === "comic") return "Comic";
  if (a.mime && MIME_LABEL[a.mime.split(";")[0].trim()]) {
    return MIME_LABEL[a.mime.split(";")[0].trim()];
  }
  const ext = extFromHref(a.href);
  if (ext) return ext.toUpperCase();
  return "Download";
}

function extFromHref(href: string): string | null {
  const clean = href.split(/[?#]/)[0];
  const last = clean.split("/").pop() ?? "";
  const m = last.match(/\.([A-Za-z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : null;
}

function rankAcquisition(a: Acquisition): number {
  const kind = classifyAcquisition(a);
  if (kind === "audiobook") return 1; // surface near the top alongside epub
  const ext = extFromHref(a.href);
  const fromMime = a.mime?.includes("epub")
    ? 0
    : a.mime?.includes("pdf")
      ? 3
      : a.mime?.includes("mobi")
        ? 2
        : a.mime?.includes("amazon")
          ? 1
          : undefined;
  if (fromMime !== undefined) return fromMime;
  if (ext && FORMAT_RANK[ext] !== undefined) return FORMAT_RANK[ext];
  return 99;
}

export function Book() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as BookNavState | null;

  // If accessed without state, just bail home.
  useEffect(() => {
    if (!state) navigate("/library", { replace: true });
  }, [state, navigate]);

  const [entry, setEntry] = useState<Entry | null>(state?.entry ?? null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState>({ kind: "idle" });
  const [enrichment, setEnrichment] = useState<EnrichedMetadata | null>(null);

  // If the entry has no acquisitions but has a subsection link, follow it
  // to resolve the detail catalog (e.g. Gutenberg's per-book OPDS doc).
  useEffect(() => {
    if (!state || !entry) return;
    if (entry.acquisitions.length > 0) return;
    const detail = entry.navigation.find(
      (l) =>
        l.rel === "subsection" ||
        (l.mime ?? "").includes("opds-catalog"),
    );
    if (!detail) return;
    let cancelled = false;
    setResolving(true);
    setResolveError(null);
    (async () => {
      try {
        const r = await api.fetchFeed(state.sourceId, detail.href);
        if (cancelled) return;
        // The book's detail feed usually has a single entry — itself.
        const found = r.feed.entries[0];
        if (found) {
          setEntry((prev) => mergeEntry(prev!, found));
        } else if (r.feed.navigation.length > 0) {
          setResolveError("No downloads found for this book.");
        }
      } catch (e) {
        if (!cancelled) setResolveError(String(e));
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, entry]);

  // Auto-enrich metadata in the background. Runs once per book mount, but
  // short-circuits if we already have cached enrichment for this book —
  // avoids hitting Open Library every visit, which can be slow.
  useEffect(() => {
    if (!state) return;
    const initial = state.entry;
    const isbn = pickIsbn(initial);
    const title = initial.title;
    if (!isbn && !title) return;
    let cancelled = false;
    (async () => {
      // Make sure the disk-backed cache is hydrated before the cache lookup.
      await ensureEnrichmentLoaded();
      if (cancelled) return;
      // If we've enriched this book before, apply directly and skip the
      // network round-trip entirely.
      const cached = getCachedEnrichment(initial);
      if (cached) {
        setEnrichment(cached);
        setEntry((prev) => (prev ? applyToEntry(prev, cached) : prev));
        return;
      }
      try {
        const enrichers = await api.listEnrichers();
        for (const e of enrichers) {
          const result = await api.enrichBook(e.id, {
            isbn: isbn ?? undefined,
            title,
            authors: initial.authors,
          });
          if (cancelled) return;
          if (result) {
            setEnrichment(result);
            setEntry((prev) => {
              if (!prev) return prev;
              cacheEnrichment(prev, result);
              return applyToEntry(prev, result);
            });
            return; // first usable result wins
          }
        }
      } catch {
        // silent — enrichment is best-effort.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.entry.id, state?.sourceId]);

  const acquisitions = useMemo(() => {
    if (!entry) return [];
    const seen = new Set<string>();
    const out: Acquisition[] = [];
    for (const a of entry.acquisitions) {
      const key = a.href;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    out.sort((a, b) => rankAcquisition(a) - rankAcquisition(b));
    return out;
  }, [entry]);

  // All hooks must run unconditionally — keep these above the early return.
  const cover = entry?.cover ?? entry?.thumbnail;
  type CoverLoadState = "loading" | "real" | "failed";
  const [coverState, setCoverState] = useState<CoverLoadState>(
    cover ? "loading" : "failed",
  );
  useEffect(() => {
    setCoverState(cover ? "loading" : "failed");
  }, [cover]);

  if (!state || !entry) return null;

  async function handleDownload(a: Acquisition) {
    setDownloadState({ kind: "downloading", href: a.href });
    try {
      const r = await api.downloadBook({
        source_id: state!.sourceId,
        title: entry!.title,
        author: entry!.authors[0],
        href: a.href,
        mime: a.mime,
      });
      setDownloadState({ kind: "done", href: a.href, path: r.path });
    } catch (e) {
      setDownloadState({
        kind: "error",
        href: a.href,
        message: friendlyDownloadError(String(e)),
      });
    }
  }

  function friendlyDownloadError(raw: string): string {
    // Match a Mayberry branch peer URL like
    // https://ivory-elm.branch.pub/download/... so we can name the
    // offline branch in the error.
    const branchMatch = raw.match(/https?:\/\/([a-z0-9-]+)\.branch\.pub\//i);
    const status5xx = /\b5\d\d\b/.test(raw);
    if (branchMatch && status5xx) {
      const name = branchSlugToName(branchMatch[1]);
      return `${name} is out for lunch at the moment. Try again in a few minutes.`;
    }
    // Generic 5xx from another host.
    if (status5xx) {
      return "The library's server is having a moment. Try again shortly.";
    }
    // Strip noisy reqwest envelope ("error sending request for url (...)").
    return raw
      .replace(/error sending request for url \([^)]*\)\.?\s*/i, "")
      .replace(/HTTP status server error \(([^)]+)\) for url \([^)]*\)/i, "$1")
      .trim();
  }

  function branchSlugToName(slug: string): string {
    return slug
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  function viewInDownloads() {
    navigate("/downloads");
  }

  return (
    <div className="mx-auto max-w-5xl px-10 pb-20">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 text-xs text-ink-soft hover:text-ink"
      >
        ← Back
      </button>

      <div className="flex flex-col gap-10 md:flex-row">
        <div className="shrink-0">
          <div
            className={`relative w-56 overflow-hidden rounded-md bg-shelf shadow-lg ring-1 ring-black/5 ${
              entryFormats(entry).includes("audiobook")
                ? "aspect-square"
                : "aspect-[2/3]"
            }`}
          >
            <DefaultCover
              title={entry.title}
              author={entry.authors[0]}
              className="absolute inset-0 h-full w-full"
            />
            {cover && coverState !== "failed" && (
              <img
                src={cover}
                alt={entry.title}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
                  coverState === "real" ? "opacity-100" : "opacity-0"
                }`}
                ref={(el) => {
                  // If the browser already had this image cached (e.g. from
                  // the Library view), `complete` is true before React
                  // attaches onLoad — leaving us stuck at "loading".
                  if (el && el.complete && el.naturalWidth > 0) {
                    setCoverState(el.naturalWidth < 96 ? "failed" : "real");
                  }
                }}
                onLoad={(e) => {
                  const w = e.currentTarget.naturalWidth;
                  setCoverState(w > 0 && w < 96 ? "failed" : "real");
                }}
                onError={() => setCoverState("failed")}
              />
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl leading-tight tracking-tight text-ink">
            {entry.title}
          </h1>
          {entry.authors.length > 0 && (
            <div className="mt-2 font-display text-lg text-ink-soft">
              {entry.authors.join(", ")}
            </div>
          )}

          {entryFormats(entry).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {entryFormats(entry).map((f) => {
                const isAudio = f === "audiobook";
                return (
                  <span
                    key={f}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${
                      isAudio
                        ? "bg-ink text-paper"
                        : "border border-shelf bg-paper text-ink-soft"
                    }`}
                  >
                    {formatKindLabel(f)}
                  </span>
                );
              })}
            </div>
          )}

          <div className="mt-3 text-xs text-ink-soft">
            {state.sourceName ?? state.sourceId}
            {state.alternateSources && state.alternateSources.length > 1 && (
              <> · available from {state.alternateSources.length} libraries</>
            )}
          </div>

          {entry.categories.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {dedupCategories(entry.categories).slice(0, 12).map((c, i) => (
                <span
                  key={i}
                  className="rounded-full bg-shelf px-2.5 py-0.5 text-xs text-ink-soft"
                >
                  {c}
                </span>
              ))}
            </div>
          )}

          <div className="mt-8">
            <h2 className="mb-3 font-display text-lg">Download</h2>
            {resolving && (
              <p className="text-sm text-ink-soft">Resolving downloads…</p>
            )}
            {resolveError && !resolving && (
              <p className="text-sm text-red-700">{resolveError}</p>
            )}
            {!resolving && acquisitions.length === 0 && !resolveError && (
              <p className="text-sm text-ink-soft">No downloadable formats.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {acquisitions.map((a) => {
                const downloading =
                  downloadState.kind === "downloading" &&
                  downloadState.href === a.href;
                const done =
                  downloadState.kind === "done" && downloadState.href === a.href;
                const failed =
                  downloadState.kind === "error" && downloadState.href === a.href;
                return (
                  <div key={a.href} className="flex items-center gap-2">
                    {done ? (
                      <button
                        onClick={viewInDownloads}
                        className="rounded-md bg-ink px-4 py-2 text-sm text-paper"
                      >
                        View in Downloads
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDownload(a)}
                        disabled={downloading}
                        className="rounded-md bg-ink px-4 py-2 text-sm text-paper transition-opacity disabled:opacity-50"
                      >
                        {downloading ? "Downloading…" : `Download ${formatLabel(a)}`}
                      </button>
                    )}
                    {failed && (
                      <span className="text-xs text-red-700">
                        {(downloadState as { kind: "error"; message: string }).message}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {entry.summary && (
            <div className="mt-10">
              <h2 className="mb-2 font-display text-lg">About</h2>
              <p className="leading-relaxed text-ink-soft">{entry.summary}</p>
            </div>
          )}

          {enrichment && (
            <div className="mt-8 text-[11px] text-ink-soft">
              Enriched via {enrichment.source.replace(/^./, (c) => c.toUpperCase())}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function pickIsbn(e: Entry): string | null {
  const candidates = [e.id, ...e.identifiers];
  for (const c of candidates) {
    const cleaned = c.replace(/[-\s]/g, "");
    const m = cleaned.match(/(97[89]\d{10})/);
    if (m) return m[1];
  }
  return null;
}

function mergeEntry(prev: Entry, next: Entry): Entry {
  return {
    ...prev,
    summary: next.summary ?? prev.summary,
    language: next.language ?? prev.language,
    published: next.published ?? prev.published,
    updated: next.updated ?? prev.updated,
    cover: next.cover ?? prev.cover,
    thumbnail: next.thumbnail ?? prev.thumbnail,
    identifiers:
      next.identifiers.length > 0 ? next.identifiers : prev.identifiers,
    categories: dedupStr([...prev.categories, ...next.categories]),
    series: next.series ?? prev.series,
    acquisitions:
      next.acquisitions.length > 0 ? next.acquisitions : prev.acquisitions,
    navigation: next.navigation.length > 0 ? next.navigation : prev.navigation,
  };
}

function cleanCategory(raw: string): string {
  let s = raw.trim();
  // Mayberry sometimes wraps multi-word terms in literal double quotes.
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  // URL-decode if it looks percent-encoded.
  if (/%[0-9A-Fa-f]{2}/.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {
      // ignore
    }
  }
  // Collapse whitespace.
  s = s.replace(/\s+/g, " ");
  return s;
}

function dedupCategories(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const cleaned = cleanCategory(raw);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function dedupStr(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}
