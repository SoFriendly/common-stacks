import { invoke, Channel } from "@tauri-apps/api/core";

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

export interface PluginDescriptor {
  id: string;
  name: string;
  description: string;
}

export type PluginCategory = "metadata" | "send" | "transformer";

export interface InstalledPlugin {
  category: PluginCategory;
  descriptor: PluginDescriptor;
  source: "builtin" | "user";
}

export interface EnrichQuery {
  isbn?: string;
  title?: string;
  authors: string[];
}

export interface EnrichedMetadata {
  source: string;
  title?: string;
  authors: string[];
  description?: string;
  subjects: string[];
  publisher?: string;
  published?: string;
  language?: string;
  cover_url?: string;
  identifiers: string[];
}

export type SettingKind = "text" | "secret" | "email" | "url" | "number" | "boolean";

export interface SettingField {
  key: string;
  label: string;
  help?: string;
  required: boolean;
  kind: SettingKind;
  placeholder?: string;
  default?: string;
}

export interface SendTargetInfo {
  descriptor: PluginDescriptor;
  schema: SettingField[];
  configured: boolean;
  enabled: boolean;
}

export interface SendRequest {
  target_id: string;
  file_path: string;
  title?: string;
  author?: string;
}

export interface SendResult {
  ok: boolean;
  message: string;
}

export interface SendProgress {
  stage: string;
  message: string;
  current?: number;
  total?: number;
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

export interface AppVersionInfo {
  version: string;
  android_version_code?: number | null;
}

export const api = {
  getAppVersionInfo: () => invoke<AppVersionInfo>("get_app_version_info"),
  listSources: () => invoke<Source[]>("list_sources"),
  addSource: (input: { name: string; url: string; auth?: AuthConfig }) =>
    invoke<Source>("add_source", { input: { auth: { kind: "none" }, ...input } }),
  removeSource: (id: string) => invoke<void>("remove_source", { id }),
  updateSource: (source: Source) => invoke<void>("update_source", { source }),
  reorderSources: (ids: string[]) => invoke<void>("reorder_sources", { ids }),
  validateSource: (url: string, auth?: AuthConfig) =>
    invoke<ValidateResult>("validate_source", { url, auth }),

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
  findDownload: (request: {
    title: string;
    author?: string;
    href: string;
    mime?: string;
  }) => invoke<string | null>("find_download", { request }),
  inspectDownload: (path: string) => invoke<EpubMetadata>("inspect_download", { path }),
  openDownload: (path: string) => invoke<void>("open_download", { path }),
  revealDownload: (path: string) => invoke<void>("reveal_download", { path }),
  deleteDownload: (path: string) => invoke<void>("delete_download", { path }),
  renameDownload: (path: string, newName: string) =>
    invoke<string>("rename_download", { path, newName }),

  getDownloadDir: () => invoke<string>("get_download_dir"),
  setDownloadDir: (path: string) => invoke<void>("set_download_dir", { path }),

  exportConfig: () => invoke<string>("export_config"),
  exportConfigToPath: (path: string) => invoke<void>("export_config_to_path", { path }),
  importConfig: (json: string) => invoke<void>("import_config", { json }),
  importConfigFromPath: (path: string) => invoke<void>("import_config_from_path", { path }),

  listPlugins: () => invoke<InstalledPlugin[]>("list_plugins"),
  pluginsDir: () => invoke<string>("plugins_dir"),
  revealPluginsDir: () => invoke<void>("reveal_plugins_dir"),
  listEnrichers: () => invoke<PluginDescriptor[]>("list_enrichers"),
  enrichBook: (enricherId: string, query: EnrichQuery) =>
    invoke<EnrichedMetadata | null>("enrich_book", { enricherId, query }),

  listSendTargets: () => invoke<SendTargetInfo[]>("list_send_targets"),
  getSendTargetSettings: (targetId: string) =>
    invoke<Record<string, string>>("get_send_target_settings", { targetId }),
  saveSendTargetSettings: (targetId: string, fields: Record<string, string>) =>
    invoke<void>("save_send_target_settings", { targetId, fields }),
  setSendTargetEnabled: (targetId: string, enabled: boolean) =>
    invoke<void>("set_send_target_enabled", { targetId, enabled }),
  fetchKindleRelayInfo: (sendUrl: string) =>
    invoke<{ sender_email: string; sender_name?: string }>(
      "fetch_kindle_relay_info",
      { sendUrl },
    ),
  sendBook: (request: SendRequest, onProgress?: (p: SendProgress) => void) => {
    const channel = new Channel<SendProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<SendResult>("send_book", { request, onProgress: channel });
  },
};
