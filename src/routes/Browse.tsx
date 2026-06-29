import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, type Feed } from "../lib/api";
import { CoverCard } from "../components/CoverCard";
import { CategoryTile } from "../components/CategoryTile";
import { openEntry } from "../lib/entry";
import { maybeApply as applyEnrichmentToEntry } from "../lib/enrichment";
import { primaryBadge, formatLabel, isAudiobookEntry } from "../lib/format";
import { useIsMobile } from "../lib/platform";

export function Browse() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const sourceId = params.get("source") ?? "";
  const href = params.get("href") ?? "";
  const title = params.get("title") ?? "";

  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    if (!sourceId || !href) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFeed(null);
    (async () => {
      try {
        const r = await api.fetchFeed(sourceId, href);
        if (cancelled) return;
        setFeed(r.feed);
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId, href]);

  async function loadMore() {
    if (loadingMoreRef.current || loading || !feed?.next) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const r = await api.fetchFeed(sourceId, feed.next);
      setFeed((prev) => {
        if (!prev) return r.feed;
        const seen = new Set(prev.entries.map((e) => e.id));
        const fresh = r.feed.entries.filter((e) => !seen.has(e.id));
        return {
          ...r.feed,
          navigation: prev.navigation,
          entries: [...prev.entries, ...fresh],
          next: fresh.length > 0 ? r.feed.next : undefined,
        };
      });
    } catch (e) {
      setError(String(e));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  function go(nextHref: string, nextTitle: string) {
    const p = new URLSearchParams({
      source: sourceId,
      href: nextHref,
      title: nextTitle,
    });
    navigate(`/browse?${p.toString()}`);
  }

  const subsections =
    feed?.navigation.filter((l) => {
      const r = (l.rel ?? "").toLowerCase();
      return (
        r !== "self" &&
        r !== "up" &&
        r !== "start" &&
        r !== "search" &&
        r !== "alternate" &&
        !r.includes("opensearch")
      );
    }) ?? [];

  return (
    <div className={isMobile ? "px-4 pt-4 pb-4" : "px-6 pb-16"}>
      {!isMobile && (
        <button
          onClick={() => navigate(-1)}
          className="mb-4 text-xs text-ink-soft hover:text-ink"
        >
          ← Back
        </button>
      )}
      <header className="mb-8">
        <h1 className="font-display text-3xl tracking-tight">
          {title || feed?.title || "Browse"}
        </h1>
        {feed?.title && title && feed.title !== title && (
          <p className="mt-1 text-sm text-ink-soft">{feed.title}</p>
        )}
      </header>

      {loading && <p className="text-sm text-ink-soft">Loading…</p>}
      {error && <p className="text-sm text-ink-soft">Connection issue: {error}</p>}

      {!loading && feed && subsections.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-display text-xl">Categories</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-5 gap-y-8">
            {subsections.map((l, i) => (
              <CategoryTile
                key={i}
                title={prettyTitle(l.title) || prettyFromHref(l.href)}
                onClick={() => go(l.href, prettyTitle(l.title) || prettyFromHref(l.href))}
              />
            ))}
          </div>
        </section>
      )}

      {!loading && feed && feed.entries.length > 0 && (
        <section>
          {subsections.length > 0 && (
            <h2 className="mb-3 font-display text-xl">Titles</h2>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-5 gap-y-8">
            {feed.entries.map((raw) => {
              const e = applyEnrichmentToEntry(raw);
              const badge = primaryBadge(e);
              return (
                <CoverCard
                  key={e.id}
                  title={e.title}
                  authors={e.authors}
                  cover={e.cover ?? e.thumbnail}
                  badge={badge ? formatLabel(badge) : undefined}
                  square={isAudiobookEntry(e)}
                  onClick={() => openEntry(navigate, { sourceId, entry: e })}
                />
              );
            })}
          </div>
        </section>
      )}

      {!loading && feed?.next && (
        <LazyLoadSentinel onVisible={loadMore} loading={loadingMore} />
      )}

      {!loading &&
        feed &&
        feed.entries.length === 0 &&
        subsections.length === 0 && (
          <p className="text-sm text-ink-soft">Empty.</p>
        )}
    </div>
  );
}

function LazyLoadSentinel({ onVisible, loading }: { onVisible: () => void; loading: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisibleRef.current();
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading]);

  return (
    <div ref={ref} className="mt-5 flex h-10 items-center justify-center text-sm text-ink-soft">
      {loading ? "Loading more…" : null}
    </div>
  );
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
