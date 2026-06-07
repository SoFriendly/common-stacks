import { useState } from "react";
import { CoverCard } from "../components/CoverCard";
import { Rail } from "../components/Rail";
import { DefaultCover } from "../components/DefaultCover";
import { data, type LandingEntry } from "./data";
import {
  Search as SearchIcon,
  Settings as SettingsIcon,
  RefreshCw,
  Download,
  Send,
  Check,
  ChevronDown,
  ArrowRight,
} from "lucide-react";

function Logo({ className }: { className?: string }) {
  return <img src="/logo.png" alt="Common Stacks" className={className} />;
}

// A small italic-serif eyebrow in the accent color — echoes the hero's
// "Send it to your reader." treatment and ties the sections together
// without resorting to monospace labels or hairline rules.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-display text-lg italic text-accent">{children}</p>;
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
    <div className="min-h-dvh bg-paper text-ink antialiased">
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
      <Plugins />
      <Sources />
      <ClosingCta />
      <Footer />
    </div>
  );
}

function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-shelf/70 bg-paper/85 backdrop-blur">
      <div className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#top" className="flex items-center gap-2 font-display text-lg tracking-tight">
          <Logo className="h-5 w-5" />
          Common Stacks
        </a>
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 text-sm text-ink-soft md:flex">
          <a href="#features" className="transition-colors hover:text-ink">Features</a>
          <a href="#plugins" className="transition-colors hover:text-ink">Plugins</a>
          <a href="#sources" className="transition-colors hover:text-ink">Shelves</a>
        </nav>
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3.5 py-1.5 text-sm text-paper transition-opacity hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" />
            Download
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                className="fixed inset-0 z-0 cursor-default"
                onClick={() => setOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 z-10 mt-2 w-44 overflow-hidden rounded-md border border-shelf bg-paper shadow-lg"
              >
                <a
                  href="https://releases.commonstacks.com/commonstacks-latest.dmg"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2.5 text-sm text-ink transition-colors hover:bg-shelf"
                >
                  Download for macOS
                </a>
                <a
                  href="https://releases.commonstacks.com/commonstacks-latest.exe"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block border-t border-shelf/70 px-4 py-2.5 text-sm text-ink transition-colors hover:bg-shelf"
                >
                  Download for Windows
                </a>
              </div>
            </>
          )}
        </div>
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
          <Logo className="mx-auto mb-7 h-24 w-24 md:h-28 md:w-28" />
          <p className="mb-5 font-display text-lg italic text-accent">
            An OPDS catalog client
          </p>
          <h1 className="font-display text-5xl leading-[1.02] tracking-tight text-balance md:text-7xl">
            Find a book.
            <br />
            <span className="italic text-accent">Send it to your reader.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-[46ch] text-base leading-relaxed text-ink-soft text-pretty md:text-lg">
            Every library you follow, in one place — searched together, sent to your
            reader in two clicks.
          </p>
          <div id="download" className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://releases.commonstacks.com/commonstacks-latest.dmg"
              className="inline-flex items-center gap-2 rounded-md bg-ink px-5 py-2.5 text-sm text-paper transition-opacity hover:opacity-90"
            >
              <Download className="h-4 w-4" />
              Download for macOS
            </a>
            <a
              href="https://releases.commonstacks.com/commonstacks-latest.exe"
              className="inline-flex items-center gap-2 rounded-md border border-shelf bg-paper px-5 py-2.5 text-sm text-ink transition-colors hover:bg-shelf"
            >
              <Download className="h-4 w-4" />
              Download for Windows
            </a>
          </div>
          <p className="mt-5 text-sm text-ink-soft">
            Free, open source, and local. No accounts, no telemetry.
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

// A small framed panel that mirrors the desktop app's surface treatment, so
// the feature demos read as real product UI rather than marketing decoration.
function DemoPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-shelf bg-paper p-4 shadow-xl shadow-black/5 ring-1 ring-black/5">
      {children}
    </div>
  );
}

function MiniCover({ entry, className }: { entry?: LandingEntry; className?: string }) {
  const base = "overflow-hidden rounded bg-shelf ring-1 ring-black/5";
  if (entry?.cover) {
    return (
      <div className={`${base} ${className ?? ""}`}>
        <img src={entry.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div className={`${base} ${className ?? ""}`}>
      {entry && (
        <DefaultCover title={entry.title} author={entry.authors[0]} className="h-full w-full" />
      )}
    </div>
  );
}

function SourcesDemo() {
  const sources = [
    { name: "Mayberry", host: "mayberry.pub", count: "1,204" },
    { name: "Calibre", host: "calibre.home", count: "318" },
    { name: "Kavita", host: "nas.local:5000", count: "96" },
  ];
  return (
    <DemoPanel>
      <div className="mb-1 px-1 font-display text-lg tracking-tight">Sources</div>
      <ul role="list" className="space-y-1">
        {sources.map((s) => (
          <li
            key={s.name}
            className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-shelf/60"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            <span className="font-display tracking-tight text-ink">{s.name}</span>
            <span className="truncate text-sm text-ink-soft">{s.host}</span>
            <span className="ml-auto text-sm text-ink-soft tabular-nums">{s.count}</span>
          </li>
        ))}
        <li className="flex items-center gap-3 px-2 py-2.5 text-sm text-accent">
          <span className="flex h-2 w-2 shrink-0 items-center justify-center">+</span>
          Add a source…
        </li>
      </ul>
    </DemoPanel>
  );
}

function SearchDemo({ results }: { results: LandingEntry[] }) {
  return (
    <DemoPanel>
      <div className="flex items-center gap-2 rounded-lg border border-shelf bg-shelf/40 px-3 py-2.5">
        <SearchIcon className="h-4 w-4 shrink-0 text-ink-soft" />
        <span className="font-display text-ink">space opera</span>
        <span className="ml-0.5 h-4 w-px animate-pulse bg-ink" />
      </div>
      <ul role="list" className="mt-2 space-y-1">
        {results.map((e, i) => (
          <li
            key={e.id}
            className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-shelf/60"
          >
            <MiniCover entry={e} className="h-12 w-8 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-display tracking-tight text-ink">{e.title}</div>
              <div className="truncate text-sm text-ink-soft">
                {e.authors[0] ?? "Unknown"}
              </div>
            </div>
            <span className="shrink-0 text-sm italic text-accent">
              {i === 0 ? "4 libraries" : i === 1 ? "2 libraries" : "1 library"}
            </span>
          </li>
        ))}
      </ul>
    </DemoPanel>
  );
}

function SendDemo({ book }: { book?: LandingEntry }) {
  return (
    <DemoPanel>
      <div className="flex items-center gap-3 px-1 pb-3">
        <MiniCover entry={book} className="h-14 w-10 shrink-0" />
        <div className="min-w-0">
          <div className="truncate font-display tracking-tight text-ink">
            {book?.title ?? "Your next read"}
          </div>
          <div className="truncate text-sm text-ink-soft">{book?.authors[0] ?? ""}</div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg bg-ink px-3.5 py-2.5 text-sm text-paper">
          <span className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Send to Kindle
          </span>
          <span className="flex items-center gap-1 text-spine">
            <Check className="h-4 w-4" />
            Sent
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-shelf px-3.5 py-2.5 text-sm text-ink">
          <Send className="h-4 w-4 text-ink-soft" />
          Send to Crosspoint
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-shelf px-3.5 py-2.5 text-sm text-ink">
          <Send className="h-4 w-4 text-ink-soft" />
          Send to Boox
        </div>
      </div>
    </DemoPanel>
  );
}

function DownloadDemo({ files }: { files: LandingEntry[] }) {
  const sizes = ["1.2 MB", "884 KB"];
  return (
    <DemoPanel>
      <button
        disabled
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm text-paper"
      >
        <Download className="h-4 w-4" />
        Download EPUB
      </button>
      <ul role="list" className="mt-3 space-y-1">
        {files.map((e, i) => (
          <li key={e.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
              <Check className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {slugify(e.title)}.epub
            </span>
            <span className="shrink-0 text-sm text-ink-soft tabular-nums">{sizes[i]}</span>
          </li>
        ))}
      </ul>
    </DemoPanel>
  );
}

function slugify(s: string): string {
  const full = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  if (full.length <= 24) return full;
  // Trim back to the last whole word so filenames never end mid-word.
  const cut = full.slice(0, 24);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 8 ? cut.slice(0, lastDash) : cut;
}

function FeatureRow({
  title,
  body,
  demo,
  reverse,
}: {
  title: string;
  body: string;
  demo: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-8 md:grid-cols-2 md:gap-16">
      <div className={reverse ? "md:order-2" : undefined}>
        <h3 className="font-display text-3xl tracking-tight text-balance md:text-4xl">{title}</h3>
        <p className="mt-4 max-w-md text-base leading-relaxed text-ink-soft text-pretty md:text-lg">
          {body}
        </p>
      </div>
      <div className={reverse ? "md:order-1" : undefined}>{demo}</div>
    </div>
  );
}

function Features() {
  const withCovers = data.rails.flatMap((r) => r.entries).filter((e) => e.cover);
  const searchResults = withCovers.slice(0, 3);
  const sendBook = withCovers[3] ?? withCovers[0];
  const downloadFiles = withCovers.slice(4, 6);

  return (
    <section id="features" className="py-24 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <Eyebrow>What it does</Eyebrow>
        <h2 className="mt-3 max-w-[18ch] font-display text-4xl tracking-tight text-balance md:text-5xl">
          Not a reader. A way to your reader.
        </h2>

        <div className="mt-16 flex flex-col gap-20 md:mt-20 md:gap-28">
          <FeatureRow
            title="Every catalog, one app"
            body="Mayberry, Calibre, Kavita, your own OPDS server — connect them once and they all live side by side."
            demo={<SourcesDemo />}
          />
          <FeatureRow
            reverse
            title="Search everything at once"
            body="Type a title. Results come back from every library you follow, merged by ISBN so duplicates collapse into one."
            demo={<SearchDemo results={searchResults} />}
          />
          <FeatureRow
            title="Send to your reader"
            body="Kindle, Crosspoint, Boox, and more. Set up a device once; after that it's two clicks from shelf to screen."
            demo={<SendDemo book={sendBook} />}
          />
          <FeatureRow
            reverse
            title="Or just download"
            body="Not into sending? Grab the EPUB and put it wherever you want. The file is yours."
            demo={<DownloadDemo files={downloadFiles} />}
          />
        </div>
      </div>
    </section>
  );
}

function Plugins() {
  const categories = [
    {
      label: "Metadata",
      blurb: "Fill in covers, descriptions, ISBNs, subjects.",
      builtins: ["OpenLibrary"],
    },
    {
      label: "Send",
      blurb: "Deliver the file to a device or service.",
      builtins: ["Kindle Email", "Crosspoint", "WebDAV"],
    },
    {
      label: "Transform",
      blurb: "Rewrite the file on its way out. Shrink images, fix metadata.",
      builtins: ["EPUB Image Optimizer"],
    },
  ];
  return (
    <section id="plugins" className="bg-shelf/40 py-24 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <Eyebrow>Plugins</Eyebrow>
        <div className="mt-3 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <h2 className="max-w-[16ch] font-display text-4xl tracking-tight text-balance md:text-5xl">
            Extend it without forking it.
          </h2>
          <p className="max-w-md text-base leading-relaxed text-ink-soft text-pretty">
            Plugins are scripts or executables you drop into a folder. The app discovers
            them at startup and they show up next to the built-ins.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {categories.map((c) => (
            <div key={c.label} className="rounded-xl border border-shelf bg-paper p-6">
              <h3 className="font-display text-xl italic tracking-tight text-accent">
                {c.label}
              </h3>
              <p className="mt-2 text-base leading-relaxed text-ink text-pretty">{c.blurb}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {c.builtins.map((b) => (
                  <span
                    key={b}
                    className="rounded-full bg-shelf px-3 py-1 text-sm text-ink-soft"
                  >
                    {b}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-16 grid gap-5 rounded-lg border border-shelf bg-paper p-7 md:grid-cols-[1fr_auto] md:items-center md:p-9">
          <div className="max-w-xl">
            <h3 className="font-display text-2xl tracking-tight">Build your own.</h3>
            <p className="mt-2 text-base leading-relaxed text-ink-soft text-pretty">
              Read JSON on stdin, write JSON on stdout. Python, Node, Go, Bash — anything
              with a shebang. No FFI, no ABI, no Rust required.
            </p>
          </div>
          <a
            href="https://github.com/SoFriendly/common-stacks/blob/main/docs/PLUGIN_DEVELOPMENT.md"
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center justify-center gap-2 rounded-md border border-shelf bg-paper px-4 py-2 text-sm text-ink transition-colors hover:bg-shelf"
          >
            Plugin development guide
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
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
    <section id="sources" className="py-24 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <Eyebrow>The shelves</Eyebrow>
        <div className="mt-3 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <h2 className="max-w-[16ch] font-display text-4xl tracking-tight text-balance md:text-5xl">
            More books than you'll ever read.
          </h2>
          <p className="max-w-md text-base leading-relaxed text-ink-soft text-pretty">
            Pulled live from{" "}
            <a
              href="https://mayberry.pub"
              className="text-ink underline decoration-spine underline-offset-2 transition-colors hover:decoration-accent"
              target="_blank"
              rel="noreferrer"
            >
              mayberry.pub
            </a>
            . Point it at your own servers and they all show up here.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8">
          {sample.map((e) => (
            <div
              key={e.id}
              className="aspect-[2/3] overflow-hidden rounded-md bg-shelf shadow-sm ring-1 ring-black/5 transition-transform duration-200 hover:-translate-y-1"
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

function ClosingCta() {
  return (
    <section className="relative overflow-hidden bg-ink text-paper">
      <div className="pointer-events-none absolute inset-0 -z-0 opacity-[0.07]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 20%, var(--color-spine) 0%, transparent 40%), radial-gradient(circle at 85% 80%, var(--color-accent) 0%, transparent 45%)",
          }}
        />
      </div>
      <div className="relative mx-auto max-w-6xl px-6 py-24 text-center md:py-28">
        <p className="font-display text-lg italic text-spine">Get the app</p>
        <h2 className="mx-auto mt-3 max-w-[18ch] font-display text-4xl tracking-tight text-balance md:text-6xl">
          Your whole library, two clicks away.
        </h2>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href="https://releases.commonstacks.com/commonstacks-latest.dmg"
            className="inline-flex items-center gap-2 rounded-md bg-paper px-5 py-2.5 text-sm text-ink transition-opacity hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            Download for macOS
          </a>
          <a
            href="https://releases.commonstacks.com/commonstacks-latest.exe"
            className="inline-flex items-center gap-2 rounded-md border border-paper/25 px-5 py-2.5 text-sm text-paper transition-colors hover:bg-paper/10"
          >
            <Download className="h-4 w-4" />
            Download for Windows
          </a>
        </div>
        <p className="mt-5 text-sm text-paper/60">
          Free, open source, and local. No accounts, no telemetry.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-shelf py-12 text-sm text-ink-soft">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <Logo className="h-6 w-6" />
          <div>
            <div className="font-display tracking-tight text-ink">Common Stacks</div>
            <div className="text-sm text-ink-soft">Free &amp; open source · MIT</div>
          </div>
        </div>
        <nav className="flex items-center gap-6">
          <a
            href="https://github.com/SoFriendly/common-stacks"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-ink"
          >
            GitHub
          </a>
          <a
            href="https://github.com/SoFriendly/common-stacks/blob/main/docs/PLUGIN_DEVELOPMENT.md"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-ink"
          >
            Plugins
          </a>
          <a
            href="https://joinmayberry.com"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-ink"
          >
            Mayberry
          </a>
        </nav>
      </div>
    </footer>
  );
}
