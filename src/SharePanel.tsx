import { useEffect, useRef, useState } from "react";
import { api, shareUrl } from "./api";

/** Lucide "share" icon. */
const ShareIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 2v13" />
    <path d="m16 6-4-4-4 4" />
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
  </svg>
);

/** The editor's Share button: create, copy or revoke the drawing's view-only link. */
export function SharePanel({ drawingId }: { drawingId: string }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null | undefined>(undefined); // undefined: not loaded yet
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on Escape or on any press outside the popover and its button. Captured,
  // so presses on the canvas count even though Excalidraw handles them itself.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popoverRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    };
  }, [open]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(t));
      setCopied(true);
    } catch {
      // Clipboard blocked: the link stays selectable in the input.
    }
  };

  const toggle = () => {
    if (open) return setOpen(false);
    setOpen(true);
    setCopied(false);
    run(async () => setToken((await api.getShare(drawingId)).token));
  };

  const create = () =>
    run(async () => {
      const { token } = await api.createShare(drawingId);
      setToken(token);
      await copy(token);
    });

  const revoke = () => {
    if (!confirm("Stop sharing? The link will stop working for everyone who has it.")) return;
    run(async () => {
      await api.deleteShare(drawingId);
      setToken(null);
      setCopied(false);
    });
  };

  return (
    <>
      <button
        ref={buttonRef}
        className="icon-button"
        onClick={toggle}
        aria-expanded={open}
        aria-label="Share"
        title="Share"
      >
        <ShareIcon />
      </button>
      {open && (
        <div ref={popoverRef} className="share-popover" role="dialog" aria-label="Share drawing">
          {token === undefined && !error && <p className="muted">Loading…</p>}
          {token === null && (
            <>
              <p>Create a link that lets anyone view this drawing, read-only, without signing in.</p>
              <button className="primary" disabled={busy} onClick={create}>
                Create view-only link
              </button>
            </>
          )}
          {token && (
            <>
              <p>
                Anyone with this link can view the drawing, read-only. They see your changes when they press Refresh.
              </p>
              <input readOnly value={shareUrl(token)} onFocus={(e) => e.target.select()} aria-label="Share link" />
              <div className="share-actions">
                <button className="primary" onClick={() => copy(token)}>
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button className="danger" disabled={busy} onClick={revoke}>
                  Stop sharing
                </button>
              </div>
            </>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </>
  );
}
