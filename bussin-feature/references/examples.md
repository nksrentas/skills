# Few-Shot Feature Decisions

Use these examples to choose boundaries, not as templates to copy. Repository conventions and the requested behavior remain authoritative.

## Example 1: Remote React list

<request>
Add an invoices page that fetches invoices and links it from billing navigation.
</request>

<anchors>
The repository is a Next.js app with features under `src/features/`, uses TanStack Query, validates external responses with Zod, and keeps navigation in the app layout.
</anchors>

<decision>
Create only the remote-data and presentation layers:

```text
src/features/invoices/
|-- index.ts
|-- invoice.api.ts
|-- invoice.dto.ts
|-- invoice.hooks.ts
|-- invoices-page.tsx
`-- components/
    `-- invoice-list.tsx
```

`invoice.dto.ts` validates the response, `invoice.api.ts` performs transport and mapping, `invoice.hooks.ts` owns the query, and components render the states. Do not add a service, controller, or store; they would not own distinct responsibilities. Outside the folder, add only the thin `src/app/billing/invoices/page.tsx` and the navigation entry in the app layout; do not edit a billing feature to link to it. Render separate loading, error/retry, no-invoices, and list states.
</decision>

## Example 2: Backend command endpoint

<request>
Add an endpoint that confirms a booking and persists the confirmation timestamp.
</request>

<anchors>
The server uses controllers for HTTP adaptation, services for domain rules, repositories for persistence, Zod at request boundaries, and registers each feature in `src/app.ts`. Guests must be emailed after confirmation, and email belongs to a separate notifications feature.
</anchors>

<decision>
Use the layers that correspond to existing responsibilities:

```text
src/features/bookings/
|-- index.ts
|-- booking.dto.ts
|-- booking.repository.ts
|-- booking.service.ts
`-- booking.controller.ts
```

The controller parses the request and maps errors to HTTP responses. The service enforces confirmability and idempotency, then emits `booking.confirmed` on `deps.events`; the notifications feature listens with its own payload DTO, so neither feature imports the other. The repository file exists because the project already uses that pattern. Do not add an API client because the controller already owns this transport boundary. Add the route inside the feature's existing `register` (a brand-new feature would also get one `register` call in `src/app.ts`), update request fixtures and the controller, service, and repository tests. Verify not-found, invalid-state, persistence-failure, already-confirmed, and success behavior.
</decision>

## Example 3: Small local UI feature

<request>
Add a density toggle that affects only the current results panel.
</request>

<anchors>
The setting is not persisted, shared, or synchronized with the server. The existing panel owns comparable display preferences with component state.
</anchors>

<decision>
Keep the change in the panel feature and use local component state. Do not create a store, service, API client, or DTO. Loading, error, and empty are not new states for the synchronous toggle; verify compact and comfortable rendering plus keyboard interaction. Update the panel test and any shared type only if the change actually depends on one.
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
