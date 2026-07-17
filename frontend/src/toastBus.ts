/**
 * Tiny module-level pub/sub for app-level toasts, so code outside React (React Query's
 * `QueryCache.onError`, created when the client is constructed) can surface a toast through the
 * same single `ToastHost` that mutation handlers use. Keeping one channel avoids two competing
 * toast surfaces stacking banners on top of each other.
 */
export type Toast = { message: string; variant: 'error' | 'success' };
type ToastListener = (toast: Toast) => void;

const listeners = new Set<ToastListener>();

function emit(toast: Toast): void {
  listeners.forEach((listener) => listener(toast));
}

/** Show an app-level error toast. Called for load failures (query `onError`) and for action
 * failures that aren't field validation (mutation `onError` handlers). */
export function showErrorToast(message: string): void {
  emit({ message, variant: 'error' });
}

/** Show an app-level success toast, for actions whose result isn't otherwise visible on screen
 * (e.g. completing a task, which the "Save" button's own pending/success state doesn't cover). */
export function showSuccessToast(message: string): void {
  emit({ message, variant: 'success' });
}

export function subscribeToToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
