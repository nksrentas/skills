---
name: bussin-drizzle
description: Database access in TypeScript with Drizzle ORM - schemas per feature, migrations with drizzle-kit, typed queries inside services, transactions and tests against a real database. Use whenever TypeScript code needs to read or write a SQL database, a new table, column, relation, migration or query is added, someone mentions Drizzle, drizzle-kit, Postgres, SQLite or MySQL in a TS project, or bussin-autoloop loads it as a context skill. Prefer it over Prisma, TypeORM, Knex or raw drivers unless the project already uses one of those.
---

# Drizzle data access

Drizzle keeps SQL visible and types exact. These rules keep it that way and fit the feature layout from `bussin-ts-architecture`.

## Where things live

- `src/shared/db.ts` creates the single Drizzle client from config and exports it with its type. Nothing else opens connections.
- Each feature defines its tables in `src/features/<feature>/<feature>.schema.ts`. A table belongs to exactly one feature; other features reference it through that feature's `index.ts`.
- `drizzle.config.ts` at the root points `schema` at `./src/features/**/*.schema.ts` and `out` at `./drizzle`.
- Queries live in the feature's service. Controllers and jobs never import `db`.

## Schema

```ts
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  status: invoiceStatus('status').notNull().default('draft'),
  totalCents: integer('total_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [index('invoices_customer_idx').on(table.customerId)])

export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
```

- snake_case column names in the database, camelCase keys in TypeScript.
- Money as integer minor units, timestamps with time zone, enums as database enums.
- Every foreign key column used in a filter gets an index.
- Row types come from `$inferSelect` / `$inferInsert`. They are not DTOs; services map rows to response DTOs.

## Migrations

- Change the schema file, then run `drizzle-kit generate` and commit the generated SQL in `drizzle/` together with the schema change.
- Apply with `drizzle-kit migrate` or the migrator at startup. `drizzle-kit push` is for throwaway local databases only, never for anything that holds data.
- Read every generated migration before committing. A rename that drizzle-kit reads as drop-and-add loses data; answer its prompt as a rename.
- Destructive changes (drop column, tighten nullability) go in two steps across releases: stop using it, then remove it.

## Queries

- Use the query builder or relational queries; both are parameterised. `sql` templates are fine because they parameterise interpolated values. `sql.raw` never receives user input.
- Select the columns you need when a table is wide or holds secrets.
- Writes that must succeed together run in `db.transaction(async (tx) => ...)`, and every call inside uses `tx`, not `db`.
- Check-then-write races (unique names, stock counts) are solved with a unique constraint or a conditional update, then translated to `ConflictError` in the service. An application-side check alone is not enough.
- Lists are paginated with `limit` plus a cursor or offset; no unbounded `select` over growing tables.
- Translate driver errors (unique violation, foreign key violation) into the shared typed errors at the service boundary so controllers never see database error codes.

## Tests

Service tests run against a real database, not a mocked Drizzle client: mocks pass while the SQL is wrong. Use what the project has; for Postgres without one, PGlite in-process or a disposable container. Apply the migrations once per test run, isolate each test in a transaction that rolls back or truncate between tests, and cover constraint violations explicitly (duplicate, missing foreign key, null in a required column).

## Review checklist

Copy these into `CODING_STANDARDS.md` when this skill is loaded by bussin-autoloop:

- No `db` import outside services and `shared/db.ts`.
- Every schema change ships with its generated migration in the same commit.
- No `drizzle-kit push` in scripts or CI for persistent databases.
- No `sql.raw` with values that originate from a request.
- Multi-write operations use a transaction and `tx` throughout.
- Uniqueness and invariants are enforced by constraints, not only by code.
- Services return DTOs, not raw rows.
- Data tests hit a real database.
