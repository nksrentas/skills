---
name: bussin-react
description: House rules for React 19 and Next.js App Router code - server components first with small client islands, shadcn/ui owned in src/shared/ui, compound components for multi-part widgets, TanStack Query for client-side server state, forms that reuse the feature's zod DTOs, and fast, secure UI. Use whenever writing or reviewing React components, hooks, forms, data fetching or Next.js pages, or when bussin-feature or bussin-autoloop loads it.
argument-hint: "[component, hook, form or page to build or review]"
---

# bussin-react

How React code is written in the house. Three skills sit next to this one:
- `bussin-ts-architecture` decides **where** files go: feature folders that move to another project as they are.
- `bussin-ui` decides **how it looks**.
- `bussin-a11y` decides **who can use it**.

This skill decides **how the React code itself is shaped**: which side of the server boundary it runs on, how components compose, how data is fetched and changed, and what keeps it fast and safe.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js App Router with React 19, TypeScript strict |
| Components | shadcn/ui, generated into `src/shared/ui/` and owned there |
| Client-side server state | TanStack Query v5 |
| Forms | react-hook-form with `zodResolver`, using the feature's DTO schema |
| Client-only shared state | Local state first, then Zustand in `<feature>.store.ts` |
| Tests | Vitest, React Testing Library, user-event, MSW for the network |

Use what the project already has before adding any of these. Add a library only when it removes real code, never "for later".

## Server first

- Every component is a server component until it needs the browser: state, effects, event handlers, browser APIs. Then the smallest subtree that needs it gets `'use client'`, never a whole page.
- A server component reads data by calling the feature's service with `getKernel()`. It does not fetch its own API over HTTP.
- Data crosses into a client component as props shaped by a response DTO. Never pass database rows, secrets, or whole user records.
- Client components receive server components as `children` instead of importing them, so a client island never drags server code into the bundle.
- Files that must never reach the browser start with `import 'server-only'`: services, kernel code, anything reading secrets.
- Changes go through a server action or a route handler (see `bussin-ts-architecture` → `references/backend.md`). Both are public endpoints: authenticate, parse with the DTO, authorize in the service.

## Where code goes in a feature

| File | Holds |
|---|---|
| `<feature>-page.tsx` | The server component the route file renders: loads data through the service and composes the feature's components |
| `components/*.tsx` | Rendering and interaction; they get data from hooks or props |
| `<feature>.hooks.ts` | Query key factory, `queryOptions`, `useQuery` and `useMutation` wrappers, derived UI state |
| `<feature>.api.ts` | Browser-side transport, through the typed `hc` client or `fetch`, mapped through DTOs |
| `<feature>.actions.ts` | Server actions (`'use server'`) |
| `<feature>.store.ts` | Zustand, only for client state that local state and the query cache cannot hold |

Components never call `fetch`, never hold business rules, and never import from another feature. Shared primitives come from `src/shared/ui/`.

## Components

- **Compose with children before adding props.** A component with more than about six props, or with boolean flags that switch its layout, wants composition instead.
- **Compound components** suit widgets with several parts that share state: tabs, steppers, data tables with toolbar and pagination, comboboxes. One root owns the state and gives it to its parts through context. The parts are exported together, and a part used outside its root throws a clear error. Do not build one for a component with a single part. [references/components.md](references/components.md) has the pattern.
- **Props:** use a named `type` per component, plus `ComponentProps<'button'>` when wrapping a native element. Pass `ref` as a normal prop (React 19).
- **State:**
  - Keep it as close to where it is used as possible.
  - Compute values during render instead of copying them into state.
  - Reset state with a `key` instead of an effect.
  - Use `useEffect` only to sync with something outside React: subscriptions, browser APIs, third-party widgets. Never use it to fetch data or to derive state.
- **Lists** use stable ids as `key`, never array indexes for lists that reorder.
- **Every data view** renders all four states: loading (a skeleton or `Suspense` fallback), error (with a retry), empty (with the next action), and success.

## shadcn/ui

- Add components with the shadcn CLI. `components.json` maps the `ui` alias to `@/shared/ui`, so generated files land in the kernel.
- Generated components are house code: edit them in place to match the theme tokens (with `bussin-ui`, the colours, radii and type from its `theme.css`). Never wrap a shadcn component in another component that only forwards props.
- A feature-specific variant is a `cva` variant added to the shared component, or a composition inside the feature. Never fork the file into the feature.
- Keep the Radix behaviour that shadcn brings: focus management, keyboard handling, ARIA. Do not replace a `Dialog`, `Select` or `DropdownMenu` with hand-rolled `div`s.

## Data

- **The first render** gets its data on the server, in the page component, through the service.
- **TanStack Query** handles data the client must refetch, poll, paginate or change after load. Each feature keeps:
  - a key factory in `<feature>.hooks.ts` (`invoiceKeys.all`, `.list(filters)`, `.detail(id)`), so invalidation is exact
  - `queryOptions(...)` objects next to the keys, shared by `useQuery`, `useSuspenseQuery` and prefetching
- **Server data seeds the cache:** pass the server-loaded DTO to the client component, which hands it to `useQuery` as `initialData`. Do not fetch the same thing twice.
- **Mutations** call a server action or the API, then invalidate the exact keys they affect. Use optimistic updates (`onMutate`, rollback in `onError`) only where waiting would feel broken, such as toggles and reorders.
- **Never** fetch in `useEffect`, never keep server data in `useState` or Zustand, and never invalidate everything.

[references/data.md](references/data.md) has the query client setup, a feature's hooks file, seeding from the server, and mutations.

## Forms

- The form schema is the feature's DTO schema (`createInvoiceDto`), resolved with `zodResolver`. The server action parses the same schema again, so client validation is only a courtesy.
- Use the shadcn form components the project has installed: `Field`, `FieldLabel` and `FieldError` with react-hook-form's `Controller` in current shadcn. Every input has a label, and every error is tied to its input with `aria-invalid` and `aria-describedby`.
- **While the form submits:** disable the submit button and show progress.
- **On success:** say so, then reset the form or navigate.
- **On failure:** show the server's message. Never lose what the user typed.

## Performance

- **Server components first:** they are the biggest win, since what never ships to the browser costs nothing there.
- **Memoization:** with the React Compiler on (`reactCompiler: true`), do not hand-write `useMemo`, `useCallback` or `memo`. Without it, add them only where the React Profiler shows a slow render.
- **Avoid waterfalls:** start independent requests together (`Promise.all`, or parallel queries), and stream slow parts behind `Suspense` with `loading.tsx` or an inline fallback.
- **Heavy client-only widgets** (charts, editors, maps) load with `next/dynamic` when they are below the fold or behind an interaction.
- **Long lists:** more than about 200 rows are virtualized with TanStack Virtual, or paginated on the server.
- **Images and fonts:** images use `next/image` with `sizes`; fonts use `next/font`.
- **Don't break code splitting:** no barrel files that re-export a whole feature to the client, and `index.ts` stays server wiring.
- **Context:** a context value that changes often is split from the ones that do not, so a keystroke does not re-render the whole tree.

## Security

- **Server actions, route handlers and Hono routes are public endpoints.** Each one authenticates the caller, parses input with the DTO, and checks in the service that this caller may touch this record. Hiding a button is not authorization.
- **Only `NEXT_PUBLIC_` variables reach the browser.** Secrets live in server-only files, and a client component never imports the kernel or a service.
- **Never use `dangerouslySetInnerHTML`** with user or CMS content unless it is sanitized with DOMPurify first.
- **Links and redirects:** URLs from users or data are checked to be `http` or `https` before they go into `href`, `src` or `redirect`.
- **Return only what the client needs:** a response DTO picks the fields; an error message names no internals.
- **Auth cookies** are `httpOnly`, `secure` and `sameSite=lax` or stricter. Tokens are never kept in `localStorage`.
- **Sign-in, sign-up, password reset and other expensive endpoints** are rate-limited.
- **New dependencies** are checked before they are added: maintained, widely used, no install scripts the project does not need.

## Tests

- Test components through what the user sees: `getByRole`, `getByLabelText` and user-event clicks and typing. Never assert on state or class names.
- MSW mocks the network for client components. Server components and actions are covered by the service tests in `bussin-ts-architecture`.
- Every data view has a test for each of its four states. Every form has a test for the invalid submit and for a server error.

## Review checklist

When bussin-autoloop loads this skill, copy this list into `CODING_STANDARDS.md` so the review stage enforces it:

- `'use client'` sits on the smallest subtree that needs it; pages and layouts stay server components.
- Server components load data through the feature's service; no client component calls `fetch` or a service directly.
- Props crossing into client components are response DTOs; no rows, secrets or full user records.
- Files with secrets or data access import `server-only`.
- Server actions and route handlers authenticate, parse with the DTO, and authorize in the service.
- Server data is never kept in `useState` or Zustand; TanStack Query keys come from the feature's key factory, and mutations invalidate exact keys.
- No `useEffect` for fetching or derived state.
- Multi-part widgets use a compound component with context; no prop drilling deeper than two levels.
- shadcn components live in `src/shared/ui/` and are edited in place; no pass-through wrappers and no forked copies in features.
- Every data view handles loading, error, empty and success.
- Forms reuse the feature's DTO schema, label every input, tie errors to inputs, and keep input on failure.
- No hand-written memoization without a profiler reason when the React Compiler is on; lists over about 200 rows are virtualized or paginated.
- No `dangerouslySetInnerHTML` without sanitizing; user-supplied URLs are checked to be http or https.
