---
name: bussin-ts-architecture
description: House architecture for TypeScript backends - feature-based folders where each feature owns its controller, service, DTOs and jobs. Use whenever writing or reviewing TypeScript server code, adding an endpoint, a background job or a new domain area, scaffolding a TS API, or when bussin-autoloop loads it as a context skill. Also use when someone asks where a file should go or how to split a controller from business logic.
---

# TypeScript feature architecture

Code is grouped by what it does for the product, not by what kind of file it is. A reader looking for "invoices" opens one folder and finds everything: how requests arrive, what rules apply, what shapes go in and out, what runs in the background.

## Layout

```
src/
  features/
    invoices/
      invoice.controller.ts
      invoice.service.ts
      invoice.dto.ts
      invoice.job.ts
      invoice.schema.ts
      invoice.service.test.ts
      index.ts
  shared/
    db.ts
    http.ts
    config.ts
    errors.ts
  app.ts
```

File names are kebab-case with a role suffix: `<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.dto.ts`, `<feature>.job.ts`. A feature with several resources uses one file per resource and role (`invoice-line.service.ts`). A role a feature does not need simply has no file; never create an empty one.

## Roles

**Controller** is the HTTP edge and stays thin. It parses the request with the DTO schema, calls one service function, maps the result or error to a response. No business rules, no database access, no calls to other features. If a controller function grows past ~15 lines, logic is leaking into it.

**Service** holds the business rules and is the only layer that touches data access. It receives already-validated DTO types, returns domain results, and throws the shared typed errors (`NotFoundError`, `ConflictError`, `ValidationError`) instead of HTTP codes. It knows nothing about requests, responses or headers, so jobs and tests can call it directly.

**DTO** defines every shape that crosses a boundary: request bodies, query params, responses, job payloads. Each DTO is a runtime schema with its type inferred from it, so validation and types cannot drift. Use the validator the project already has; on a fresh project use zod. DTOs are not database rows: a response DTO picks the fields the client may see.

```ts
export const createInvoiceDto = z.object({
  customerId: z.string().uuid(),
  lines: z.array(invoiceLineDto).min(1)
})
export type CreateInvoiceDto = z.infer<typeof createInvoiceDto>
```

**Job** is the entry point for work that does not come from an HTTP request: queues, cron, webhooks processed later. It validates its payload with a DTO, calls service functions, and is idempotent, because queues retry. Use the project's queue library; do not add one when a timer or the platform scheduler is enough.

## Boundaries between features

- A feature exposes its public surface through `index.ts` (service functions and DTO types others may use). Other features import from `features/<name>` only, never from its inner files.
- Features never import each other's controllers, jobs or schemas.
- Cross-cutting code (db client, config, error types, HTTP helpers) lives in `shared/`. Code moves to `shared/` only once a second feature needs it.
- No circular imports between features. When two features need each other, the shared part is a third feature or belongs in `shared/`.

## Existing projects with another layout

New features follow this layout. Existing code is not moved unless the task asks for it; a half-migrated codebase is worse than a consistent old one. When a task touches an old module heavily, note the migration as a follow-up instead of doing it inside the task.

## Tests

- Service tests are the main suite: call service functions directly with real DTO inputs and assert on results and thrown errors. Edge cases live here.
- Controller tests are few and go through HTTP: status codes, validation errors, the response shape.
- Job tests check payload validation and that running the job twice has the same effect as running it once.

## Review checklist

Copy these into `CODING_STANDARDS.md` when this skill is loaded by bussin-autoloop, so the review stage enforces them:

- Every new file sits under `src/features/<feature>/` or `src/shared/` and carries its role suffix.
- Controllers contain no business rules and no data access.
- Services contain no request, response or HTTP status handling.
- Every boundary input is parsed by a DTO schema; types are inferred, not hand-written twins.
- Response DTOs do not leak database rows directly.
- Jobs validate payloads and are idempotent.
- Cross-feature imports go through `index.ts` only.
