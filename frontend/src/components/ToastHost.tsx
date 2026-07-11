import { useEffect, useState } from 'react';
import { subscribeToToasts } from '../toastBus';

const AUTO_DISMISS_MS = 5000;

/**
 * Single app-level host for error toasts. Subscribes to the toast bus and renders the most recent
 * message as a dismissible banner -- it auto-dismisses after a few seconds, or the user can
 * dismiss it manually; a newer toast replaces the previous one so only one banner is ever shown.
 * Mounted once at the root (main.tsx) alongside the app, so a load failure (via React Query's
 * `queryCache`) or an action failure (via a mutation handler) both surface here.
 */
export function ToastHost() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => subscribeToToasts(setMessage), []);

  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = setTimeout(() => setMessage(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) {
    return null;
  }

  return (
    <div className="toast" role="alert">
      <p className="toast__message">{message}</p>
      <button
        type="button"
        className="toast__dismiss"
        onClick={() => setMessage(null)}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
