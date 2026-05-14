import { useEffect, useState } from "react";

// Mobile = touch-first device with no fine pointer / hover support. This is the
// device-class signal we want (phone, tablet) rather than a width threshold —
// large phones in landscape exceed typical tablet widths but should still get
// the touch UI, and a narrow desktop window should keep the desktop UI.
const MOBILE_QUERY = "(pointer: coarse) and (hover: none)";

function matchesMobile(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia(MOBILE_QUERY).matches) return true;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export const isMobile = matchesMobile();

export function useIsMobile(): boolean {
  const [value, setValue] = useState(matchesMobile);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setValue(matchesMobile());
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return value;
}
