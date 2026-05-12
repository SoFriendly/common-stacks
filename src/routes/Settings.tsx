import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  api,
  type AuthConfig,
  type InstalledPlugin,
  type PluginCategory,
  type SendTargetInfo,
  type SettingField,
  type Source,
  type ValidateResult,
} from "../lib/api";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ChevronDown, Puzzle } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate, useUpdateStatus } from "../lib/updateStore";

export function Settings() {
  const [sources, setSources] = useState<Source[]>([]);
  const [downloadDir, setDownloadDir] = useState<string>("");

  // Add-source form
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [authKind, setAuthKind] = useState<AuthConfig["kind"]>("none");
  const [authUser, setAuthUser] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [authCookie, setAuthCookie] = useState("");
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidateResult | null>(null);

  function buildAuth(): AuthConfig {
    switch (authKind) {
      case "basic":
        return { kind: "basic", username: authUser, password: authPassword };
      case "bearer":
        return { kind: "bearer", token: authToken };
      case "cookie":
        return { kind: "cookie", cookie: authCookie };
      default:
        return { kind: "none" };
    }
  }

  function resetAuth() {
    setAuthKind("none");
    setAuthUser("");
    setAuthPassword("");
    setAuthToken("");
    setAuthCookie("");
  }

  async function refresh() {
    setSources(await api.listSources());
    setDownloadDir(await api.getDownloadDir());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleValidate() {
    if (!newUrl) return;
    setValidating(true);
    setValidation(null);
    try {
      setValidation(await api.validateSource(newUrl, buildAuth()));
    } finally {
      setValidating(false);
    }
  }

  async function handleAdd() {
    if (!newName || !newUrl) return;
    await api.addSource({ name: newName, url: newUrl, auth: buildAuth() });
    setNewName("");
    setNewUrl("");
    resetAuth();
    setValidation(null);
    refresh();
  }

  async function handleToggle(s: Source) {
    await api.updateSource({ ...s, enabled: !s.enabled });
    refresh();
  }

  async function handleRemove(id: string) {
    if (!window.confirm("Remove this source?")) return;
    await api.removeSource(id);
    refresh();
  }

  async function handlePickDir() {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") {
      await api.setDownloadDir(dir);
      refresh();
    }
  }

  async function handleExport() {
    const path = await saveDialog({
      defaultPath: "common-stacks.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    const json = await api.exportConfig();
    // Use simple browser File save via a blob if available; fall back to writing via JS clipboard if not.
    // Tauri fs plugin removed for minimal scope — instead embed config in a textarea export.
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (path as string).split(/[/\\]/).pop() || "common-stacks.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    const sel = await openDialog({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof sel !== "string") return;
    const resp = await fetch(`file://${sel}`);
    const json = await resp.text();
    await api.importConfig(json);
    refresh();
  }

  return (
    <div className="px-10 pb-16">
      <Link
        to="/library"
        className="mb-4 inline-block text-xs text-ink-soft hover:text-ink"
      >
        ← Library
      </Link>
      <header className="mb-8">
        <h1 className="font-display text-3xl tracking-tight">Settings</h1>
      </header>

      <section className="mb-12">
        <h2 className="mb-3 font-display text-xl">Libraries</h2>
        <div className="overflow-hidden rounded-lg border border-shelf">
          {sources.length === 0 && (
            <div className="p-4 text-sm text-ink-soft">No libraries.</div>
          )}
          {sources.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-4 border-b border-shelf p-4 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="font-display text-lg">{s.name}</div>
                <div className="truncate text-xs text-ink-soft">{s.url}</div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <button
                  onClick={() => handleToggle(s)}
                  className={`rounded px-2.5 py-1 ${
                    s.enabled ? "bg-shelf text-ink" : "text-ink-soft"
                  }`}
                >
                  {s.enabled ? "Enabled" : "Disabled"}
                </button>
                <button
                  onClick={() => handleRemove(s.id)}
                  className="text-xs text-ink-soft hover:text-ink"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12 max-w-2xl">
        <h2 className="mb-3 font-display text-xl">Add a library</h2>
        <div className="grid gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)}
            placeholder="Name"
            className="rounded-md border border-shelf bg-white px-3 py-2 text-sm"
          />
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.currentTarget.value)}
            placeholder="https://example.com/opds"
            className="rounded-md border border-shelf bg-white px-3 py-2 text-sm"
          />
          <div>
            <label className="block text-xs text-ink-soft">Authentication</label>
            <select
              value={authKind}
              onChange={(e) => setAuthKind(e.currentTarget.value as AuthConfig["kind"])}
              className="mt-1 w-full rounded-md border border-shelf bg-white px-3 py-2 text-sm"
            >
              <option value="none">None</option>
              <option value="basic">HTTP Basic</option>
              <option value="bearer">Bearer token</option>
              <option value="cookie">Cookie</option>
            </select>
          </div>
          {authKind === "basic" && (
            <div className="grid grid-cols-2 gap-3">
              <input
                value={authUser}
                onChange={(e) => setAuthUser(e.currentTarget.value)}
                placeholder="Username"
                autoComplete="off"
                className="rounded-md border border-shelf bg-white px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.currentTarget.value)}
                placeholder="Password"
                autoComplete="off"
                className="rounded-md border border-shelf bg-white px-3 py-2 text-sm"
              />
            </div>
          )}
          {authKind === "bearer" && (
            <input
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.currentTarget.value)}
              placeholder="Bearer token"
              autoComplete="off"
              className="rounded-md border border-shelf bg-white px-3 py-2 text-sm"
            />
          )}
          {authKind === "cookie" && (
            <input
              type="password"
              value={authCookie}
              onChange={(e) => setAuthCookie(e.currentTarget.value)}
              placeholder="Cookie header value (e.g. session=abc...)"
              autoComplete="off"
              className="rounded-md border border-shelf bg-white px-3 py-2 text-sm"
            />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleValidate}
              disabled={validating || !newUrl}
              className="rounded-md border border-shelf bg-white px-3 py-1.5 text-sm hover:bg-shelf disabled:opacity-50"
            >
              {validating ? "Checking…" : "Validate"}
            </button>
            <button
              onClick={handleAdd}
              disabled={!newName || !newUrl || (validation && !validation.ok) || false}
              className="rounded-md bg-ink px-4 py-1.5 text-sm text-paper disabled:opacity-50"
            >
              Add
            </button>
            {validation && (
              <span className={`text-xs ${validation.ok ? "text-green-700" : "text-red-700"}`}>
                {validation.ok
                  ? `OK — ${validation.title ?? "feed reached"}`
                  : validation.message}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="mb-12 max-w-2xl">
        <h2 className="mb-3 font-display text-xl">Download folder</h2>
        <div className="flex items-center gap-3">
          <code className="flex-1 rounded-md border border-shelf bg-white px-3 py-2 text-xs">
            {downloadDir}
          </code>
          <button
            onClick={handlePickDir}
            className="rounded-md border border-shelf bg-white px-3 py-2 text-sm hover:bg-shelf"
          >
            Change…
          </button>
        </div>
      </section>

      <section className="mb-12 max-w-2xl">
        <h2 className="mb-3 font-display text-xl">Plugins</h2>
        <p className="mb-3 text-xs text-ink-soft">
          Plugins extend CommonStacks with new metadata sources, send-to targets, and EPUB transformers.
        </p>
        <PluginsPanel />
      </section>

      <section className="mb-12 max-w-2xl">
        <h2 className="mb-3 font-display text-xl">Send-to targets</h2>
        <p className="mb-3 text-xs text-ink-soft">
          Configure where downloaded books can be delivered (Kindle, WebDAV).
        </p>
        <SendTargetsPanel />
      </section>

      <section className="mb-12 max-w-2xl">
        <h2 className="mb-3 font-display text-xl">App updates</h2>
        <UpdatePanel />
      </section>

      <section className="max-w-2xl">
        <h2 className="mb-3 font-display text-xl">Import / Export</h2>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="rounded-md border border-shelf bg-white px-3 py-2 text-sm hover:bg-shelf"
          >
            Export…
          </button>
          <button
            onClick={handleImport}
            className="rounded-md border border-shelf bg-white px-3 py-2 text-sm hover:bg-shelf"
          >
            Import…
          </button>
        </div>
      </section>
    </div>
  );
}

function UpdatePanel() {
  const status = useUpdateStatus();
  const [version, setVersion] = useState<string>("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const statusText = (() => {
    switch (status.kind) {
      case "checking":
        return "Checking…";
      case "up-to-date":
        return "You're on the latest version.";
      case "available":
        return `Update available: ${status.version}`;
      case "downloading":
        return "Downloading…";
      case "installing":
        return "Installing…";
      case "ready":
        return "Update installed — restart to apply.";
      case "error":
        return `Error: ${status.message}`;
      default:
        return "";
    }
  })();

  async function handleCheck() {
    setChecking(true);
    try {
      await checkForUpdate();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded-md border border-shelf bg-white p-3">
      <div>
        <div className="text-sm">CommonStacks {version || "—"}</div>
        {statusText && <div className="mt-0.5 text-xs text-ink-soft">{statusText}</div>}
      </div>
      <button
        onClick={handleCheck}
        disabled={checking || status.kind === "downloading" || status.kind === "installing"}
        className="rounded-md border border-shelf bg-white px-3 py-2 text-sm hover:bg-shelf disabled:opacity-50"
      >
        Check for updates
      </button>
    </div>
  );
}

function SendTargetsPanel() {
  const [targets, setTargets] = useState<SendTargetInfo[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  async function refresh() {
    setTargets(await api.listSendTargets());
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="overflow-hidden rounded-lg border border-shelf">
      {targets.map((t) => {
        const needsSetup = t.schema.some((f) => f.required) && !t.configured;
        const canEnable = !needsSetup;
        return (
          <div key={t.descriptor.id} className="border-b border-shelf last:border-b-0">
            <div className="flex items-center gap-4 px-4 py-3">
              <button
                onClick={() => setEditing(editing === t.descriptor.id ? null : t.descriptor.id)}
                className="group/row min-w-0 flex-1 text-left"
                aria-expanded={editing === t.descriptor.id}
              >
                <div className="flex items-center gap-1.5 font-display text-base">
                  <ChevronDown
                    className={`h-4 w-4 text-ink-soft transition-transform ${
                      editing === t.descriptor.id ? "rotate-0" : "-rotate-90"
                    }`}
                  />
                  <span>{t.descriptor.name}</span>
                </div>
                <div className="ml-5 text-xs text-ink-soft leading-snug">
                  {t.descriptor.description}
                </div>
              </button>
              {needsSetup && (
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-soft">
                  Needs setup
                </span>
              )}
              <Toggle
                disabled={!canEnable}
                checked={t.enabled}
                title={
                  canEnable
                    ? t.enabled
                      ? "Enabled — visible on books"
                      : "Disabled — hidden from books"
                    : "Configure required fields to enable"
                }
                onChange={async (next) => {
                  await api.setSendTargetEnabled(t.descriptor.id, next);
                  refresh();
                }}
              />
            </div>
            {editing === t.descriptor.id && (
              <div className="border-t border-shelf bg-shelf/30 px-4 py-4">
                <SendTargetForm target={t} onSaved={() => { refresh(); setEditing(null); }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SendTargetForm({
  target,
  onSaved,
}: {
  target: SendTargetInfo;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSendTargetSettings(target.descriptor.id).then((saved) => {
      // Layer saved values on top of schema defaults so an unconfigured target
      // still shows sensible pre-filled fields (e.g. crosspoint.local).
      const seeded: Record<string, string> = {};
      for (const f of target.schema) {
        if (f.default !== undefined) seeded[f.key] = f.default;
      }
      setValues({ ...seeded, ...saved });
    });
  }, [target.descriptor.id, target.schema]);

  function inputType(kind: SettingField["kind"]) {
    switch (kind) {
      case "secret":
        return "password";
      case "email":
        return "email";
      case "url":
        return "url";
      case "number":
        return "number";
      default:
        return "text";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.saveSendTargetSettings(target.descriptor.id, values);
      onSaved();
    } catch (err) {
      window.alert(`Save failed: ${err}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      {target.schema.map((field) =>
        field.kind === "boolean" ? (
          <div key={field.key} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs text-ink-soft">{field.label}</div>
              {field.help && (
                <div className="mt-0.5 text-[11px] text-ink-soft">{field.help}</div>
              )}
            </div>
            <Toggle
              checked={values[field.key] === "true"}
              onChange={(next) =>
                setValues((v) => ({ ...v, [field.key]: next ? "true" : "false" }))
              }
            />
          </div>
        ) : (
          <label key={field.key} className="block">
            <div className="text-xs text-ink-soft">
              {field.label}
              {field.required && <span className="text-red-700"> *</span>}
            </div>
            <input
              type={inputType(field.kind)}
              value={values[field.key] ?? ""}
              placeholder={field.placeholder}
              onChange={(e) => {
                const next = e.currentTarget.value;
                setValues((v) => ({ ...v, [field.key]: next }));
              }}
              className="mt-1 w-full rounded-md border border-shelf bg-white px-3 py-2 text-sm"
              required={field.required}
              autoComplete="off"
            />
            {field.help && (
              <div className="mt-0.5 text-[11px] text-ink-soft">{field.help}</div>
            )}
          </label>
        ),
      )}
      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-ink px-4 py-1.5 text-sm text-paper disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        disabled
          ? "cursor-not-allowed bg-shelf opacity-50"
          : checked
            ? "bg-ink"
            : "bg-shelf"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-paper shadow-sm transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function PluginsPanel() {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listPlugins()
      .then((p) => setPlugins(p))
      .finally(() => setLoading(false));
  }, []);

  const [dir, setDir] = useState<string>("");
  useEffect(() => {
    api.pluginsDir().then(setDir);
  }, []);

  async function handleReveal() {
    try {
      await api.revealPluginsDir();
    } catch (e) {
      window.alert(`Could not open folder: ${e}`);
    }
  }

  const groups: { key: PluginCategory; label: string; help: string }[] = [
    { key: "metadata", label: "Metadata enrichers", help: "Augment book metadata from external sources." },
    { key: "send", label: "Send-to targets", help: "Deliver downloaded books to other devices or services." },
    { key: "transformer", label: "Transformers", help: "Process files before they're sent (e.g. EPUB image optimizer)." },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-ink-soft">
          {loading ? "Loading…" : `${plugins.length} installed`}
        </div>
        <button
          onClick={handleReveal}
          className="rounded-md border border-shelf bg-white px-3 py-1.5 text-sm hover:bg-shelf"
        >
          Open plugins folder
        </button>
      </div>
      {dir && (
        <div className="mb-3 text-[11px] text-ink-soft">
          Drop a built plugin folder (containing <code>manifest.json</code> and
          its native library) into{" "}
          <code className="break-all">{dir}</code> then restart CommonStacks.
          See <code>docs/PLUGIN_DEVELOPMENT.md</code> for the protocol.
        </div>
      )}

      <div className="space-y-5">
        {groups.map((g) => {
          const items = plugins.filter((p) => p.category === g.key);
          return (
            <div key={g.key}>
              <div className="mb-1 flex items-baseline justify-between">
                <div className="font-display text-sm tracking-tight text-ink">
                  {g.label}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-ink-soft">
                  {items.length}
                </div>
              </div>
              <div className="mb-1 text-[11px] text-ink-soft">{g.help}</div>
              <div className="overflow-hidden rounded-lg border border-shelf">
                {items.length === 0 && !loading && (
                  <div className="p-3 text-xs text-ink-soft">None installed.</div>
                )}
                {items.map((p) => (
                  <div
                    key={`${p.category}:${p.descriptor.id}`}
                    className="flex items-start gap-3 border-b border-shelf px-3 py-2.5 last:border-b-0"
                  >
                    <Puzzle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-soft" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <div className="font-display text-sm">{p.descriptor.name}</div>
                        <code className="text-[10px] text-ink-soft">
                          {p.descriptor.id}
                        </code>
                      </div>
                      <div className="text-[11px] text-ink-soft leading-snug">
                        {p.descriptor.description}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-shelf px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-soft">
                      {p.source === "builtin" ? "Built-in" : "User"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
