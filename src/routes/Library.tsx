import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, type Entry, type Link, type MergedBook, type SearchResult, type Source } from "../lib/api";
import { CoverCard } from "../components/CoverCard";
import { CategoryTile } from "../components/CategoryTile";
import { Rail } from "../components/Rail";
import { openEntry } from "../lib/entry";
import { maybeApply as applyEnrichmentToEntry } from "../lib/enrichment";
import { primaryBadge, formatLabel, isAudiobookEntry, hasBookFormat } from "../lib/format";
import {
  Search as SearchIcon,
  X,
  Settings as SettingsIcon,
  RefreshCw,
} from "lucide-react";
import { ViewToggle } from "../components/ViewToggle";
import { FormatFilter } from "../components/FormatFilter";
import { useFormatFilter } from "../lib/formatFilter";
import { EmptyState } from "../components/EmptyState";
import { useIsMobile } from "../lib/platform";
import { useMobileSearch } from "../lib/mobileSearch";
import { usePullToRefresh } from "../lib/pullToRefresh";

type RailContent =
  | { kind: "entries"; entries: Entry[] }
  | { kind: "categories"; links: Link[] };

interface RailData {
  key: string;
  title: string;
  href: string;
  content: RailContent | null;
  loading: boolean;
  error?: string;
}

interface SourceBlock {
  source: Source;
  rails: RailData[];
  loading: boolean;
  error?: string;
}

const MAX_RAILS_PER_SOURCE = 6;
const MAX_CATEGORIES_PER_RAIL = 24;

// Stale-while-revalidate window: tabbing back within this many ms reuses
// cached blocks instantly; longer than this triggers a background refresh.
const SWR_TTL_MS = 10 * 60 * 1000;

// Module-level cache so navigating between routes doesn't redo every OPDS
// fetch. Survives unmount/remount but is dropped on full app reload.
let cachedBlocks: SourceBlock[] | null = null;
let cachedAt = 0;

function pickSubsections(navigation: Link[]): Link[] {
  const skip = new Set([
    "self",
    "next",
    "previous",
    "prev",
    "up",
    "start",
    "search",
    "alternate",
    "first",
    "last",
    "shelf",
    "http://opds-spec.org/shelf",
    "http://opds-spec.org/facet",
    "http://opds-spec.org/featured",
  ]);
  return navigation.filter((l) => {
    const r = (l.rel ?? "").toLowerCase();
    return !skip.has(r) && !r.includes("opensearch");
  });
}

export function Library() {
  const [blocks, setBlocks] = useState<SourceBlock[]>(() => cachedBlocks ?? []);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const searchSeq = useRef(0);
  const navigate = useNavigate();
  const [formatFilter] = useFormatFilter();
  const isMobile = useIsMobile();
  const mobileSearch = useMobileSearch();

  function matchesFilter(e: Entry): boolean {
    if (formatFilter === "all") return true;
    if (formatFilter === "audiobooks") return isAudiobookEntry(e);
    return hasBookFormat(e);
  }

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearchResult(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const r = await api.search(trimmed);
      if (seq !== searchSeq.current) return;
      setSearchResult(r);
    } catch (e) {
      if (seq !== searchSeq.current) return;
      setSearchResult({ merged: [], errors: [{ source_id: "", source_name: "", message: String(e) }] });
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  function clearSearch() {
    searchSeq.current += 1;
    setQuery("");
    setSearchResult(null);
    setSearching(false);
  }

  const loadSeq = useRef(0);
  const [refreshing, setRefreshing] = useState(false);

  function loadLibrary() {
    const seq = ++loadSeq.current;
    setRefreshing(true);
    let cancelled = false;
    (async () => {
      const allSources = await api.listSources();
      const sources = allSources.filter((s) => s.enabled);
      if (cancelled || seq !== loadSeq.current) return;
      setBlocks(sources.map((source) => ({ source, rails: [], loading: true })));
      await Promise.all(sources.map((s) => hydrate(s)));
      if (seq === loadSeq.current) {
        setRefreshing(false);
        // Capture the now-populated blocks for the in-memory cache.
        setBlocks((current) => {
          cachedBlocks = current;
          cachedAt = Date.now();
          return current;
        });
      }

      async function hydrate(source: Source) {
        try {
          const { feed } = await api.fetchFeed(source.id);

          // Case A: root has books — one rail.
          if (feed.entries.length > 0) {
            if (cancelled) return;
            setBlocks((prev) =>
              prev.map((b) =>
                b.source.id === source.id
                  ? {
                      ...b,
                      loading: false,
                      rails: [
                        {
                          key: `${source.id}:root`,
                          title: feed.title || source.name,
                          href: source.url,
                          content: { kind: "entries", entries: feed.entries },
                          loading: false,
                        },
                      ],
                    }
                  : b,
              ),
            );
            return;
          }

          // Case B: root is nav-only — fan out into top subsections.
          const subs = pickSubsections(feed.navigation).slice(0, MAX_RAILS_PER_SOURCE);
          if (subs.length === 0) {
            if (cancelled) return;
            setBlocks((prev) =>
              prev.map((b) =>
                b.source.id === source.id
                  ? { ...b, loading: false, rails: [] }
                  : b,
              ),
            );
            return;
          }

          if (cancelled) return;
          setBlocks((prev) =>
            prev.map((b) =>
              b.source.id === source.id
                ? {
                    ...b,
                    loading: false,
                    rails: subs.map((s, i) => ({
                      key: `${source.id}:${i}`,
                      title: prettyTitle(s.title) || prettyFromHref(s.href),
                      href: s.href,
                      content: null,
                      loading: true,
                    })),
                  }
                : b,
            ),
          );

          await Promise.all(
            subs.map(async (sub, i) => {
              try {
                const { feed: sf } = await api.fetchFeed(source.id, sub.href);
                const content: RailContent =
                  sf.entries.length > 0
                    ? { kind: "entries", entries: sf.entries }
                    : {
                        kind: "categories",
                        links: pickSubsections(sf.navigation).slice(
                          0,
                          MAX_CATEGORIES_PER_RAIL,
                        ),
                      };
                if (cancelled) return;
                setBlocks((prev) =>
                  prev.map((b) =>
                    b.source.id === source.id
                      ? {
                          ...b,
                          rails: b.rails.map((r, j) =>
                            j === i ? { ...r, content, loading: false } : r,
                          ),
                        }
                      : b,
                  ),
                );
              } catch (e) {
                if (cancelled) return;
                setBlocks((prev) =>
                  prev.map((b) =>
                    b.source.id === source.id
                      ? {
                          ...b,
                          rails: b.rails.map((r, j) =>
                            j === i
                              ? { ...r, loading: false, error: String(e) }
                              : r,
                          ),
                        }
                      : b,
                  ),
                );
              }
            }),
          );
        } catch (e) {
          if (cancelled) return;
          setBlocks((prev) =>
            prev.map((b) =>
              b.source.id === source.id
                ? { ...b, loading: false, error: String(e) }
                : b,
            ),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    if (cachedBlocks && Date.now() - cachedAt < SWR_TTL_MS) {
      // Cache is warm — show it instantly, no fetch.
      return;
    }
    if (cachedBlocks) {
      // We already have something to render; refresh in background.
    }
    loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bridge the mobile header's search bar into Library's existing search flow.
  useEffect(() => {
    if (!isMobile) return;
    if (mobileSearch.submittedQuery) {
      setQuery(mobileSearch.submittedQuery);
      runSearch(mobileSearch.submittedQuery);
    } else {
      clearSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, mobileSearch.submittedQuery]);

  usePullToRefresh(loadLibrary);

  function browse(sourceId: string, href: string, title: string) {
    const params = new URLSearchParams({ source: sourceId, href, title });
    navigate(`/browse?${params.toString()}`);
  }

  const showingSearch = searchResult !== null || searching;

  return (
    <div className={isMobile ? "px-3 pb-16" : "px-6 pb-16"}>
      {isMobile ? null : (
        <header className="mb-8 flex items-center justify-between gap-6">
          <div className="flex items-center gap-1">
            <ViewToggle />
            <FormatFilter />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(query);
            }}
            className="relative w-full max-w-md flex-1"
          >
            <SearchIcon className="pointer-events-none absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <input
              value={query}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setQuery(v);
                if (v.trim() === "") clearSearch();
              }}
              placeholder="Search titles, authors, ISBNs…"
              className="w-full border-0 border-b border-shelf bg-transparent py-2 pr-9 pl-7 font-display text-base text-ink placeholder:text-ink-soft/70 focus:border-spine focus:outline-none focus:ring-0"
            />
            {(query || searchResult) && (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-ink-soft hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </form>
          <div className="flex items-center gap-1">
            <button
              onClick={loadLibrary}
              disabled={refreshing}
              aria-label="Refresh libraries"
              title="Refresh"
              className="flex h-9 w-9 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-shelf hover:text-ink disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <IconLink to="/settings" label="Settings">
              <SettingsIcon className="h-4 w-4" />
            </IconLink>
          </div>
        </header>
      )}

      {showingSearch ? (
        <SearchResultsView
          query={query}
          searching={searching}
          result={searchResult}
          filter={matchesFilter}
          onOpen={(book) => openMergedBook(navigate, book)}
        />
      ) : (
        <>
          {blocks.length === 0 && (
            <EmptyState
              title="Your shelves are empty"
              description={
                <>
                  Add an OPDS library in Settings and you'll see books here.
                  Mayberry and Project Gutenberg ship pre-configured if you'd
                  like to start there.
                </>
              }
              primary={{
                label: "Open Settings",
                onClick: () => navigate("/settings"),
              }}
            />
          )}
          {blocks.map((b) => (
        <section key={b.source.id} className="mb-12">
          <div className="mb-4 flex items-baseline gap-3 border-b border-shelf pb-2">
            <h2 className="font-display text-2xl tracking-tight">{b.source.name}</h2>
            {b.error && (
              <span className="text-xs text-ink-soft">offline — connection issue</span>
            )}
          </div>

          {b.loading && (
            <Rail title="Loading…">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[2/3] w-36 shrink-0 animate-pulse rounded-md bg-shelf"
                />
              ))}
            </Rail>
          )}

          {!b.loading && b.rails.length === 0 && !b.error && (
            <p className="text-sm text-ink-soft">No browsable subsections.</p>
          )}

          {b.rails.map((rail) => (
            <Rail
              key={rail.key}
              title={
                <button
                  onClick={() => browse(b.source.id, rail.href, rail.title)}
                  className="font-display text-xl tracking-tight text-ink transition-colors hover:text-accent"
                >
                  {rail.title} →
                </button>
              }
              subtitle={railSubtitle(rail)}
            >
              {rail.loading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-[2/3] w-36 shrink-0 animate-pulse rounded-md bg-shelf"
                  />
                ))}

              {!rail.loading && rail.content?.kind === "entries" &&
                rail.content.entries.filter(matchesFilter).slice(0, 24).map((raw) => {
                  // Apply cached enrichment at render time so books that get
                  // enriched after the Library rail was fetched still surface
                  // the new cover/author data without waiting for a refresh.
                  const e = applyEnrichmentToEntry(raw);
                  const badge = primaryBadge(e);
                  return (
                    <CoverCard
                      key={`${rail.key}:${e.id}`}
                      title={e.title}
                      authors={e.authors}
                      cover={e.cover ?? e.thumbnail}
                      badge={badge ? formatLabel(badge) : undefined}
                      square={isAudiobookEntry(e)}
                      onClick={() =>
                        openEntry(navigate, {
                          sourceId: b.source.id,
                          sourceName: b.source.name,
                          entry: e,
                        })
                      }
                    />
                  );
                })}

              {!rail.loading && rail.content?.kind === "categories" &&
                rail.content.links.map((l, i) => (
                  <CategoryTile
                    key={`${rail.key}:c:${i}`}
                    title={prettyTitle(l.title) || prettyFromHref(l.href)}
                    onClick={() =>
                      browse(b.source.id, l.href, prettyTitle(l.title) || prettyFromHref(l.href))
                    }
                  />
                ))}

              {!rail.loading &&
                rail.content?.kind === "entries" &&
                rail.content.entries.length === 0 && (
                  <p className="text-sm text-ink-soft">Empty.</p>
                )}
              {!rail.loading &&
                rail.content?.kind === "entries" &&
                rail.content.entries.length > 0 &&
                rail.content.entries.filter(matchesFilter).length === 0 && (
                  <p className="text-sm text-ink-soft">
                    No {formatFilter === "audiobooks" ? "audiobooks" : "books"} here.
                  </p>
                )}
              {!rail.loading &&
                rail.content?.kind === "categories" &&
                rail.content.links.length === 0 && (
                  <p className="text-sm text-ink-soft">Empty.</p>
                )}
            </Rail>
          ))}
        </section>
      ))}
        </>
      )}
    </div>
  );
}

function IconLink({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-shelf hover:text-ink"
    >
      {children}
    </button>
  );
}

function SearchResultsView({
  query,
  searching,
  result,
  filter,
  onOpen,
}: {
  query: string;
  searching: boolean;
  result: SearchResult | null;
  filter: (e: Entry) => boolean;
  onOpen: (book: MergedBook) => void;
}) {
  if (searching && !result) {
    return <p className="text-sm text-ink-soft">Searching across libraries…</p>;
  }
  if (!result) return null;
  return (
    <>
      {result.merged.length === 0 ? (
        <EmptyState
          title="No matches"
          description={
            <>
              Nothing in your libraries matches{" "}
              <span className="font-display italic text-ink">"{query}"</span>.
              Try a different title, author, or ISBN.
            </>
          }
        />
      ) : (
        <>
        <div className="mb-4 flex items-center gap-3 text-sm text-ink-soft">
          <span>
            {result.merged.length} {result.merged.length === 1 ? "result" : "results"} for
            <span className="ml-1 font-display italic text-ink">"{query}"</span>
          </span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-5 gap-y-8">
          {result.merged
            .map((b) => ({ b, enriched: applyEnrichmentToEntry(mergedBookAsEntry(b)) }))
            .filter(({ enriched }) => filter(enriched))
            .map(({ b, enriched }) => {
            const badge = primaryBadge(enriched);
            return (
              <div key={b.key} className="flex flex-col">
                <CoverCard
                  title={enriched.title}
                  authors={enriched.authors}
                  cover={enriched.cover ?? enriched.thumbnail}
                  badge={badge ? formatLabel(badge) : undefined}
                  square={isAudiobookEntry(enriched)}
                  onClick={() => onOpen(b)}
                />
                {b.sources.length > 1 && (
                  <div className="mt-1 px-1 text-[11px] text-ink-soft">
                    from {b.sources.length} libraries
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </>
      )}
      {result.errors.length > 0 && (
        <div className="mt-6 text-xs text-ink-soft">
          {result.errors.map((e, i) => (
            <div key={i}>
              · {e.source_name || "(error)"}: {e.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function mergedBookAsEntry(b: MergedBook): Entry {
  const primary = b.sources[0];
  return {
    id: primary?.entry_id ?? b.key,
    title: b.title,
    authors: b.authors,
    summary: b.summary,
    identifiers: b.identifiers,
    categories: b.categories,
    series: b.series,
    language: b.language,
    cover: b.cover,
    thumbnail: b.thumbnail,
    acquisitions: b.acquisitions,
    navigation: [],
  };
}

function openMergedBook(navigate: ReturnType<typeof useNavigate>, b: MergedBook) {
  const primary = b.sources[0];
  const entry: Entry = {
    id: primary?.entry_id ?? b.key,
    title: b.title,
    authors: b.authors,
    summary: b.summary,
    identifiers: b.identifiers,
    categories: b.categories,
    series: b.series,
    language: b.language,
    cover: b.cover,
    thumbnail: b.thumbnail,
    acquisitions: b.acquisitions,
    navigation: [],
  };
  navigate("/book", {
    state: {
      sourceId: primary?.source_id ?? "",
      sourceName: primary?.source_name,
      entry,
      alternateSources: b.sources,
    },
  });
}

function railSubtitle(rail: RailData): string | undefined {
  if (rail.loading) return "loading…";
  if (rail.error) return "unavailable";
  if (!rail.content) return undefined;
  if (rail.content.kind === "entries") return `${rail.content.entries.length} titles`;
  return `${rail.content.links.length} categories`;
}

function prettyFromHref(href: string): string {
  try {
    const u = new URL(href);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return decode(last).replace(/[-_]/g, " ").replace(/\.\w+$/, "") || u.hostname;
  } catch {
    return decode(href);
  }
}

function prettyTitle(s?: string): string {
  if (!s) return "";
  return s.includes("%") ? decode(s) : s;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
