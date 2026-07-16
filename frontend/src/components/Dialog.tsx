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

  // Portaled to <body> for layering: the overlay must escape any ancestor `overflow`, `transform`,
  // or z-index/stacking context (e.g. the scrollable task list, a draggable row) so it reliably
  // covers the viewport and sits above everything. The portal does *not* address dnd-kit
  // interference -- React synthetic events bubble through the component tree no matter where the DOM
  // lives, so a portaled dialog opened from inside a draggable row would still feed pointer/key
  // events to that row's dnd-kit activators.
  //
  // Containing that interference is what the `stopPropagation` handlers below do, and it's the
  // load-bearing part: dnd-kit's pointer and keyboard activators are *synthetic* listeners
  // (`onPointerDown` / `onKeyDown` spread onto the row), so stopping those synthetic events at the
  // dialog root is what prevents e.g. a drag on the textarea's resize handle from starting a row
  // drag, or Space in a field being read as "pick up" -- independent of the portal.
  //
  // Escape is handled here on the dialog root rather than via a document-level listener: the
  // keydown `stopPropagation` below (needed for the dnd containment above) also halts the *native*
  // event, so a document listener would never see it. Handling it locally also makes nesting work
  // -- a child modal (ConfirmDialog / ActionMenu) that stops Escape from bubbling cancels itself
  // without also closing the dialog behind it.
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
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose();
          }
          event.stopPropagation();
        }}
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
