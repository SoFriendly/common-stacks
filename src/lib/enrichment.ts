import type { EnrichedMetadata, Entry } from "./api";

const STORAGE_KEY = "commonstacks.enrichment.v1";

interface Store {
  [key: string]: { data: EnrichedMetadata; updatedAt: number };
}

// Lazily loaded so we don't parse the JSON until the first lookup.
let memory: Store | null = null;

function load(): Store {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    memory = raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    memory = {};
  }
  return memory!;
}

function persist() {
  if (!memory) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // quota or privacy mode — best effort.
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractIsbn13(s: string): string | null {
  const cleaned = s.replace(/[-\s]/g, "");
  const m = cleaned.match(/(97[89]\d{10})/);
  return m ? m[1] : null;
}

/**
 * Compute every cache key an entry could be looked up by. The first key is
 * preferred for writes; lookups try all of them in order.
 */
export function keysForEntry(e: Entry): string[] {
  const keys: string[] = [];
  for (const id of [e.id, ...e.identifiers]) {
    const isbn = extractIsbn13(id);
    if (isbn) keys.push(`isbn:${isbn}`);
  }
  if (e.title) {
    const t = normalize(e.title);
    const a = normalize(e.authors[0] ?? "");
    if (t) keys.push(`ta:${t}|${a}`);
  }
  return Array.from(new Set(keys));
}

export function get(entry: Entry): EnrichedMetadata | null {
  const store = load();
  for (const k of keysForEntry(entry)) {
    const hit = store[k];
    if (hit) return hit.data;
  }
  return null;
}

export function set(entry: Entry, data: EnrichedMetadata): void {
  const store = load();
  const keys = keysForEntry(entry);
  if (keys.length === 0) return;
  const value = { data, updatedAt: Date.now() };
  for (const k of keys) {
    store[k] = value;
  }
  persist();
}

/**
 * Apply an enrichment result to an entry without overwriting fields that
 * came from OPDS. Same merge policy used by the Book page.
 */
export function applyToEntry(entry: Entry, m: EnrichedMetadata): Entry {
  const seen = new Set(entry.categories.map((s) => s.toLowerCase()));
  const cats = [...entry.categories];
  for (const s of m.subjects) {
    const k = s.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      cats.push(s);
    }
  }
  return {
    ...entry,
    summary: entry.summary ?? m.description,
    language: entry.language ?? m.language,
    published: entry.published ?? m.published,
    cover: entry.cover ?? m.cover_url,
    thumbnail: entry.thumbnail ?? m.cover_url,
    categories: cats,
    authors: entry.authors.length > 0 ? entry.authors : m.authors,
  };
}

/** Convenience wrapper: look up the cache and merge if present. */
export function maybeApply(entry: Entry): Entry {
  const hit = get(entry);
  return hit ? applyToEntry(entry, hit) : entry;
}
