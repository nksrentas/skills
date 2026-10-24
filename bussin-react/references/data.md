# Data: server components and TanStack Query

## One query client per request, one per browser tab

`src/shared/query/query-client.ts`:

```ts
import { QueryClient, isServer } from '@tanstack/react-query'

const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 },
    },
  })

let browserClient: QueryClient | undefined

export const getQueryClient = () => {
  if (isServer) return makeQueryClient()
  browserClient ??= makeQueryClient()
  return browserClient
}
```

`src/shared/query/query-provider.tsx`, rendered once in the root layout around `{children}`:

```tsx
'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { getQueryClient } from './query-client'

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>
}
```

A server never shares a client between requests, because one user's data would leak into another's cache.

## A feature's hooks file

`invoice.hooks.ts` owns the keys and the query definitions, so every component and mutation agrees on them:

```ts
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchInvoice, fetchInvoices } from './invoice.api'
import { markInvoicePaidAction } from './invoice.actions'
import type { InvoiceFilters, InvoiceRow } from './invoice.dto'

export const invoiceKeys = {
  all: ['invoices'] as const,
  lists: () => [...invoiceKeys.all, 'list'] as const,
  list: (filters: InvoiceFilters) => [...invoiceKeys.lists(), filters] as const,
  detail: (id: string) => [...invoiceKeys.all, 'detail', id] as const,
}

export const invoiceQueries = {
  list: (filters: InvoiceFilters) => queryOptions({ queryKey: invoiceKeys.list(filters), queryFn: () => fetchInvoices(filters) }),
  detail: (id: string) => queryOptions({ queryKey: invoiceKeys.detail(id), queryFn: () => fetchInvoice(id) }),
}

export const useInvoices = (filters: InvoiceFilters, initialData?: InvoiceRow[]) =>
  useQuery({ ...invoiceQueries.list(filters), initialData })

export const useMarkInvoicePaid = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markInvoicePaidAction,
    onSuccess: (_result, id) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: invoiceKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(id) }),
      ]),
  })
}
```

## Seeding the cache from the server

The page loads data once on the server through the service, and the client component takes over from there:

```tsx
import 'server-only'
import { getKernel } from '@/shared/kernel'
import { currentUser } from '@/shared/auth'
import { listInvoices } from './invoice.service'
import { InvoiceList } from './components/invoice-list'

export async function InvoicesPage() {
  const deps = getKernel()
  const user = await currentUser(deps)
  const invoices = await listInvoices(deps, user, { status: 'open' })
  return <InvoiceList initialInvoices={invoices} />
}
```

```tsx
'use client'

export function InvoiceList({ initialInvoices }: { initialInvoices: InvoiceRow[] }) {
  const invoices = useInvoices({ status: 'open' }, initialInvoices)
  if (invoices.isError) return <ErrorState onRetry={() => invoices.refetch()} />
  if (invoices.data.length === 0) return <EmptyState action={<NewInvoiceButton />} />
  return <InvoiceTable rows={invoices.data}>…</InvoiceTable>
}
```

Pages that prefetch several queries can use `dehydrate` and `<HydrationBoundary>` instead. Their `queryFn`s must then work on the server too, so they call the service rather than the HTTP API.

## Optimistic updates, only where waiting feels broken

```ts
export const useToggleInvoiceStar = (filters: InvoiceFilters) => {
  const queryClient = useQueryClient()
  const key = invoiceKeys.list(filters)
  return useMutation({
    mutationFn: toggleInvoiceStarAction,
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<InvoiceRow[]>(key)
      queryClient.setQueryData<InvoiceRow[]>(key, rows => rows?.map(row => (row.id === id ? { ...row, starred: !row.starred } : row)))
      return { previous }
    },
    onError: (_error, _id, context) => queryClient.setQueryData(key, context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}
```

The cache update builds new arrays and objects; it never mutates the cached ones.

## Other cases

- **Dependent queries** wait with `enabled: Boolean(customerId)`.
- **Derived data** comes from `select` on the query, not from a second piece of state.
- **Infinite lists** use `useInfiniteQuery` with a server cursor. For long lists, add TanStack Virtual.
- **Polling** uses `refetchInterval` while something is pending, and stops once it settles.
- **Suspense:** `useSuspenseQuery` inside a `Suspense` boundary and an error boundary removes the loading and error branches from the component. Use it where the page already streams.
