import { useEffect, useState } from 'react';
import { subscribeToToasts, type Toast } from '../toastBus';

const AUTO_DISMISS_MS = 5000;

/**
 * Single app-level host for toasts. Subscribes to the toast bus and renders the most recent one
 * as a dismissible banner -- it auto-dismisses after a few seconds, or the user can dismiss it
 * manually; a newer toast replaces the previous one so only one banner is ever shown. Mounted once
 * at the root (main.tsx) alongside the app, so a load failure (via React Query's `queryCache`), an
 * action failure (via a mutation handler), or a success toast all surface here.
 */
export function ToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => subscribeToToasts(setToast), []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) {
    return null;
  }

  return (
    <div
      className={toast.variant === 'success' ? 'toast toast--success' : 'toast'}
      // Success toasts are informational, not urgent -- "status" doesn't interrupt screen readers
      // the way "alert" does.
      role={toast.variant === 'success' ? 'status' : 'alert'}
    >
      <p className="toast__message">{toast.message}</p>
      <button
        type="button"
        className="toast__dismiss"
        onClick={() => setToast(null)}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
