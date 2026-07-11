import { useEffect, useRef } from 'react';

/**
 * Generic confirmation dialog, not tied to any particular entity type. Callers supply the
 * copy (`title`/`message`) and the `onConfirm`/`onCancel` handlers; this component only
 * handles presentation. Rendered as a native `<dialog>`-style modal via a fixed overlay so it
 * doesn't depend on the `<dialog>` element's imperative `showModal()` API (simpler to test with
 * Testing Library, which otherwise needs jsdom polyfills for `<dialog>`).
 *
 * Keyboard behavior: focus moves to the (non-destructive) Cancel button on open, and Escape
 * dismisses the dialog -- the two things a keyboard user instinctively expects from a modal
 * confirmation. A full focus trap is intentionally out of scope for this MVP (noted in the
 * README's trade-offs).
 *
 * Purely presentational: a failed confirm action is surfaced by the caller (via the shared
 * `Toast`), and the caller keeps the dialog open for retry by not unmounting it. Intended to be
 * reused across entity types (project and task deletion) -- keep this agnostic.
 */
export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Disables both actions and can be used to show a pending state while a mutation is in flight. */
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isConfirming = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isConfirming) {
        onCancel();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isConfirming, onCancel]);

  return (
    <div className="confirm-dialog__overlay" role="presentation" onClick={onCancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="confirm-dialog__title">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="confirm-dialog__message">
          {message}
        </p>
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="btn btn--secondary"
            ref={cancelButtonRef}
            onClick={onCancel}
            disabled={isConfirming}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
