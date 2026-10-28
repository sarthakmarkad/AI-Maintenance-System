"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

// A native modal keeps its DOM mounted while closed: uncontrolled fields and
// file selections survive dismissal without storing sensitive drafts elsewhere.
export function FormPopup({
  open,
  onOpenChange,
  title,
  description,
  busy = false,
  children,
  wide = false,
  error,
  errorLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  busy?: boolean;
  children: ReactNode;
  wide?: boolean;
  error?: string;
  errorLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId(),
    descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    const field = dialog.querySelector<HTMLElement>(
      '.form-popup-body input:not(:disabled):not([type="hidden"]), .form-popup-body select:not(:disabled), .form-popup-body textarea:not(:disabled), .form-popup-body button:not(:disabled)',
    );
    field?.focus({ preventScroll: true });
    const body = dialog.querySelector<HTMLElement>(".form-popup-body");
    if (body && field) {
      // Keep the label visible too when restoring a previously scrolled form.
      const row = (field.closest("label") ?? field).getBoundingClientRect();
      const viewport = body.getBoundingClientRect();
      if (row.top < viewport.top + 12)
        body.scrollTop += row.top - viewport.top - 12;
      else if (row.bottom > viewport.bottom - 12)
        body.scrollTop += row.bottom - viewport.bottom + 12;
    }
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={`form-popup ${wide ? "form-popup-wide" : ""}`}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || event.defaultPrevented) return;
        const fields = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (field) => field.tabIndex >= 0 && field.getClientRects().length > 0,
        );
        const first = fields[0],
          last = fields.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onOpenChange(false);
      }}
    >
      <header className="form-popup-heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button
          type="button"
          className="form-popup-close"
          aria-label="Close form"
          disabled={busy}
          onClick={() => onOpenChange(false)}
        >
          <X size={19} />
        </button>
      </header>
      <div className="form-popup-body">
        {error && (
          <p className="inline-error" role="alert" aria-label={errorLabel}>
            {error}
          </p>
        )}
        {children}
      </div>
      <footer className="form-popup-footer">
        <span>
          {busy
            ? "Saving — please wait…"
            : "Unfinished entries stay here until you leave this page."}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => onOpenChange(false)}
        >
          Close
        </button>
      </footer>
    </dialog>
  );
}
