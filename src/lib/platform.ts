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

export const isMobile = matchesMobile();

// Device class doesn't change at runtime, so no media-query listener.
export function useIsMobile(): boolean {
  const [value] = useState(matchesMobile);
  return value;
}
