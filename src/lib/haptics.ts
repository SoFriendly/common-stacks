/**
 * Trigger a short vibration if the runtime supports it. Web Vibration API
 * works on Android WebView; iOS Safari returns false. Always safe to call.
 */
export function tap(ms = 10): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(ms);
  } catch {
    // ignored
  }
}
