import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import logo from "../assets/logo.png";

interface Props {
  /** Lucide icon shown above the title. Ignored if `useLogo` is set. */
  icon?: LucideIcon;
  /** Use the Common Stacks logo as the visual. Default true if no `icon`. */
  useLogo?: boolean;
  title: string;
  description?: ReactNode;
  primary?: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  useLogo,
  title,
  description,
  primary,
  secondary,
  className,
}: Props) {
  const showLogo = useLogo ?? !Icon;

  return (
    <div
      className={`mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center ${
        className ?? ""
      }`}
    >
      {showLogo ? (
        <img
          src={logo}
          alt=""
          aria-hidden
          className="mb-5 h-20 w-20 opacity-90"
        />
      ) : (
        Icon && (
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-shelf/70 text-ink-soft">
            <Icon className="h-6 w-6" strokeWidth={1.5} />
          </div>
        )
      )}
      <h3 className="font-display text-2xl tracking-tight text-ink">{title}</h3>
      {description && (
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{description}</p>
      )}
      {(primary || secondary) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {primary && (
            <button
              onClick={primary.onClick}
              className="rounded-md bg-ink px-4 py-2 text-sm text-paper transition-opacity hover:opacity-90"
            >
              {primary.label}
            </button>
          )}
          {secondary && (
            <button
              onClick={secondary.onClick}
              className="rounded-md border border-shelf bg-white px-4 py-2 text-sm text-ink-soft transition-colors hover:bg-shelf hover:text-ink"
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
