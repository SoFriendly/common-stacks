import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface MobileSearchValue {
  open: boolean;
  query: string;
  submittedQuery: string;
  openSearch: () => void;
  closeSearch: () => void;
  setQuery: (q: string) => void;
  submit: () => void;
}

const Ctx = createContext<MobileSearchValue | null>(null);

export function MobileSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const openSearch = useCallback(() => setOpen(true), []);
  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSubmittedQuery("");
  }, []);
  const submit = useCallback(() => setSubmittedQuery(query), [query]);

  const value = useMemo(
    () => ({ open, query, submittedQuery, openSearch, closeSearch, setQuery, submit }),
    [open, query, submittedQuery, openSearch, closeSearch, submit],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMobileSearch(): MobileSearchValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMobileSearch outside provider");
  return v;
}
