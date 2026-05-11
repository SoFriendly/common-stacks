import { ReactNode } from "react";

interface Props {
  title: ReactNode;
  subtitle?: string;
  children: ReactNode;
}

export function Rail({ title, subtitle, children }: Props) {
  return (
    <section className="mb-10">
      <header className="mb-3 flex items-baseline justify-between px-1">
        {typeof title === "string" ? (
          <h2 className="font-display text-xl tracking-tight text-ink">{title}</h2>
        ) : (
          title
        )}
        {subtitle && <span className="text-xs text-ink-soft">{subtitle}</span>}
      </header>
      <div className="flex gap-5 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {children}
      </div>
    </section>
  );
}
