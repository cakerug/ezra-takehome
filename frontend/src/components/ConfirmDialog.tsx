/**
 * Generic confirmation dialog, not tied to any particular entity type. Callers supply the
 * copy (`title`/`message`) and the `onConfirm`/`onCancel` handlers; this component only
 * handles presentation. Rendered as a native `<dialog>`-style modal via a fixed overlay so it
 * doesn't depend on the `<dialog>` element's imperative `showModal()` API (simpler to test with
 * Testing Library, which otherwise needs jsdom polyfills for `<dialog>`).
 *
 * Intended to be reused by later units (e.g. task delete confirmation) -- keep this
 * project/task-agnostic.
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
          <button type="button" onClick={onCancel} disabled={isConfirming}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-dialog__confirm"
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
