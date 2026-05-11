import { useEffect, useState } from "react";
import { api, type Source, type ValidateResult } from "../lib/api";
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
