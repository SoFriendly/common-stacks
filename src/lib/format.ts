import type { Acquisition, Entry } from "./api";

export type FormatKind = "epub" | "audiobook" | "pdf" | "comic" | "other";

const AUDIOBOOK_MIMES = [
  "application/audiobook+zip",
  "application/audiobook+lcp",
  "application/vnd.readium.lcp.license.v1.0+json",
  "application/x-m4b",
  "application/x-mpegurl", // playlist
];

const AUDIO_EXTENSIONS = new Set([
  "m4b",
  "mp3",
  "m4a",
  "aac",
  "opus",
  "ogg",
  "flac",
  "wav",
]);

const COMIC_MIMES = ["application/vnd.comicbook+zip", "application/vnd.comicbook-rar"];
const COMIC_EXTENSIONS = new Set(["cbz", "cbr"]);

function extOf(href: string): string {
  const clean = href.split(/[?#]/)[0];
  const last = clean.split("/").pop() ?? "";
  const m = last.match(/\.([A-Za-z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : "";
}

export function classifyAcquisition(a: Acquisition): FormatKind {
  const mime = (a.mime ?? "").toLowerCase().split(";")[0].trim();
  if (mime === "application/epub+zip") return "epub";
  if (mime === "application/pdf") return "pdf";
  if (AUDIOBOOK_MIMES.includes(mime)) return "audiobook";
  if (mime.startsWith("audio/")) return "audiobook";
  if (mime.includes("audiobook")) return "audiobook";
  if (COMIC_MIMES.includes(mime)) return "comic";

  const ext = extOf(a.href);
  if (ext === "epub") return "epub";
  if (ext === "pdf") return "pdf";
  if (AUDIO_EXTENSIONS.has(ext)) return "audiobook";
  if (COMIC_EXTENSIONS.has(ext)) return "comic";

  return "other";
}

/** Distinct formats present on an entry, in insertion order. */
export function entryFormats(e: Pick<Entry, "acquisitions">): FormatKind[] {
  const seen = new Set<FormatKind>();
  const out: FormatKind[] = [];
  for (const a of e.acquisitions) {
    const k = classifyAcquisition(a);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/** Audiobooks use a 1:1 cover (Audible/Spotify convention); everything else
 *  is 2:3 (book spine convention). */
export function isSquareFormat(kind: FormatKind | null | undefined): boolean {
  return kind === "audiobook";
}

export function formatLabel(kind: FormatKind): string {
  switch (kind) {
    case "epub":
      return "EPUB";
    case "audiobook":
      return "Audiobook";
    case "pdf":
      return "PDF";
    case "comic":
      return "Comic";
    default:
      return "File";
  }
}

/**
 * Pick the single most informative badge for a cover card. If a book has
 * an audiobook acquisition we show that (Audiobook is the more important
 * signal to surface — covers are usually book covers so EPUB is the
 * default expectation). Returns null when the entry is just an EPUB or
 * has no acquisitions (e.g. nav entries).
 */
export function primaryBadge(e: Pick<Entry, "acquisitions">): FormatKind | null {
  const formats = entryFormats(e);
  if (formats.includes("audiobook")) return "audiobook";
  if (formats.length === 0) return null;
  // EPUB is the assumed default; don't badge it.
  if (formats.length === 1 && formats[0] === "epub") return null;
  // Mixed (e.g. EPUB + PDF) — pick the first non-epub.
  const nonEpub = formats.find((f) => f !== "epub");
  return nonEpub ?? null;
}
