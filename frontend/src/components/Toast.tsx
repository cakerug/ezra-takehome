import { useEffect } from 'react';

/**
 * Small, generic, reusable toast/banner for surfacing a transient message (typically a mutation
 * failure). Deliberately project/task-agnostic -- U8 uses it for task mutation failures, and U9
 * can reuse it as-is for its own non-validation-error cases without rebuilding it.
 *
 * Per the plan's pessimistic-update rule, failed mutations must not silently fail or change the
 * list; this is the surface that tells the user something went wrong while leaving the
 * underlying view untouched.
 */
export interface ToastProps {
  message: string;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. Defaults to 5000; pass 0 to disable auto-dismiss. */
  autoDismissMs?: number;
}

export function Toast({ message, onDismiss, autoDismissMs = 5000 }: ToastProps) {
  useEffect(() => {
    if (autoDismissMs <= 0) {
      return;
    }
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [message, autoDismissMs, onDismiss]);

  return (
    <div className="toast" role="alert">
      <p className="toast__message">{message}</p>
      <button
        type="button"
        className="toast__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
