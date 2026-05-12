import snapshot from "./data/snapshot.json";

export interface LandingEntry {
  id: string;
  isbn?: string;
  title: string;
  authors: string[];
  summary?: string;
  categories: string[];
  cover?: string;
}

export interface LandingRail {
  key: string;
  title: string;
  href: string;
  entries: LandingEntry[];
}

export interface LandingSnapshot {
  capturedAt: string;
  sourceName: string;
  sourceUrl: string;
  rails: LandingRail[];
}

export const data: LandingSnapshot = snapshot as LandingSnapshot;

export function findEntry(isbn: string): { entry: LandingEntry; railTitle: string } | null {
  for (const rail of data.rails) {
    const entry = rail.entries.find((e) => e.isbn === isbn);
    if (entry) return { entry, railTitle: rail.title };
  }
  return null;
}
