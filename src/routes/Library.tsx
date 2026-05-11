import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, type Entry, type Link, type Source } from "../lib/api";
import { CoverCard } from "../components/CoverCard";
import { CategoryTile } from "../components/CategoryTile";
import { Rail } from "../components/Rail";

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
  const [blocks, setBlocks] = useState<SourceBlock[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sources = await api.listSources();
      if (cancelled) return;
      setBlocks(sources.map((source) => ({ source, rails: [], loading: true })));
      await Promise.all(sources.map((s) => hydrate(s)));

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
  }, []);

  function browse(sourceId: string, href: string, title: string) {
    const params = new URLSearchParams({ source: sourceId, href, title });
    navigate(`/browse?${params.toString()}`);
  }

  return (
    <div className="px-10 pb-16">
      <header className="mb-8">
        <h1 className="font-display text-3xl tracking-tight text-ink">Library</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Wander your stacks. Discovery across every connected library.
        </p>
      </header>

      {blocks.length === 0 && (
        <p className="text-sm text-ink-soft">No sources configured yet.</p>
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
                rail.content.entries
                  .slice(0, 24)
                  .map((e) => (
                    <CoverCard
                      key={`${rail.key}:${e.id}`}
                      title={e.title}
                      authors={e.authors}
                      cover={e.cover ?? e.thumbnail}
                      onClick={() =>
                        navigate("/book", {
                          state: {
                            sourceId: b.source.id,
                            sourceName: b.source.name,
                            entry: e,
                          },
                        })
                      }
                    />
                  ))}

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
                rail.content?.kind === "categories" &&
                rail.content.links.length === 0 && (
                  <p className="text-sm text-ink-soft">Empty.</p>
                )}
            </Rail>
          ))}
        </section>
      ))}
    </div>
  );
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
