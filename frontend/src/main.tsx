/**
 * react-query is a simple way to make API requests because the data flow paradigm is
 * simple and it is fairly lightweight, and flexible enough for most situations.
 * The trade off it makes is redundant fetches (though that can be tuned with staleTime,
 * we don't do that because it makes it easier to reason about data flow e.g., when
 * altering data between tabs).
 * The pattern I use for mutations also incurs a bit of unnecessary latency when I
 * invalidate the cache and re-fetch but it's *still fast* so the trade-off for data flow
 * simplicity / declarative data flow is worth it.
 * We can do optimistic writes with onMutate or remove one round trip with setQueryData
 * at the cost of additional complexity.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { toToastMessage } from './api/errors.ts'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { ToastHost } from './components/ToastHost.tsx'
import { showErrorToast } from './toastBus.ts'

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // A failed query (initial load or refetch) surfaces as a dismissible toast, leaving the rest
    // of the app interactive -- rather than throwing to a full-screen error page. Fires once per
    // errored query, so the components that share the ['projects'] query don't each toast.
    onError: (error) => showErrorToast(toToastMessage(error)),
  }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Last-resort net for render-time crashes (bugs) only -- load failures are handled by the
          queryCache onError above, not here. */}
      <ErrorBoundary onReset={() => window.location.reload()}>
        <App />
      </ErrorBoundary>
      <ToastHost />
    </QueryClientProvider>
  </StrictMode>,
)
