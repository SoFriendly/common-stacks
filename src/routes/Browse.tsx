import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, type Feed } from "../lib/api";
import { CoverCard } from "../components/CoverCard";
import { CategoryTile } from "../components/CategoryTile";
import { openEntry } from "../lib/entry";

export function Browse() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sourceId = params.get("source") ?? "";
  const href = params.get("href") ?? "";
  const title = params.get("title") ?? "";

  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    <div className="px-10 pb-16">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 text-xs text-ink-soft hover:text-ink"
      >
        ← Back
      </button>
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
            {feed.entries.map((e) => (
              <CoverCard
                key={e.id}
                title={e.title}
                authors={e.authors}
                cover={e.cover ?? e.thumbnail}
                onClick={() => openEntry(navigate, { sourceId, entry: e })}
              />
            ))}
          </div>
        </section>
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
