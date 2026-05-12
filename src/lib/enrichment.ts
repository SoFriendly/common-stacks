import { invoke } from "@tauri-apps/api/core";
import type { EnrichedMetadata, Entry } from "./api";

const STORAGE_KEY = "commonstacks.enrichment.v1";

interface Store {
  [key: string]: { data: EnrichedMetadata; updatedAt: number };
}

let memory: Store | null = null;
let initPromise: Promise<void> | null = null;

/** Force a load from disk (canonical) + localStorage (warm cache). */
export function ensureLoaded(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const fromLocal = readLocal();
    let fromDisk: Store = {};
    try {
      const raw = await invoke<string>("read_enrichment_cache");
      if (raw) fromDisk = JSON.parse(raw);
    } catch {
      // No backend (browser preview?) or first run — fall through with empty.
    }
    // Merge by entry-level recency. Disk is canonical for cold starts; if
    // localStorage has a fresher entry (last session wrote both, then OS
    // wiped the disk write for some reason) we keep it.
    memory = { ...fromDisk };
    for (const [k, v] of Object.entries(fromLocal)) {
      const existing = memory[k];
      if (!existing || existing.updatedAt < v.updatedAt) {
        memory[k] = v;
      }
    }
  })();
  return initPromise;
}

function readLocal(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function ensureMemory(): Store {
  if (memory) return memory;
  // Synchronous fallback: seed from localStorage so render-time reads have
  // *something* while the async disk load is still in flight.
  memory = readLocal();
  return memory;
}

async function persist(): Promise<void> {
  if (!memory) return;
  const serialized = JSON.stringify(memory);
  // Write both layers. localStorage is fast and survives most cases; the
  // disk file is canonical for the rest.
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // quota or privacy mode — ignore.
  }
  try {
    await invoke("write_enrichment_cache", { contents: serialized });
  } catch {
    // No backend — best-effort.
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
  const store = ensureMemory();
  for (const k of keysForEntry(entry)) {
    const hit = store[k];
    if (hit) return hit.data;
  }
  return null;
}

/** True if any key for this entry already has cached enrichment data. */
export function has(entry: Entry): boolean {
  return get(entry) !== null;
}

export function set(entry: Entry, data: EnrichedMetadata): void {
  const store = ensureMemory();
  const keys = keysForEntry(entry);
  if (keys.length === 0) return;
  const value = { data, updatedAt: Date.now() };
  for (const k of keys) {
    store[k] = value;
  }
  // Fire-and-forget persist. Awaiting would block the render pipeline.
  void persist();
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
