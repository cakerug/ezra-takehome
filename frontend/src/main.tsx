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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
