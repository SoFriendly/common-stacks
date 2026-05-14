/**
 * Trigger a short vibration if the runtime supports it. Web Vibration API
 * works on Android WebView; iOS Safari returns false. Always safe to call.
 */
export function tap(ms = 10): void {
  if (typeof navigator === "undefined") return;
  const vibrate = (navigator as Navigator).vibrate;
  if (typeof vibrate !== "function") return;
  try {
    vibrate.call(navigator, ms);
  } catch {
    // ignored
  }
}
