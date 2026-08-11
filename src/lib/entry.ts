import type { Entry, Link } from "./api";
import type { NavigateFunction } from "react-router";

/**
 * Keep only the navigation links worth showing as browsable subsections.
 * Drops structural rels (self/up/start/pagination), search, and facet or
 * shelf links (COPS emits a facet link per tag, author, and rating, which
 * would otherwise flood the category grid).
 */
export function pickSubsections(navigation: Link[]): Link[] {
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

/**
 * Decide whether an OPDS entry represents a book (has acquisitions or
 * identifiable book metadata) or a category/section (a navigation tile).
 */
export function isBookEntry(e: Entry): boolean {
  if (e.acquisitions.length > 0) return true;
  if (e.authors.length > 0) return true;
  if (e.identifiers.length > 0) return true;
  return false;
}

/**
 * Navigate to the right destination when a cover card is clicked. Books open
 * the detail page; categories drill into a browse view.
 */
export function openEntry(
  navigate: NavigateFunction,
  args: { sourceId: string; sourceName?: string; entry: Entry },
) {
  const { sourceId, sourceName, entry } = args;
  if (isBookEntry(entry)) {
    navigate("/book", { state: { sourceId, sourceName, entry } });
    return;
  }
  const sub = entry.navigation.find(
    (l) => l.rel === "subsection" || (l.mime ?? "").includes("opds-catalog"),
  );
  if (sub) {
    const params = new URLSearchParams({
      source: sourceId,
      href: sub.href,
      title: entry.title,
    });
    navigate(`/browse?${params.toString()}`);
    return;
  }
  // Fall back to the book page; it'll surface "no downloads" gracefully.
  navigate("/book", { state: { sourceId, sourceName, entry } });
}
