import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  api,
  type SendTargetInfo,
  type SettingField,
  type Source,
  type ValidateResult,
} from "../lib/api";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

export function Settings() {
  const [sources, setSources] = useState<Source[]>([]);
  const [downloadDir, setDownloadDir] = useState<string>("");

  // Add-source form
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidateResult | null>(null);

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
      setValidation(await api.validateSource(newUrl));
    } finally {
      setValidating(false);
    }
  }

  async function handleAdd() {
    if (!newName || !newUrl) return;
    await api.addSource({ name: newName, url: newUrl });
    setNewName("");
    setNewUrl("");
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
        <h2 className="mb-3 font-display text-xl">Send-to targets</h2>
        <p className="mb-3 text-xs text-ink-soft">
          Configure where downloaded books can be delivered (Kindle, WebDAV).
        </p>
        <SendTargetsPanel />
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
      {targets.map((t) => (
        <div key={t.descriptor.id} className="border-b border-shelf last:border-b-0">
          <button
            onClick={() => setEditing(editing === t.descriptor.id ? null : t.descriptor.id)}
            className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-shelf/50"
          >
            <div className="min-w-0">
              <div className="font-display text-base">{t.descriptor.name}</div>
              <div className="truncate text-xs text-ink-soft">{t.descriptor.description}</div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                t.configured ? "bg-shelf text-ink" : "text-ink-soft"
              }`}
            >
              {t.configured ? "Configured" : "Not set up"}
            </span>
          </button>
          {editing === t.descriptor.id && (
            <div className="border-t border-shelf bg-shelf/30 px-4 py-4">
              <SendTargetForm target={t} onSaved={() => { refresh(); setEditing(null); }} />
            </div>
          )}
        </div>
      ))}
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
    api.getSendTargetSettings(target.descriptor.id).then(setValues);
  }, [target.descriptor.id]);

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
      {target.schema.map((field) => (
        <label key={field.key} className="block">
          <div className="text-xs text-ink-soft">
            {field.label}
            {field.required && <span className="text-red-700"> *</span>}
          </div>
          <input
            type={inputType(field.kind)}
            value={values[field.key] ?? ""}
            placeholder={field.placeholder}
            onChange={(e) =>
              setValues((v) => ({ ...v, [field.key]: e.currentTarget.value }))
            }
            className="mt-1 w-full rounded-md border border-shelf bg-white px-3 py-2 text-sm"
            required={field.required}
            autoComplete="off"
          />
          {field.help && <div className="mt-0.5 text-[11px] text-ink-soft">{field.help}</div>}
        </label>
      ))}
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
