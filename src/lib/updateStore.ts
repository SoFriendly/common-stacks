import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; version: string; notes?: string }
  | { kind: "downloading"; downloaded: number; total: number | null }
  | { kind: "installing" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

let status: Status = { kind: "idle" };
let pending: Update | null = null;
const listeners = new Set<() => void>();

function set(next: Status) {
  status = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function checkForUpdate(opts: { silent?: boolean } = {}) {
  if (status.kind === "checking" || status.kind === "downloading" || status.kind === "installing") return;
  set({ kind: "checking" });
  try {
    const update = await check();
    if (!update) {
      set({ kind: "up-to-date" });
      if (opts.silent) set({ kind: "idle" });
      return;
    }
    pending = update;
    set({ kind: "available", version: update.version, notes: update.body });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    set({ kind: "error", message });
  }
}

export async function downloadAndInstall() {
  if (!pending) return;
  let total: number | null = null;
  let downloaded = 0;
  set({ kind: "downloading", downloaded: 0, total: null });
  try {
    await pending.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
        set({ kind: "downloading", downloaded: 0, total });
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        set({ kind: "downloading", downloaded, total });
      } else if (event.event === "Finished") {
        set({ kind: "installing" });
      }
    });
    set({ kind: "ready" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    set({ kind: "error", message });
  }
}

export async function restartApp() {
  await relaunch();
}

export function dismiss() {
  pending = null;
  set({ kind: "idle" });
}

export function useUpdateStatus(): Status {
  return useSyncExternalStore(subscribe, () => status, () => status);
}

export function useAutoUpdateCheck(delayMs = 4000) {
  const ran = useRef(false);
  const tick = useCallback(() => {
    void checkForUpdate({ silent: true });
  }, []);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const id = setTimeout(tick, delayMs);
    return () => clearTimeout(id);
  }, [delayMs, tick]);
}
