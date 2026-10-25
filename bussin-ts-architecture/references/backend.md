# Backend features: Hono and Next.js route handlers

Two backends in the house: a Hono server, and Next.js route handlers and server actions inside the app. Both use the same feature folder. Only the thin edge differs: a Hono sub-app, or a Next.js route file. Everything below the controller (service, DTOs, schema, jobs, ports, tests) is identical, so a feature built on one backend moves to the other by rewriting one file.

## Hono

### Kernel and composition root

`src/shared/kernel.ts` types the app once, so every feature's routes share it:

```ts
import { Hono } from 'hono'
import type { Db } from './db'
import type { Logger } from './logger'
import type { EventBus } from './events'

export type CurrentUser = { id: string; role: 'member' | 'admin' }

export type KernelDeps = { db: Db; env: Env; logger: Logger; events: EventBus }

export type AppEnv = { Variables: { user: CurrentUser | null } }

export type App = Hono<AppEnv>

export const createApp = (): App => new Hono<AppEnv>()
```

`src/shared/http.ts` turns the shared typed errors into responses once, so controllers never pick status codes:

```ts
import type { ErrorHandler } from 'hono'
import { ZodError } from 'zod'
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from './errors'
import type { Logger } from './logger'

export const errorHandler =
  (logger: Logger): ErrorHandler =>
  (error, c) => {
    if (error instanceof ZodError || error instanceof ValidationError) return c.json({ error: 'Invalid input' }, 400)
    if (error instanceof UnauthorizedError) return c.json({ error: 'Sign in first' }, 401)
    if (error instanceof ForbiddenError) return c.json({ error: 'Forbidden' }, 403)
    if (error instanceof NotFoundError) return c.json({ error: error.message }, 404)
    if (error instanceof ConflictError) return c.json({ error: error.message }, 409)
    logger.error({ error, path: c.req.path }, 'unhandled error')
    return c.json({ error: 'Internal error' }, 500)
  }
```

`src/app.ts` is the only file that sees more than one feature:

```ts
import { createApp } from './shared/kernel'
import { errorHandler } from './shared/http'
import { authenticate } from './shared/auth'
import { register as registerCustomers, findCustomerName } from './features/customers'
import { register as registerInvoices } from './features/invoices'

export const buildApp = (kernel: KernelDeps) => {
  const app = createApp()
  app.use('*', authenticate(kernel))
  app.onError(errorHandler(kernel.logger))
  registerCustomers(app, kernel)
  registerInvoices(app, { ...kernel, customers: { findName: id => findCustomerName(kernel, id) } })
  return app
}
```

### The feature edge

`invoice.controller.ts` returns a sub-app. Validation uses the DTO schema through `@hono/zod-validator`, so a bad body never reaches the service:

```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AppEnv } from '@/shared/kernel'
import { requireUser } from '@/shared/auth'
import { createInvoiceDto, invoiceIdParams } from './invoice.dto'
import { createInvoice, getInvoice } from './invoice.service'
import type { InvoiceDeps } from './index'

export const invoiceController = (deps: InvoiceDeps) =>
  new Hono<AppEnv>()
    .post('/', zValidator('json', createInvoiceDto), async c => {
      const user = requireUser(c)
      const invoice = await createInvoice(deps, user, c.req.valid('json'))
      return c.json(invoice, 201)
    })
    .get('/:id', zValidator('param', invoiceIdParams), async c => {
      const user = requireUser(c)
      return c.json(await getInvoice(deps, user, c.req.valid('param').id))
    })
```

`index.ts` registers it:

```ts
export type InvoiceDeps = KernelDeps & { customers: CustomerDirectory }

export function register(app: App, deps: InvoiceDeps) {
  app.route('/invoices', invoiceController(deps))
  deps.events.on('payment.settled', payload => markPaid(deps, paymentSettledDto.parse(payload)))
}
```

The service receives the current user and checks ownership itself (`invoice.customerId` belongs to the user's account), so no route can skip the check.

### Typed client for the frontend

When a React feature calls this API, keep the route chain in one expression, as above, and export its type. The frontend `invoice.api.ts` in the same feature folder uses Hono's RPC client, so request and response types follow the server without a hand-written twin:

```ts
import { hc } from 'hono/client'
import type { invoiceController } from './invoice.controller'

const client = hc<ReturnType<typeof invoiceController>>('/api/invoices')

export const fetchInvoice = async (id: string) => {
  const response = await client[':id'].$get({ param: { id } })
  if (!response.ok) throw new Error(`Invoice ${id}: ${response.status}`)
  return response.json()
}
```

`import type` keeps server code out of the client bundle.

### Tests

Service tests stay the main suite. Controller tests go through `app.request`, with no server and no port:

```ts
const app = buildApp(testKernel)
const response = await app.request('/invoices', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${memberToken}` },
  body: JSON.stringify({ customerId: 'not-a-uuid', lines: [] }),
})
expect(response.status).toBe(400)
```

## Next.js route handlers and server actions

Next.js never runs `src/app.ts`, so a feature gets its dependencies from `getKernel()` in server entry points, and routes live in `src/app/`.

### Route handlers

The feature owns the handlers in `<feature>.routes.ts`. The route file only re-exports them, so it stays app shell and the handlers move with the folder:

```ts
// src/features/invoices/invoice.routes.ts
import 'server-only'
import { getKernel } from '@/shared/kernel'
import { currentUser } from '@/shared/auth'
import { toResponse } from '@/shared/http'
import { createInvoiceDto, invoiceIdParams } from './invoice.dto'
import { createInvoice, getInvoice } from './invoice.service'

export async function POST(request: Request) {
  return toResponse(async () => {
    const deps = getKernel()
    const user = await currentUser(deps)
    const body = createInvoiceDto.parse(await request.json())
    return Response.json(await createInvoice(deps, user, body), { status: 201 })
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return toResponse(async () => {
    const deps = getKernel()
    const user = await currentUser(deps)
    const { id } = invoiceIdParams.parse(await params)
    return Response.json(await getInvoice(deps, user, id))
  })
}
```

```ts
// src/app/api/invoices/route.ts
export { POST } from '@/features/invoices/invoice.routes'

// src/app/api/invoices/[id]/route.ts
export { GET } from '@/features/invoices/invoice.routes'
```

`currentUser` throws the shared `UnauthorizedError` when nobody is signed in. `toResponse` in `src/shared/http.ts` maps the shared errors and zod failures to status codes, with the same table as the Hono `errorHandler`. Error bodies never echo stack traces or internal messages.

### Server actions

A server action is a public POST endpoint, whatever the button that calls it looks like. It authenticates, validates and authorizes exactly like a route handler:

```ts
// src/features/invoices/invoice.actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { getKernel } from '@/shared/kernel'
import { currentUser } from '@/shared/auth'
import { createInvoiceDto } from './invoice.dto'
import { createInvoice } from './invoice.service'

export async function createInvoiceAction(input: unknown) {
  const deps = getKernel()
  const user = await currentUser(deps)
  const invoice = await createInvoice(deps, user, createInvoiceDto.parse(input))
  revalidatePath('/billing/invoices')
  return { id: invoice.id }
}
```

It returns only what the client needs, never a database row.

### Hono inside Next.js

To run a Hono API inside a Next.js app, mount it on one catch-all route and keep the Hono features unchanged:

```ts
// src/app/api/[[...route]]/route.ts
import { handle } from 'hono/vercel'
import { buildApp } from '@/app'
import { getKernel } from '@/shared/kernel'

const app = buildApp(getKernel()).basePath('/api')

export const GET = handle(app)
export const POST = handle(app)
export const PATCH = handle(app)
export const DELETE = handle(app)
```

## Moving a feature to another project

1. Copy `src/features/<feature>/` as it is.
2. Check that the target's `src/shared/` provides what the feature imports from it (kernel types, errors, http helpers, `ui/`). Add any missing kernel piece to `shared/`, never inside the feature.
3. Wire it:
   - **Hono:** add the `register` call in `src/app.ts`, passing an implementation for each port it declares.
   - **Next.js:** add the thin files under `src/app/` that re-export its routes or render its page, plus the navigation entry.
4. Add the settings its `<feature>.config.ts` schema reads to the target's environment.
5. Generate migrations in the target from the feature's schema (`drizzle-kit generate`); migrations are never copied.
6. Run the boundary check and the feature's own tests in the target. Both must pass before anything else changes.

A feature that needs an edit inside its own folder to work in the new project has a hidden dependency. Fix that in the source project first: turn it into a port or a kernel dependency.
