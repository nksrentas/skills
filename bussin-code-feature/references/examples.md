# Few-Shot Feature Decisions

Use these examples to choose boundaries, not as templates to copy. Repository conventions and the requested behavior remain authoritative.

## Example 1: Remote React list

<request>
Add an invoices page that fetches invoices and links it from billing navigation.
</request>

<anchors>
The repository already groups pages under `features/`, uses TanStack Query, validates external responses with Zod, and registers pages in a central route table.
</anchors>

<decision>
Create only the remote-data and presentation layers:

```text
features/invoices/
|-- api.ts
|-- dto.ts
|-- hooks.ts
|-- InvoicesPage.tsx
`-- components/
    `-- InvoiceList.tsx
```

`dto.ts` validates the response, `api.ts` performs transport and mapping, `hooks.ts` owns the query, and components render the states. Do not add `service.ts`, `controller.ts`, or `store.ts`; they would not own distinct responsibilities. Update the route table, billing navigation, feature export, and focused tests. Render separate loading, error/retry, no-invoices, and list states.
</decision>

## Example 2: Backend command endpoint

<request>
Add an endpoint that confirms a booking and persists the confirmation timestamp.
</request>

<anchors>
The server uses controllers for HTTP adaptation, services for domain rules, repositories for persistence, Zod at request boundaries, and a central router plus dependency-injection container.
</anchors>

<decision>
Use the layers that correspond to existing responsibilities:

```text
features/booking-confirmation/
|-- dto.ts
|-- repository.ts
|-- service.ts
|-- controller.ts
`-- routes.ts
```

The controller parses the request and maps errors to HTTP responses. The service enforces confirmability and idempotency. The repository updates persistence. Do not add `api.ts` because the controller already owns this transport boundary. Update the router, container bindings, database mapping if needed, request fixtures, and controller/service/repository tests. Verify not-found, invalid-state, persistence-failure, already-confirmed, and success behavior.
</decision>

## Example 3: Small local UI feature

<request>
Add a density toggle that affects only the current results panel.
</request>

<anchors>
The setting is not persisted, shared, or synchronized with the server. The existing panel owns comparable display preferences with component state.
</anchors>

<decision>
Keep the change in the panel feature and use local component state. Do not create `store.ts`, `service.ts`, `api.ts`, or `dto.ts`. Loading, error, and empty are not new states for the synchronous toggle; verify compact and comfortable rendering plus keyboard interaction. Update the panel test and any shared type only if the change actually depends on one.
</decision>

## Example 4: Existing architecture conflicts with a preferred library

<request>
Add optimistic renaming to a project list.
</request>

<anchors>
The repository already has a typed request cache and mutation helper. React Query and Zustand are not installed.
</anchors>

<decision>
Extend the existing cache/mutation abstraction instead of adding React Query or Zustand. Keep optimistic update, rollback, failure feedback, and success reconciliation together in the established feature hook or controller. Update cache keys, callers, tests, and error copy. A popular library is a preference only when it is a better fit than the repository's working convention.
</decision>
