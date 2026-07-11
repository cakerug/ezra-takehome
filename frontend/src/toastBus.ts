/**
 * Tiny module-level pub/sub for app-level error toasts, so code outside React (React Query's
 * `QueryCache.onError`, created when the client is constructed) can surface a toast through the
 * same single `ToastHost` that mutation handlers use. Keeping one channel avoids two competing
 * toast surfaces stacking banners on top of each other.
 */
type ToastListener = (message: string) => void;

const listeners = new Set<ToastListener>();

/** Show an app-level error toast. Called for load failures (query `onError`) and for action
 * failures that aren't field validation (mutation `onError` handlers). */
export function showErrorToast(message: string): void {
  listeners.forEach((listener) => listener(message));
}

export function subscribeToToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
