import { downloadAndInstall, dismiss, restartApp, useAutoUpdateCheck, useUpdateStatus } from "../lib/updateStore";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function UpdateChecker() {
  useAutoUpdateCheck();
  const status = useUpdateStatus();

  if (status.kind === "idle" || status.kind === "checking" || status.kind === "up-to-date") {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-shelf bg-white shadow-lg">
      <div className="p-4">
        {status.kind === "available" && (
          <>
            <h3 className="font-display text-base">Update available</h3>
            <p className="mt-1 text-xs text-ink-soft">
              Common Stacks {status.version} is ready to install.
            </p>
            {status.notes && (
              <pre className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] text-ink-soft">
                {status.notes}
              </pre>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={dismiss}
                className="rounded-md border border-shelf bg-white px-3 py-1.5 text-xs hover:bg-shelf"
              >
                Later
              </button>
              <button
                onClick={() => void downloadAndInstall()}
                className="rounded-md bg-ink px-3 py-1.5 text-xs text-paper hover:bg-ink/90"
              >
                Install & restart
              </button>
            </div>
          </>
        )}

        {status.kind === "downloading" && (
          <>
            <h3 className="font-display text-base">Downloading update…</h3>
            <p className="mt-1 text-xs text-ink-soft">
              {status.total
                ? `${formatBytes(status.downloaded)} of ${formatBytes(status.total)}`
                : formatBytes(status.downloaded)}
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-shelf">
              <div
                className="h-full bg-ink transition-all"
                style={{
                  width: status.total ? `${Math.min(100, (status.downloaded / status.total) * 100)}%` : "100%",
                }}
              />
            </div>
          </>
        )}

        {status.kind === "installing" && (
          <>
            <h3 className="font-display text-base">Installing…</h3>
            <p className="mt-1 text-xs text-ink-soft">Finishing up the update.</p>
          </>
        )}

        {status.kind === "ready" && (
          <>
            <h3 className="font-display text-base">Update installed</h3>
            <p className="mt-1 text-xs text-ink-soft">Restart Common Stacks to use the new version.</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={dismiss}
                className="rounded-md border border-shelf bg-white px-3 py-1.5 text-xs hover:bg-shelf"
              >
                Later
              </button>
              <button
                onClick={() => void restartApp()}
                className="rounded-md bg-ink px-3 py-1.5 text-xs text-paper hover:bg-ink/90"
              >
                Restart now
              </button>
            </div>
          </>
        )}

        {status.kind === "error" && (
          <>
            <h3 className="font-display text-base">Update failed</h3>
            <p className="mt-1 break-words text-xs text-ink-soft">{status.message}</p>
            <div className="mt-3 flex justify-end">
              <button
                onClick={dismiss}
                className="rounded-md border border-shelf bg-white px-3 py-1.5 text-xs hover:bg-shelf"
              >
                Dismiss
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
