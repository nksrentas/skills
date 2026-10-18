---
name: bussin-drizzle
description: House rules for Drizzle ORM in TypeScript, which differ from Drizzle's defaults - schemas live inside each feature, no foreign keys into another feature's tables, the client is passed in and created without a global schema, no db.query relational queries, every schema change ships with its drizzle-kit migration, and data tests hit a real database. Load it before adding or changing a table, column, index, relation or enum, generating or reviewing a migration, or writing a query, transaction or pagination against Postgres, SQLite or MySQL in a TypeScript project, even when the code already uses Drizzle and the change looks routine. Also load it when bussin-autoloop uses it as a context skill. Prefer Drizzle over Prisma, TypeORM, Knex or raw drivers unless the project already uses one of those.
---

# Drizzle data access

Drizzle keeps SQL visible and types exact. These rules keep it that way and fit the feature layout from `bussin-ts-architecture`.

## Where things live

- `src/shared/db.ts` creates the single Drizzle client from config and exports it with its type. Nothing else opens connections, and only the kernel and the composition root touch the instance; features receive it as `deps.db`, or from `getKernel()` in Next.js server code. The client is created without a `schema` option, because passing every feature's tables would make `shared/` import features.
- Each feature defines its tables in `src/features/<feature>/<feature>.schema.ts`. A table belongs to exactly one feature, and no other feature imports it.
- `drizzle.config.ts` at the root points `schema` at `./src/features/**/*.schema.ts` and `out` at `./drizzle`, so a feature copied into the project is picked up without editing the config.
- Queries live in the feature's service, which takes the client as an argument. Controllers and jobs never touch the database directly.

## Schema

```ts
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'sent', 'paid', 'void'])

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull(),
  status: invoiceStatus('status').notNull().default('draft'),
  totalCents: integer('total_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [index('invoices_customer_idx').on(table.customerId)])

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull()
}, (table) => [index('invoice_lines_invoice_idx').on(table.invoiceId)])

export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
```

- Foreign keys stay inside the feature (`invoiceLines` to `invoices`). A row that points at another feature's data stores the id as a plain indexed column, like `customerId` here, because a `.references()` to another feature's table is an import that breaks portability. The owning feature keeps that reference valid through its events or a port, for example by listening for `customer.deleted`.
- snake_case column names in the database, camelCase keys in TypeScript.
- Money as integer minor units, timestamps with time zone, enums as database enums.
- Every foreign key column used in a filter gets an index.
- Row types come from `$inferSelect` / `$inferInsert`. They are not DTOs; services map rows to response DTOs.

## Migrations

- Change the schema file, then run `drizzle-kit generate` and commit the generated SQL in `drizzle/` together with the schema change.
- Apply with `drizzle-kit migrate` or the migrator at startup. `drizzle-kit push` is for throwaway local databases only, never for anything that holds data.
- Read every generated migration before committing. A rename that drizzle-kit reads as drop-and-add loses data; answer its prompt as a rename.
- Destructive changes (drop column, tighten nullability) go in two steps across releases: stop using it, then remove it.
- Generated migrations belong to the project, not the feature. After copying a feature into another project, run `drizzle-kit generate` there to create its tables in that project's history.

## Queries

- Use the core query builder (`db.select()`, `db.insert()`, joins between the feature's own tables), which is parameterised and needs no global schema. Relational queries (`db.query.*`) need every table registered on the client, which breaks portability, so they are not used. `sql` templates are fine because they parameterise interpolated values. `sql.raw` never receives user input.
- Select the columns you need when a table is wide or holds secrets.
- Writes that must succeed together run in `db.transaction(async (tx) => ...)`, and every call inside uses `tx`, not `db`.
- Check-then-write races (unique names, stock counts) are solved with a unique constraint or a conditional update, then translated to `ConflictError` in the service. An application-side check alone is not enough.
- Lists are paginated with `limit` plus a cursor or offset; no unbounded `select` over growing tables.
- Translate driver errors (unique violation, foreign key violation) into the shared typed errors at the service boundary so controllers never see database error codes.

## Tests

Service tests run against a real database, not a mocked Drizzle client: mocks pass while the SQL is wrong. Use what the project has; for Postgres without one, PGlite in-process or a disposable container. Apply the migrations once per test run, isolate each test in a transaction that rolls back or truncate between tests, and cover constraint violations explicitly (duplicate, missing foreign key, null in a required column). Because services take the client as an argument, a test passes the rollback transaction straight in.

## Review checklist

Copy these into `CODING_STANDARDS.md` when this skill is loaded by bussin-autoloop:

- Only the kernel and the composition root touch the client instance; services receive it as an argument.
- No `schema` option on the client and no `db.query.*` relational queries.
- No `.references()` to a table owned by another feature; cross-feature ids are plain indexed columns.
- Every schema change ships with its generated migration in the same commit.
- No `drizzle-kit push` in scripts or CI for persistent databases.
- No `sql.raw` with values that originate from a request.
- Multi-write operations use a transaction and `tx` throughout.
- Uniqueness and invariants are enforced by constraints, not only by code.
- Services return DTOs, not raw rows.
- Data tests hit a real database.
