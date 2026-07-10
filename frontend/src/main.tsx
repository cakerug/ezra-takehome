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
import { QueryClient, QueryClientProvider, QueryErrorResetBoundary } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    // Failed queries throw during render instead of each component hand-rolling isError UI;
    // caught by the single ErrorBoundary below. Mutations are unaffected (still resolve their
    // own onError) -- a failed "Add task" should show a message next to the form, not blow away
    // the page.
    queries: { throwOnError: true },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <QueryErrorResetBoundary>
        {({ reset }) => (
          <ErrorBoundary onReset={reset}>
            <App />
          </ErrorBoundary>
        )}
      </QueryErrorResetBoundary>
    </QueryClientProvider>
  </StrictMode>,
)
