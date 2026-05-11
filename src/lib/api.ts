import { invoke } from "@tauri-apps/api/core";

export type AuthConfig =
  | { kind: "none" }
  | { kind: "basic"; username: string; password: string }
  | { kind: "bearer"; token: string }
  | { kind: "cookie"; cookie: string };

export interface Source {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  auth: AuthConfig;
}

export interface Link {
  href: string;
  rel?: string;
  title?: string;
  mime?: string;
}

export interface Acquisition {
  href: string;
  mime?: string;
  rel?: string;
  title?: string;
  size?: number;
}

export interface Entry {
  id: string;
  title: string;
  authors: string[];
  summary?: string;
  published?: string;
  updated?: string;
  language?: string;
  identifiers: string[];
  categories: string[];
  series?: string;
  cover?: string;
  thumbnail?: string;
  acquisitions: Acquisition[];
  navigation: Link[];
}

export interface Feed {
  title: string;
  id: string;
  entries: Entry[];
  navigation: Link[];
  next?: string;
  prev?: string;
  self_link?: string;
  search_template?: string;
}

export interface SourceRef {
  source_id: string;
  source_name: string;
  entry_id: string;
}

export interface MergedBook {
  key: string;
  title: string;
  authors: string[];
  cover?: string;
  thumbnail?: string;
  summary?: string;
  categories: string[];
  series?: string;
  language?: string;
  identifiers: string[];
  sources: SourceRef[];
  acquisitions: Acquisition[];
}

export interface SearchResult {
  merged: MergedBook[];
  errors: { source_id: string; source_name: string; message: string }[];
}

export interface DownloadedFile {
  path: string;
  name: string;
  size: number;
  modified_ms: number;
  extension?: string;
}

export interface EpubMetadata {
  title?: string;
  authors: string[];
  identifiers: string[];
  language?: string;
  description?: string;
  publisher?: string;
  subjects: string[];
  cover_data_url?: string;
}

export interface ValidateResult {
  ok: boolean;
  title?: string;
  message?: string;
}

export const api = {
  listSources: () => invoke<Source[]>("list_sources"),
  addSource: (input: { name: string; url: string; auth?: AuthConfig }) =>
    invoke<Source>("add_source", { input: { auth: { kind: "none" }, ...input } }),
  removeSource: (id: string) => invoke<void>("remove_source", { id }),
  updateSource: (source: Source) => invoke<void>("update_source", { source }),
  reorderSources: (ids: string[]) => invoke<void>("reorder_sources", { ids }),
  validateSource: (url: string) => invoke<ValidateResult>("validate_source", { url }),

  fetchFeed: (sourceId: string, url?: string) =>
    invoke<{ source_id: string; feed: Feed }>("fetch_feed", { sourceId, url }),
  search: (query: string) => invoke<SearchResult>("search", { query }),

  downloadBook: (request: {
    source_id: string;
    title: string;
    author?: string;
    href: string;
    mime?: string;
  }) => invoke<{ path: string }>("download_book", { request }),

  listDownloads: () => invoke<DownloadedFile[]>("list_downloads"),
  inspectDownload: (path: string) => invoke<EpubMetadata>("inspect_download", { path }),
  revealDownload: (path: string) => invoke<void>("reveal_download", { path }),
  deleteDownload: (path: string) => invoke<void>("delete_download", { path }),
  renameDownload: (path: string, newName: string) =>
    invoke<string>("rename_download", { path, newName }),

  getDownloadDir: () => invoke<string>("get_download_dir"),
  setDownloadDir: (path: string) => invoke<void>("set_download_dir", { path }),

  exportConfig: () => invoke<string>("export_config"),
  importConfig: (json: string) => invoke<void>("import_config", { json }),
};
