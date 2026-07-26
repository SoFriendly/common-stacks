import { useEffect, useState } from "react";
import { api } from "./api";
import { isAndroid, isMobile } from "./platform";

// The Libby tab preference lives in the Rust config; this module caches it and
// broadcasts changes so the nav components and Settings stay in sync without a
// provider. Desktop uses a native child webview, Android an iframe with a
// native bridge; iOS has neither, so it always reads false there.

const CHANGE_EVENT = "cs-libby-enabled-changed";

let cached: boolean | null = null;

async function fetchEnabled(): Promise<boolean> {
  if (isMobile && !isAndroid) return false;
  if (cached === null) {
    try {
      cached = await api.getLibbyEnabled();
    } catch {
      cached = false;
    }
  }
  return cached;
}

export async function setLibbyEnabled(enabled: boolean): Promise<void> {
  await api.setLibbyEnabled(enabled);
  cached = enabled;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function useLibbyEnabled(): boolean {
  const [enabled, setEnabled] = useState(cached ?? false);
  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      fetchEnabled().then((v) => {
        if (!cancelled) setEnabled(v);
      });
    };
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);
  return enabled;
}
