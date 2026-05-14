import { useEffect, useState } from "react";

export type FormatFilter = "all" | "books" | "audiobooks";

const KEY = "cs.formatFilter";
const EVENT = "cs:formatFilter";

function read(): FormatFilter {
  const v = localStorage.getItem(KEY);
  return v === "books" || v === "audiobooks" ? v : "all";
}

export function useFormatFilter(): [FormatFilter, (next: FormatFilter) => void] {
  const [value, setValue] = useState<FormatFilter>(() => read());

  useEffect(() => {
    const onChange = () => setValue(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const set = (next: FormatFilter) => {
    localStorage.setItem(KEY, next);
    window.dispatchEvent(new Event(EVENT));
    setValue(next);
  };

  return [value, set];
}
