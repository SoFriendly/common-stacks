import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, Loader2, X } from "lucide-react";
import type { SendProgress, SendTargetInfo } from "../lib/api";
import { cn } from "../lib/utils";
import { useIsMobile } from "../lib/platform";

export type SendModalState =
  | {
      kind: "sending";
      target: SendTargetInfo;
      title: string;
      steps: SendProgress[];
    }
  | { kind: "done"; target: SendTargetInfo; title: string; message: string; steps: SendProgress[] }
  | { kind: "error"; target: SendTargetInfo; title: string; message: string; steps: SendProgress[] };

interface Props {
  state: SendModalState | null;
  onClose: () => void;
}

export function SendProgressModal({ state, onClose }: Props) {
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && state?.kind !== "sending") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onClose]);

  if (!state) return null;

  const isSending = state.kind === "sending";
  const latest = state.steps[state.steps.length - 1];
  const percent =
    latest && latest.total && latest.total > 0 && latest.current !== undefined
      ? Math.round((latest.current / latest.total) * 100)
      : null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center bg-black/40 backdrop-blur-sm",
        isMobile ? "items-end" : "items-center",
      )}
      onClick={() => {
        if (!isSending) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative max-h-[calc(100dvh-5rem)] overflow-y-auto bg-paper shadow-2xl ring-1 ring-black/10",
          isMobile
            ? "w-[min(100vw,36rem)] rounded-t-3xl px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
            : "w-[min(32rem,calc(100vw-2rem))] rounded-xl p-6",
        )}
        role="dialog"
        aria-modal="true"
      >
        {!isSending && (
          <button
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "absolute right-3 top-3 flex items-center justify-center text-ink-soft hover:bg-shelf hover:text-ink",
              isMobile ? "h-11 w-11 rounded-full" : "h-7 w-7 rounded-md",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="flex items-start gap-4">
          <div className="mt-0.5 shrink-0">
            {state.kind === "sending" && (
              <Loader2 className="h-6 w-6 animate-spin text-ink-soft" />
            )}
            {state.kind === "done" && (
              <CheckCircle2 className="h-6 w-6 text-green-700" />
            )}
            {state.kind === "error" && (
              <AlertTriangle className="h-6 w-6 text-red-700" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg text-ink">
              {state.kind === "sending" && "Sending…"}
              {state.kind === "done" && "Delivered"}
              {state.kind === "error" && "Send failed"}
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              <span className="text-ink">{state.title}</span>
              <span className="text-ink-soft"> → </span>
              <span>{state.target.descriptor.name}</span>
            </p>
            {state.kind !== "sending" && state.message && (
              <p
                className={`mt-3 break-words text-sm leading-relaxed ${
                  state.kind === "error" ? "text-red-700" : "text-ink-soft"
                }`}
              >
                {state.message}
              </p>
            )}
          </div>
        </div>

        {state.steps.length > 0 && (
          <div className="mt-5">
            {/* Progress bar — only when latest step has total. */}
            {percent !== null && isSending && (
              <div className="mb-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-shelf">
                  <div
                    className="h-full bg-ink transition-[width]"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="mt-1 text-right text-[10px] text-ink-soft">{percent}%</div>
              </div>
            )}
            <ol className="max-h-48 space-y-1 overflow-auto text-xs">
              {state.steps.map((s, i) => {
                const last = i === state.steps.length - 1;
                return (
                  <li
                    key={i}
                    className={`flex items-baseline gap-2 ${
                      last && isSending ? "text-ink" : "text-ink-soft"
                    }`}
                  >
                    <span
                      className={`inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${
                        last && isSending ? "bg-ink animate-pulse" : "bg-spine"
                      }`}
                    />
                    <span className="min-w-0 break-words">{s.message}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {!isSending && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className={cn(
                "bg-ink px-4 font-medium text-paper",
                isMobile
                  ? "min-h-12 w-full rounded-xl text-base"
                  : "w-auto rounded-md py-1.5 text-sm",
              )}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
