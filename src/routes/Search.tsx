import { useState } from "react";
import { useNavigate } from "react-router";
import { api, type Entry, type MergedBook, type SearchResult } from "../lib/api";
import { CoverCard } from "../components/CoverCard";

export function Search() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const r = await api.search(query.trim());
      setResult(r);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-10 pb-16">
      <header className="mb-6">
        <h1 className="font-display text-3xl tracking-tight">Search</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Federated search across every active library.
        </p>
      </header>

      <form onSubmit={runSearch} className="mb-8 flex gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search titles, authors, ISBNs…"
          className="w-full max-w-2xl rounded-md border border-shelf bg-white px-4 py-2.5 text-sm shadow-sm focus:border-spine focus:outline-none focus:ring-2 focus:ring-spine/30"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {result && <ResultsGrid books={result.merged} />}
      {result && result.errors.length > 0 && (
        <div className="mt-6 text-xs text-ink-soft">
          {result.errors.map((e) => (
            <div key={e.source_id}>· {e.source_name}: {e.message}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultsGrid({ books }: { books: MergedBook[] }) {
  const navigate = useNavigate();
  if (books.length === 0) {
    return <p className="text-sm text-ink-soft">No results.</p>;
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-5 gap-y-8">
      {books.map((b) => (
        <div key={b.key} className="flex flex-col">
          <CoverCard
            title={b.title}
            authors={b.authors}
            cover={b.cover ?? b.thumbnail}
            onClick={() => {
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
            }}
          />
          {b.sources.length > 1 && (
            <div className="mt-1 px-1 text-[11px] text-ink-soft">
              from {b.sources.length} libraries
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
