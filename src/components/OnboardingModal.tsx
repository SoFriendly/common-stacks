import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { LibraryBig, Plus, Send, X } from "lucide-react";
import { cn } from "../lib/utils";
import { useIsMobile } from "../lib/platform";

// Bump the suffix to re-show onboarding after a redesign.
const SEEN_KEY = "cs.onboarding.v1";

function hasSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "true";
  } catch {
    return true; // storage unavailable — never nag
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "true");
  } catch {
    // ignore
  }
}

export function OnboardingModal() {
  const [open, setOpen] = useState(() => !hasSeen());
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  function dismiss() {
    markSeen();
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center bg-black/40 backdrop-blur-sm",
        isMobile ? "items-end" : "items-center",
      )}
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative max-h-[calc(100dvh-5rem)] overflow-y-auto bg-paper shadow-2xl ring-1 ring-black/10",
          isMobile
            ? "w-[min(100vw,36rem)] rounded-t-3xl px-5 pt-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
            : "w-[min(34rem,calc(100vw-2rem))] rounded-xl p-7",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Common Stacks"
      >
        <button
          onClick={dismiss}
          aria-label="Close"
          className={cn(
            "absolute right-3 top-3 flex items-center justify-center text-ink-soft hover:bg-shelf hover:text-ink",
            isMobile ? "h-11 w-11 rounded-full" : "h-7 w-7 rounded-md",
          )}
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="font-display text-2xl tracking-tight text-ink">
          All your libraries, one shelf
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Common Stacks brings your book catalogs together so you can browse,
          download, and send books anywhere. No accounts, no lock-in.
        </p>

        <div className="mt-6 space-y-5">
          <OnboardingStep
            icon={<LibraryBig className="h-4 w-4" />}
            title="Browse OPDS libraries"
          >
            Anything that speaks OPDS works here: Calibre, Kavita, Mayberry,
            or your own server. Project Gutenberg is on out of the box so the
            shelves aren't empty.
          </OnboardingStep>
          <OnboardingStep
            icon={<Plus className="h-4 w-4" />}
            title="Add your own"
          >
            Head to Settings → Libraries to paste any OPDS feed URL (with
            optional auth), or flip on the pre-configured Mayberry catalog.
          </OnboardingStep>
          <OnboardingStep
            icon={<Send className="h-4 w-4" />}
            title="Send to your device"
          >
            Downloaded books can be delivered straight to a Kindle, a
            CrossPoint reader, or a WebDAV share. Set up send-to targets in
            Settings and a Send button appears on every book.
          </OnboardingStep>
        </div>

        <div
          className={cn(
            "mt-7 flex gap-2",
            isMobile ? "flex-col" : "items-center justify-end",
          )}
        >
          <button
            onClick={() => {
              dismiss();
              navigate("/settings");
            }}
            className={cn(
              "border border-shelf bg-white px-4 text-ink hover:bg-shelf",
              isMobile
                ? "min-h-12 w-full rounded-xl text-base"
                : "rounded-md py-1.5 text-sm",
            )}
          >
            Set up libraries
          </button>
          <button
            onClick={dismiss}
            className={cn(
              "bg-ink px-4 font-medium text-paper hover:bg-ink/90",
              isMobile
                ? "min-h-12 w-full rounded-xl text-base"
                : "rounded-md py-1.5 text-sm",
            )}
          >
            Start browsing
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function OnboardingStep({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-shelf text-ink">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="font-display text-base text-ink">{title}</div>
        <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">
          {children}
        </p>
      </div>
    </div>
  );
}
