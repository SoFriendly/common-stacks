#!/usr/bin/env bun
// Snapshots a few Mayberry OPDS feeds and their cover art into static files
// the landing page can render at build time — no proxy, no live fetching.
//
// Output:
//   src/landing/data/snapshot.json
//   public/landing-covers/<isbn>.jpg

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const COVERS_DIR = resolve(ROOT, "public/landing-covers");
const SNAPSHOT_PATH = resolve(ROOT, "src/landing/data/snapshot.json");
const BASE = "https://mayberry.pub";

interface Entry {
  id: string;
  isbn?: string;
  title: string;
  authors: string[];
  summary?: string;
  categories: string[];
  cover?: string; // local path under /landing-covers/
}

interface Rail {
  key: string;
  title: string;
  href: string;
  entries: Entry[];
}

interface Snapshot {
  capturedAt: string;
  sourceName: string;
  sourceUrl: string;
  rails: Rail[];
}

const FEEDS: { key: string; title: string; href: string; limit: number }[] = [
  { key: "new", title: "New Arrivals", href: "/opds/new", limit: 18 },
  { key: "popular", title: "Top Reads", href: "/opds/popular", limit: 18 },
  { key: "releases", title: "Recent Releases", href: "/opds/releases", limit: 18 },
];

// ISBNs to skip across all rails. Reasons usually come down to ugly cover crops
// or covers that don't render at the 2:3 aspect ratio the UI assumes.
const DENYLIST_ISBNS = new Set<string>([
  "9780345469915", // Timeline — cover crops awkwardly
]);

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? decodeXmlEntities(m[1]) : undefined;
}

function inner(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeXmlEntities(m[1].trim()) : undefined;
}

function parseEntries(xml: string): Omit<Entry, "cover">[] & { coverHref?: string }[] {
  const entries: any[] = [];
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  for (const b of blocks) {
    const id = inner(b, "id") ?? "";
    const title = inner(b, "title") ?? "";
    const summary = inner(b, "summary");
    const authors = [...b.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
      .map((m) => decodeXmlEntities(m[1].trim()))
      .filter(Boolean);
    const categories = [...b.matchAll(/<category[^>]*\blabel="([^"]+)"/g)]
      .map((m) => decodeXmlEntities(m[1]).replace(/^"|"$/g, ""))
      .filter(Boolean);
    const isbn = id.startsWith("urn:isbn:") ? id.slice("urn:isbn:".length) : undefined;
    const linkTags = b.match(/<link\b[^>]*>/g) ?? [];
    let coverHref: string | undefined;
    let thumbHref: string | undefined;
    for (const lt of linkTags) {
      const rel = attr(lt, "rel") ?? "";
      const href = attr(lt, "href");
      if (!href) continue;
      if (rel === "http://opds-spec.org/image") coverHref = href;
      else if (rel === "http://opds-spec.org/image/thumbnail") thumbHref = href;
    }
    entries.push({
      id,
      isbn,
      title,
      authors,
      summary,
      categories,
      coverHref: coverHref ?? thumbHref,
    });
  }
  return entries;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { Accept: "application/atom+xml" } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
}

async function downloadCover(href: string, isbn: string): Promise<string | null> {
  const url = href.startsWith("http") ? href : `${BASE}${href}`;
  const localName = `${isbn}.jpg`;
  const localPath = resolve(COVERS_DIR, localName);
  if (existsSync(localPath)) return `/landing-covers/${localName}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    await writeFile(localPath, buf);
    return `/landing-covers/${localName}`;
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(COVERS_DIR, { recursive: true });
  await mkdir(dirname(SNAPSHOT_PATH), { recursive: true });

  const rails: Rail[] = [];
  for (const feed of FEEDS) {
    process.stdout.write(`fetching ${feed.href}… `);
    const xml = await fetchText(`${BASE}${feed.href}`);
    const parsed = parseEntries(xml);
    const withCovers = parsed
      .filter((e: any) => e.coverHref && e.isbn && !DENYLIST_ISBNS.has(e.isbn))
      .slice(0, feed.limit);
    const entries: Entry[] = [];
    for (const e of withCovers as any[]) {
      const local = await downloadCover(e.coverHref, e.isbn);
      if (!local) continue;
      entries.push({
        id: e.id,
        isbn: e.isbn,
        title: e.title,
        authors: e.authors,
        summary: e.summary,
        categories: e.categories,
        cover: local,
      });
    }
    rails.push({ key: feed.key, title: feed.title, href: feed.href, entries });
    process.stdout.write(`${entries.length} entries with covers\n`);
  }

  const snapshot: Snapshot = {
    capturedAt: new Date().toISOString(),
    sourceName: "Mayberry Library",
    sourceUrl: BASE,
    rails,
  };
  await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`wrote ${SNAPSHOT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
