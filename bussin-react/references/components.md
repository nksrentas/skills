# Components: shadcn/ui, compound components, forms

## shadcn/ui in the kernel

`components.json` points the generator at the shared kit, so every feature imports the same primitives:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": { "css": "src/app/globals.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": {
    "components": "@/shared",
    "ui": "@/shared/ui",
    "utils": "@/shared/lib/utils",
    "lib": "@/shared/lib",
    "hooks": "@/shared/hooks"
  }
}
```

```bash
npx shadcn@latest add button dialog field input select table
```

Then edit the generated files to match the house look instead of overriding styles at each use. With `bussin-ui`, map shadcn's CSS variables (`--primary`, `--radius`, `--background`) to the tokens in its `theme.css`, so `<Button>` is a sun-yellow pill without a single class at the call site.

A feature needs a different look? Add a variant to the shared component's `cva` config (`variant: { …, danger: '…' }`). Never copy `button.tsx` into the feature.

## Compound components

Use one when a widget has several parts that must agree on shared state, and the caller should arrange the parts. A data table with a toolbar, rows and pagination is the typical case: one place owns the sort and page state, and the parts read it.

```tsx
'use client'

import { createContext, use, useState, type ReactNode } from 'react'
import type { InvoiceRow } from '../invoice.dto'

type Sort = { column: keyof InvoiceRow; direction: 'asc' | 'desc' }

type InvoiceTableState = {
  rows: InvoiceRow[]
  sort: Sort
  setSort: (sort: Sort) => void
  page: number
  setPage: (page: number) => void
}

const InvoiceTableContext = createContext<InvoiceTableState | null>(null)

const useInvoiceTable = () => {
  const state = use(InvoiceTableContext)
  if (state === null) throw new Error('InvoiceTable parts must be used inside <InvoiceTable>')
  return state
}

function InvoiceTable({ rows, children }: { rows: InvoiceRow[]; children: ReactNode }) {
  const [sort, setSort] = useState<Sort>({ column: 'issuedAt', direction: 'desc' })
  const [page, setPage] = useState(1)
  return <InvoiceTableContext value={{ rows, sort, setSort, page, setPage }}>{children}</InvoiceTableContext>
}

function Toolbar({ children }: { children?: ReactNode }) {
  const { sort, setSort } = useInvoiceTable()
  return (
    <div role="toolbar" aria-label="Invoice table" className="flex items-center gap-2">
      <SortSelect value={sort} onChange={setSort} />
      {children}
    </div>
  )
}

function Rows() {
  const { rows, sort, page } = useInvoiceTable()
  return <InvoiceRows rows={sortAndPage(rows, sort, page)} />
}

function Pagination() {
  const { rows, page, setPage } = useInvoiceTable()
  return <Pager page={page} total={rows.length} onChange={setPage} />
}

InvoiceTable.Toolbar = Toolbar
InvoiceTable.Rows = Rows
InvoiceTable.Pagination = Pagination

export { InvoiceTable }
```

The caller decides the arrangement without new props:

```tsx
<InvoiceTable rows={invoices}>
  <InvoiceTable.Toolbar>
    <ExportButton />
  </InvoiceTable.Toolbar>
  <InvoiceTable.Rows />
  <InvoiceTable.Pagination />
</InvoiceTable>
```

Rules:
- The root owns state; parts read it through the context hook, which throws outside the root.
- Parts are attached to the root and exported together, so the folder exposes one name.
- `use(Context)` and `<Context value>` are React 19; on older React use `useContext` and `<Context.Provider>`.
- Split the context in two (state and setters) when parts that only set state re-render too often.
- A widget with one part, or with no shared state between parts, stays a plain component.

## Forms

The form validates with the same DTO the server action parses again:

```tsx
'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/shared/ui/button'
import { Field, FieldError, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { createCustomerDto, type CreateCustomerDto } from '../customer.dto'
import { useCreateCustomer } from '../customer.hooks'

export function CustomerForm() {
  const form = useForm<CreateCustomerDto>({ resolver: zodResolver(createCustomerDto), defaultValues: { name: '', email: '' } })
  const createCustomer = useCreateCustomer()

  const submit = form.handleSubmit(async values => {
    const result = await createCustomer.mutateAsync(values).catch((error: Error) => ({ error: error.message }))
    if ('error' in result) form.setError('root', { message: result.error })
    else form.reset()
  })

  return (
    <form onSubmit={submit} noValidate>
      <Controller
        name="email"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Email</FieldLabel>
            <Input {...field} id={field.name} type="email" autoComplete="email" aria-invalid={fieldState.invalid} />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
      {form.formState.errors.root && <p role="alert">{form.formState.errors.root.message}</p>}
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Saving…' : 'Save customer'}
      </Button>
    </form>
  )
}
```

A failed submit keeps every value the user typed, and the server's message shows next to the button.
