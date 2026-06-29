import { useState } from "react";

// Mobile = the device is actually a phone or tablet (iOS or Android), not just
// a small / touch-capable screen. CSS pointer/hover media queries are a poor
// proxy here: touchscreen Windows laptops and Surface devices match
// `pointer: coarse` and would be misclassified as mobile, flipping the UI to
// the touch layout on a real desktop.
function matchesMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac in UA; disambiguate via touch points.
  const isIpad =
    /Macintosh/.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod/i.test(ua) || isIpad;
}

function matchesAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export const isMobile = matchesMobile();
export const isAndroid = matchesAndroid();

// Device class doesn't change at runtime, so no media-query listener.
export function useIsMobile(): boolean {
  const [value] = useState(matchesMobile);
  return value;
}

export function useIsAndroid(): boolean {
  const [value] = useState(matchesAndroid);
  return value;
}

function detectDesktopOS(): "macos" | "windows" | "linux" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

export const desktopOS = detectDesktopOS();

// Label for the file-manager reveal action — Finder on macOS, Explorer on
// Windows, generic elsewhere.
export const revealLabel =
  desktopOS === "windows"
    ? "Show in Explorer"
    : desktopOS === "linux"
      ? "Show in File Manager"
      : "Reveal in Finder";
