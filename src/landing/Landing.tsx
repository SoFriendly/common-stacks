import { useState } from "react";
import { CoverCard } from "../components/CoverCard";
import { Rail } from "../components/Rail";
import { DefaultCover } from "../components/DefaultCover";
import { data, findEntry, type LandingEntry } from "./data";
import {
  Search as SearchIcon,
  Settings as SettingsIcon,
  RefreshCw,
  Download,
  Send,
  Globe,
} from "lucide-react";

function Logo({ className }: { className?: string }) {
  return <img src="/logo.png" alt="Common Stacks" className={className} />;
}

type View = "library" | "book";
type SelectedBook = { entry: LandingEntry; railTitle: string };

export function Landing() {
  const [view, setView] = useState<View>("library");
  const [selected, setSelected] = useState<SelectedBook | null>(null);

  function openBook(entry: LandingEntry, railTitle: string) {
    setSelected({ entry, railTitle });
    setView("book");
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <SiteHeader />
      <Hero />
      <PreviewWindow>
        {view === "library" ? (
          <LibraryPreview onOpenBook={openBook} />
        ) : (
          selected && (
            <BookPreview
              entry={selected.entry}
              railTitle={selected.railTitle}
              onBack={() => setView("library")}
            />
          )
        )}
      </PreviewWindow>
      <Features />
      <Sources />
      <Footer />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-shelf/70 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#top" className="flex items-center gap-2 font-display text-lg tracking-tight">
          <Logo className="h-5 w-5" />
          Common Stacks
        </a>
        <nav className="hidden items-center gap-7 text-sm text-ink-soft md:flex">
          <a href="#preview" className="hover:text-ink">Preview</a>
          <a href="#features" className="hover:text-ink">Features</a>
          <a href="#sources" className="hover:text-ink">Sources</a>
          <a
            href="https://github.com/jmitch/common-stacks"
            className="hover:text-ink"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
        <a
          href="#download"
          className="rounded-md bg-ink px-3.5 py-1.5 text-sm text-paper transition-opacity hover:opacity-90"
        >
          Download
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 10%, var(--color-spine) 0%, transparent 45%), radial-gradient(circle at 85% 30%, var(--color-accent) 0%, transparent 40%)",
          }}
        />
      </div>
      <div className="mx-auto max-w-6xl px-6 pt-16 pb-12 md:pt-24 md:pb-16">
        <div className="mx-auto max-w-3xl text-center">
          <Logo className="mx-auto mb-6 h-24 w-24 md:h-28 md:w-28" />
          <p className="mb-4 text-xs uppercase tracking-[0.18em] text-ink-soft">
            For OPDS catalogs
          </p>
          <h1 className="font-display text-5xl leading-[1.05] tracking-tight md:text-6xl">
            Find a book.
            <br />
            <span className="italic text-accent">Send it to your reader.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-base leading-relaxed text-ink-soft md:text-lg">
            Every library you follow, in one place. Two clicks to your reader.
          </p>
          <div id="download" className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://github.com/jmitch/common-stacks/releases/latest"
              className="inline-flex items-center gap-2 rounded-md bg-ink px-5 py-2.5 text-sm text-paper transition-opacity hover:opacity-90"
            >
              <Download className="h-4 w-4" />
              Download for macOS
            </a>
            <a
              href="https://github.com/jmitch/common-stacks"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-shelf bg-paper px-5 py-2.5 text-sm text-ink transition-colors hover:bg-shelf"
            >
              Source on GitHub
            </a>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            Free. Open source. macOS.
          </p>
        </div>
      </div>
    </section>
  );
}

function PreviewWindow({ children }: { children: React.ReactNode }) {
  return (
    <section id="preview" className="relative mx-auto max-w-6xl px-6 pb-24">
      <div
        className="rounded-2xl p-2 shadow-2xl shadow-black/20 ring-1 ring-black/5"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.02) 50%, rgba(255,255,255,0.04) 100%)",
        }}
      >
        <div className="overflow-hidden rounded-xl border border-shelf bg-paper">
          <div className="flex items-center gap-2 border-b border-shelf bg-shelf/60 px-4 py-3">
            <div className="flex gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            </div>
            <div className="flex-1 text-center font-display text-sm tracking-tight text-ink-soft">
              Common Stacks · Library
            </div>
            <div className="w-12" />
          </div>
          <div className="preview-scroll relative h-[640px] overflow-y-auto">
            {children}
            <div
              className="pointer-events-none sticky bottom-0 h-24 w-full"
              style={{
                background:
                  "linear-gradient(180deg, transparent 0%, var(--color-paper) 100%)",
                marginTop: "-6rem",
              }}
            />
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-ink-soft">Click around.</p>
    </section>
  );
}

function LibraryPreview({
  onOpenBook,
}: {
  onOpenBook: (entry: LandingEntry, railTitle: string) => void;
}) {
  return (
    <div className="px-10 pt-6 pb-16">
      <header className="mb-8 flex items-center justify-between gap-6">
        <div className="flex items-center gap-1 rounded-md border border-shelf p-0.5">
          <span className="rounded bg-ink px-3 py-1 text-xs text-paper">Library</span>
          <span className="px-3 py-1 text-xs text-ink-soft">Downloads</span>
        </div>
        <div className="relative w-full max-w-md flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-0 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            disabled
            placeholder="Search titles, authors, ISBNs…"
            className="w-full cursor-not-allowed border-0 border-b border-shelf bg-transparent py-2 pr-2 pl-7 font-display text-base text-ink placeholder:text-ink-soft/70"
          />
        </div>
        <div className="flex items-center gap-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-md text-ink-soft">
            <RefreshCw className="h-4 w-4" />
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-md text-ink-soft">
            <SettingsIcon className="h-4 w-4" />
          </div>
        </div>
      </header>

      <section className="mb-12">
        <div className="mb-4 flex items-baseline gap-3 border-b border-shelf pb-2">
          <h2 className="font-display text-2xl tracking-tight">{data.sourceName}</h2>
          <span className="text-xs text-ink-soft">mayberry.pub</span>
        </div>

        {data.rails.map((rail) => (
          <Rail
            key={rail.key}
            title={
              <span className="font-display text-xl tracking-tight text-ink">
                {rail.title} →
              </span>
            }
            subtitle={`${rail.entries.length} titles`}
          >
            {rail.entries.map((e) => (
              <CoverCard
                key={e.id}
                title={e.title}
                authors={e.authors}
                cover={e.cover}
                onClick={() => onOpenBook(e, rail.title)}
              />
            ))}
          </Rail>
        ))}
      </section>
    </div>
  );
}

function BookPreview({
  entry,
  railTitle,
  onBack,
}: {
  entry: LandingEntry;
  railTitle: string;
  onBack: () => void;
}) {
  return (
    <div className="px-10 pt-6 pb-16">
      <button
        onClick={onBack}
        className="mb-4 text-xs text-ink-soft transition-colors hover:text-ink"
      >
        ← Back to {railTitle}
      </button>

      <div className="grid grid-cols-[14rem_1fr] gap-10">
        <div>
          <div className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-shelf shadow-lg ring-1 ring-black/5">
            {entry.cover ? (
              <img
                src={entry.cover}
                alt={entry.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <DefaultCover
                title={entry.title}
                author={entry.authors[0]}
                className="absolute inset-0 h-full w-full"
              />
            )}
          </div>
          <div className="mt-6 space-y-2">
            <button
              disabled
              title="Download in the desktop app"
              className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-md bg-ink/30 px-4 py-2 text-sm text-paper"
            >
              <Download className="h-4 w-4" />
              Download EPUB
            </button>
            <button
              disabled
              className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-shelf px-4 py-2 text-sm text-ink-soft"
            >
              <Send className="h-4 w-4" />
              Send to device
            </button>
            <a
              href="#download"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById("download")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="block pt-2 text-center text-xs text-accent hover:underline"
            >
              Available in the app
            </a>
          </div>
        </div>

        <div>
          <h1 className="font-display text-4xl leading-tight tracking-tight">{entry.title}</h1>
          {entry.authors.length > 0 && (
            <p className="mt-2 font-display text-lg italic text-ink-soft">
              {entry.authors.join(", ")}
            </p>
          )}
          {entry.categories.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {entry.categories.slice(0, 8).map((c, i) => (
                <span
                  key={i}
                  className="rounded-full bg-shelf px-2.5 py-0.5 text-xs text-ink-soft"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          {entry.summary && (
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink/90">
              {entry.summary}
            </p>
          )}
          {entry.isbn && !entry.isbn.startsWith("MB") && (
            <p className="mt-6 text-xs text-ink-soft">ISBN {entry.isbn}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Features() {
  const items = [
    {
      icon: <Globe className="h-5 w-5" />,
      title: "Every catalog, one app",
      body: "Mayberry, Calibre, Kavita, your own server. One place.",
    },
    {
      icon: <SearchIcon className="h-5 w-5" />,
      title: "Search everything at once",
      body: "Type a title. Hits from every library, merged by ISBN.",
    },
    {
      icon: <Send className="h-5 w-5" />,
      title: "Send to your reader",
      body: "Kindle, Crosspoint, Boox, and more. Set up once. Two clicks after that.",
    },
    {
      icon: <Download className="h-5 w-5" />,
      title: "Or just download",
      body: "Grab the EPUB. Put it wherever you want.",
    },
  ];
  return (
    <section id="features" className="border-t border-shelf bg-shelf/30 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl tracking-tight md:text-4xl">
            Not a reader. A way to your reader.
          </h2>
          <p className="mt-3 text-ink-soft">
            No accounts. No telemetry. No lock-in.
          </p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {items.map((f) => (
            <div
              key={f.title}
              className="rounded-lg border border-shelf bg-paper p-6 transition-shadow hover:shadow-md"
            >
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md bg-shelf text-accent">
                {f.icon}
              </div>
              <h3 className="font-display text-lg tracking-tight">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Sources() {
  // Show a wall of covers across all rails as social proof of "real catalogs".
  const all = data.rails.flatMap((r) => r.entries);
  const sample = all.slice(0, 16);
  return (
    <section id="sources" className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl tracking-tight md:text-4xl">
            More books than you'll ever read.
          </h2>
          <p className="mt-3 text-ink-soft">
            From <a href="https://mayberry.pub" className="underline" target="_blank" rel="noreferrer">mayberry.pub</a>. Add your own sources too.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8">
          {sample.map((e) => (
            <div
              key={e.id}
              className="aspect-[2/3] overflow-hidden rounded-md bg-shelf shadow-sm ring-1 ring-black/5"
            >
              {e.cover && (
                <img
                  src={e.cover}
                  alt={e.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-shelf py-10 text-sm text-ink-soft">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6">
        <div className="flex items-center gap-2">
          <Logo className="h-5 w-5" />
          <span className="font-display tracking-tight text-ink">Common Stacks</span>
        </div>
        <div className="flex items-center gap-5">
          <a
            href="https://github.com/jmitch/common-stacks"
            target="_blank"
            rel="noreferrer"
            className="hover:text-ink"
          >
            GitHub
          </a>
          <a
            href="https://joinmayberry.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-ink"
          >
            Mayberry Network
          </a>
        </div>
      </div>
    </footer>
  );
}
