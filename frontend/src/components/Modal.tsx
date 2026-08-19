import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type ModalVariant = "evidence" | "pipeline";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  variant: ModalVariant;
  /** Rendered in the sticky header beside the title — e.g. a source count or stage summary. */
  headerExtra?: ReactNode;
  children: ReactNode;
}

// `summary` is included because EvidencePanel and TracePanel both collapse detail
// behind <details>, and a trap that skipped those toggles would let Tab escape into
// the inert page behind the backdrop.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // getClientRects() rather than offsetParent: a collapsed <details> hides its
    // content without removing it, and offsetParent also reports null for
    // position:fixed elements that are perfectly focusable.
    (element) => element.getClientRects().length > 0,
  );
}

export function Modal({ open, onClose, title, variant, headerExtra, children }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Only claim focus if a child has not already taken it. Child effects run
    // before parent effects, so opening via a [1] citation lets EvidencePanel
    // focus the cited card first — stealing it back here would undo exactly the
    // navigation the click asked for.
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      dialog.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = dialogRef.current;
      if (!panel) return;
      const focusable = focusableWithin(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Restore the previous inline value rather than blanking it: another modal
    // may already own the lock, and `= ""` would hand scrolling back too early.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      // Deferred to a macrotask, not called inline: closing via backdrop
      // mousedown means this cleanup runs synchronously inside that same
      // mousedown dispatch, before the browser's own default action for the
      // event (blurring whatever is focused, since the backdrop itself is
      // unfocusable) has run. Confirmed by tracing it: an inline focus() call
      // here visibly succeeds, then gets silently overwritten back to <body>
      // moments later once Chromium's default action catches up. A microtask
      // fires too early to beat it — only a macrotask (setTimeout) reliably
      // runs after.
      const target = previousFocusRef.current;
      setTimeout(() => target?.focus(), 0);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    // Closes on mousedown, not click: a selection that starts on a passage inside
    // the panel and releases over the backdrop fires `click` on the backdrop. With
    // onClick the modal would vanish every time someone selected text to the edge.
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={`modal modal-${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2 className="modal-title" id={titleId}>
            {title}
          </h2>
          {headerExtra ? <div className="modal-header-extra">{headerExtra}</div> : null}
          <button className="modal-close" type="button" onClick={onClose} aria-label={`Close ${title}`}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
