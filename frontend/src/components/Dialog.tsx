import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Generic modal overlay for arbitrary content (as opposed to `ConfirmDialog`, which is
 * specifically a title/message/confirm-cancel prompt). Shares the same overlay/escape/focus
 * conventions so dialogs across the app behave consistently.
 */
export interface DialogProps {
  /** Visible heading. Omit for dialogs whose content supplies its own heading (e.g. the task
   * detail view, whose title is an editable field in the body) -- pass `ariaLabel` instead so the
   * dialog still has an accessible name. */
  title?: string;
  /** Accessible name used when there's no visible `title`. Ignored when `title` is set. */
  ariaLabel?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ title, ariaLabel, onClose, children }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Portaled to <body> rather than rendered in place: some callers (e.g. TaskDetailDialog) open
  // this from inside a draggable row that has its own pointer/keyboard listeners for dnd-kit --
  // without a portal, keystrokes typed into this dialog's fields would bubble through that row's
  // DOM subtree and could be intercepted by those listeners (e.g. Space being read as "pick up").
  //
  // The portal only reparents the *DOM*, though -- React synthetic events still bubble through the
  // React component tree, so a pointerdown inside the dialog (e.g. dragging the textarea's resize
  // handle) would otherwise reach the ancestor row's dnd-kit `onPointerDown` and start dragging the
  // row behind the dialog. Stopping pointer/keydown propagation at the dialog root keeps all input
  // contained to the modal.
  return createPortal(
    <div className="dialog__overlay" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'dialog-title' : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {title && (
          <h2 id="dialog-title" className="dialog__title">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
