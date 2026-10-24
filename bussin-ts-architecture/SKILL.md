---
name: bussin-ts-architecture
description: House architecture for TypeScript apps - feature folders that own their controller, service, DTOs, jobs, schema and UI, each portable to another project after one registration step. Use whenever writing or reviewing TypeScript server or React code, adding an endpoint, page, job or domain area, scaffolding a TS app, deciding where a file goes, splitting a controller from business logic, or wiring two features together.
argument-hint: "[feature to place or wiring question]"
---

# TypeScript feature architecture

Code is grouped by what it does for the product, not by what kind of file it is. A reader looking for "invoices" opens one folder and finds everything: how requests arrive, what rules apply, what shapes go in and out, what runs in the background, what the user sees. And because the folder holds everything, it can be lifted out whole.

## The portability rule

This is the one hard rule; the rest of the skill serves it.

**A feature folder keeps working when it is copied into another project that follows this layout.** The only edits outside the folder are app-shell wiring: one `register` call in the composition root (`src/app.ts`) for backend features, and for a Next.js page a thin route file under `src/app/` plus its navigation entry.

A feature imports only:

- files inside its own folder,
- npm packages,
- `src/shared/`, the kernel every project provides.

It never imports another feature, not even through that feature's `index.ts`. On a backend, features that need each other talk in one of two ways (Next.js adds a third, below):

- **Events**, for "this happened". The emitter publishes on `deps.events`. Each listener declares its own DTO for the payload and parses it, so it imports nothing from the emitter and survives the emitter being absent.
- **Ports**, for "I need this now". The feature declares the interface it needs in `<feature>.ports.ts`, and the composition root passes an implementation in at registration, usually a function from another feature's service.

`invoice.ports.ts` declares what invoices needs:

```ts
export type CustomerDirectory = {
  findName(customerId: string): Promise<string | null>
}
```

`index.ts` takes it alongside the kernel:

```ts
export function register(app: App, deps: KernelDeps & { customers: CustomerDirectory }) {
  app.route('/invoices', invoiceController(deps))
  deps.events.on('payment.settled', (payload) => markPaid(deps, payload))
}
```

`app.ts` is the only file that sees both features:

```ts
registerCustomers(app, kernel)
registerInvoices(app, { ...kernel, customers: { findName: (id) => findCustomerName(kernel, id) } })
```

Dependencies come in; a feature never creates or imports infrastructure instances. On a backend, `register(app, deps)` receives them. Service functions take `deps`, or the part they use, as their first argument, so tests pass in a test database or a transaction.

### Next.js features

Next.js renders route files directly and never runs `src/app.ts` first, so two things change:

- Server entry points inside the feature (server components, server actions, route handlers) get the kernel from `getKernel()` in `src/shared/kernel.ts`, a lazy singleton, and pass it on to service functions as `deps`. That is the only call a feature makes to obtain dependencies, and it goes to the kernel, never to another feature.
- Features meet in the route file instead of through ports. The route file is app shell, so it may import the page components of several features and compose them with props and children: a dashboard page renders `<RevenueChart />` from one feature next to `<OpenInvoices />` from another, and data one feature needs from another is passed down as props. Writes that affect another feature still go through events.

Route files import the feature's page component file (`invoices-page.tsx`) directly. `index.ts` is the server-side wiring and stays out of client bundles.

### The kernel: `src/shared/`

Infrastructure with the same shape in every project, and nothing else:

| File | Provides |
|---|---|
| `kernel.ts` | The `App` and `KernelDeps` types (`db`, `env`, `logger`, `events`, `auth` for the current user) and `getKernel()` |
| `db.ts` | Creates the database client (see `bussin-drizzle`) and exports its type |
| `errors.ts` | `NotFoundError`, `ConflictError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError` |
| `http.ts` | Request and response helpers for the project's framework |
| `config.ts` | Reads and validates the environment the kernel needs |
| `ui/`, `motion/` | The `bussin-ui` component kit, in apps with a frontend |

`shared/` never imports a feature and never holds product logic. If two features need the same business rule, that rule is a feature of its own, reached through a port. Duplicating a ten-line helper is cheaper than coupling two features to it.

A feature's own settings are parsed by a schema in `<feature>.config.ts` from `deps.env`, so the kernel's config never learns feature names.

### What the folder owns

Everything the feature needs to run: controller, services, DTOs, jobs and event listeners, database schema, ports, UI components and hooks, tests and fixtures. Generated migrations are the exception, because they are the target project's history: after copying a feature in, run the migration generator there.

### Proving it

An import-boundary check fails the build when a feature reaches outside its folder. With dependency-cruiser, in `.dependency-cruiser.cjs`:

```js
module.exports = {
  forbidden: [
    {
      name: 'feature-imports-outside-its-folder',
      severity: 'error',
      from: { path: '^src/features/([^/]+)/' },
      to: { path: '^src/', pathNot: '^src/(features/$1|shared)/' }
    },
    {
      name: 'shared-imports-a-feature',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/features/' }
    }
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' }
  }
}
```

`tsConfig` makes path aliases such as `@/features/...` resolve, so they cannot slip past the rule.

Run `depcruise src --config .dependency-cruiser.cjs` in the lint script and CI; it exits non-zero on a violation. dependency-cruiser reads TypeScript through the `typescript` package and, as of version 18, does not support TypeScript 7: it then reports "0 modules cruised" and passes. Check that the module count is non-zero, and pin a supported `typescript` version for the check if the project is on 7. If the project already enforces boundaries another way (eslint-plugin-boundaries, Nx tags), express the same two rules there instead of adding a second tool.

### Backends: Hono and Next.js route handlers

[references/backend.md](references/backend.md) shows the same feature on both house backends: a Hono sub-app registered in `src/app.ts` with `@hono/zod-validator` and a typed `hc` client for the frontend, and Next.js route handlers and server actions that the feature owns and thin route files re-export. It also has a checklist for moving a feature into another project. Read it before adding an endpoint, a server action or a new backend.

For React components, client state, TanStack Query, shadcn/ui, performance and security in the UI layer, load `bussin-react`.

## Layout

A backend feature:

```
src/
  features/
    invoices/
      index.ts
      invoice.controller.ts
      invoice.service.ts
      invoice.dto.ts
      invoice.job.ts
      invoice.schema.ts
      invoice.ports.ts
      invoice.service.test.ts
  shared/
  app.ts
```

A frontend feature in a Next.js app, where `src/app/billing/invoices/page.tsx` only renders `InvoicesPage` from the feature:

```
src/
  app/
    billing/invoices/page.tsx
  features/
    invoices/
      index.ts
      invoice.api.ts
      invoice.dto.ts
      invoice.hooks.ts
      invoices-page.tsx
      components/
        invoice-list.tsx
```

File names are kebab-case with a role suffix: `<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.dto.ts`. A feature with several resources uses one file per resource and role (`invoice-line.service.ts`). A role the feature does not need has no file; never create an empty one or a layer that only forwards arguments. Keep nesting to three directories or fewer below the feature root (`components/forms/fields/` is the limit) and prefer a few cohesive files over one file per function.

## Roles

**`index.ts`** exports `register(app, deps)` and the functions the composition root wires into other features' ports. Only the composition root reads it; Next.js route files import page components directly.

**Controller** is the HTTP edge and stays thin. It parses the request with the DTO schema, calls one service function, maps the result or error to a response. No business rules and no data access. If a controller function grows past ~15 lines, logic is leaking into it.

**Service** holds the business rules and is the only layer that touches data access. It receives `deps` and already-validated DTO types, maps database rows to response DTOs or domain results (never returning raw rows), and throws the shared typed errors instead of HTTP codes. It knows nothing about requests, responses or headers, so jobs and tests call it directly. Add a separate repository file only when the project already uses that pattern.

**DTO** defines every shape that crosses a boundary: request bodies, query params, responses, job and event payloads, API responses read by the frontend. Each DTO is a runtime schema with its type inferred from it, so validation and types cannot drift. Use the validator the project already has; on a fresh project use zod. DTOs are not database rows: a response DTO picks the fields the client may see.

```ts
export const invoiceLineDto = z.object({
  description: z.string().min(1),
  amountCents: z.number().int().positive()
})

export const createInvoiceDto = z.object({
  customerId: z.string().uuid(),
  lines: z.array(invoiceLineDto).min(1)
})
export type CreateInvoiceDto = z.infer<typeof createInvoiceDto>
```

**Job** is the entry point for work that does not come from an HTTP request: queues, cron, event listeners, webhooks processed later. It validates its payload with a DTO, calls service functions, and is idempotent, because queues and event buses retry. Use the project's queue library; do not add one when a timer or the platform scheduler is enough.

**Ports** (`<feature>.ports.ts`) declare what the feature needs from outside, as small interfaces named for the need (`CustomerDirectory`), not for whoever happens to provide it.

On the frontend:

- **`<feature>.api.ts`** makes transport calls and maps the wire format through DTOs; no business rules.
- **`<feature>.hooks.ts`** owns UI-facing orchestration: queries, mutations, derived state.
- **`<feature>.store.ts`** holds client state shared across the feature's components, only when local state or the server-state cache is not enough.
- **Components** render and handle interaction. They take data from hooks and never call transport or hold domain rules. House primitives come from `src/shared/ui/`; components from another feature are never imported.

## Existing projects with another layout

New features follow this layout and the portability rule. Existing code is not moved and existing cross-feature imports are not untangled unless the task asks for it; a half-migrated codebase is worse than a consistent old one. When a task touches an old module heavily, note the migration as a follow-up instead of doing it inside the task. To add the boundary check to a codebase that already breaks it, record the current violations as a baseline (`depcruise-baseline src`, then run with `--ignore-known`) so new violations still fail.

## Tests

- Service tests are the main suite: call service functions directly with real `deps` and real DTO inputs, and assert on results and thrown errors. Edge cases live here.
- Ports are stubbed with plain objects in tests. A feature's tests import nothing from another feature.
- Controller tests are few and go through HTTP: status codes, validation errors, the response shape.
- Job and listener tests feed a raw payload, check it is validated, and check that running twice has the same effect as running once.

## Review checklist

Copy these into `CODING_STANDARDS.md` when this skill is loaded by bussin-autoloop, so the review stage enforces them:

- A file under `src/features/<a>/` imports only from its own folder, `src/shared/` and npm packages; the boundary check passes with a non-zero module count.
- Infrastructure reaches a feature through `register(app, deps)` or, in Next.js server code, `getKernel()`; never by importing an instance.
- `src/shared/` holds infrastructure only and imports no feature.
- Nothing outside the feature folder changes except the `register` call, thin route files and navigation entries.
- Cross-feature needs go through events with listener-owned DTOs, ports declared by the feature that needs them, or props composed in a Next.js route file.
- Every new file sits under `src/features/<feature>/` or `src/shared/`, is kebab-case, and carries its role suffix.
- Controllers contain no business rules and no data access.
- Services take their dependencies as arguments and contain no request, response or HTTP status handling.
- Every boundary input is parsed by a DTO schema; types are inferred, not hand-written twins.
- Response DTOs do not leak database rows directly.
- Jobs and listeners validate payloads and are idempotent.
- Every route handler, server action and Hono route authenticates the caller, parses input with a DTO, and the service checks that the caller may act on that record.
- Error responses come from the shared error mapping and never include stack traces or internal messages.
