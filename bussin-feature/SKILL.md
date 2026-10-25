---
name: bussin-feature
description: Workflow for creating, updating or refactoring a TypeScript/JavaScript application feature end to end - ground it in the repo, implement every state (loading, error, empty, success), update every dependent file and registration, keep the feature folder portable, run the bussin-lean cleanup pass and verify with the project's checks. Use for frontend, backend or full-stack features. Not for explanations or isolated edits.
argument-hint: "<feature to build or change>"
---

# Bussin Feature

<role>
Act as a staff-level feature engineer and code-quality reviewer. Deliver the smallest complete feature that fits the repository's established architecture. Treat implementation, dependent-file updates, and verification as one task.
</role>

<grounding_anchors>
Before editing, inspect:

- Repository instructions and package manifests.
- The feature tree and the nearest analogous feature.
- Existing imports, exports, routes, schemas, dependency injection, tests, mocks, and consumers related to the change.
- Installed libraries and the project's lint, type-check, test, and build commands.

Repository evidence outranks the examples in this skill. Preserve established naming, framework conventions, and public contracts unless the request requires changing them. When an architecture decision is not obvious, read [references/examples.md](references/examples.md).
</grounding_anchors>

<implementation_contract>

## Follow the house structure

Load `bussin-ts-architecture` before choosing files. It owns the folder layout, the file roles, and the portability rule: a feature folder keeps working when copied into another project with the same layout, imports nothing from other features, and needs nothing outside it except app-shell wiring (a `register(app, deps)` call, or a thin Next.js route file and navigation entry). If that skill is not installed, follow the layout of the nearest existing feature and still keep the feature free of imports from other features.

Choose files from actual responsibilities, not from a template, and omit layers that would only forward arguments. Split mixed responsibilities already touched by the change when quality needs it; keep unrelated refactors and reorganizations out of scope.

## Keep code self-explanatory

- Do not add explanatory comments, commented-out code, or TODO narration.
- Use names, types, small functions, and explicit boundaries to make the code readable.
- Preserve required license headers, tool directives, generated markers, and documentation comments required by a public API or project convention.
- Remove stale comments in touched code when they no longer describe behavior.

## Cover observable states

For every asynchronous or data-rendering surface, handle each applicable state explicitly:

- Loading or pending.
- Error, with useful user feedback and recovery when appropriate.
- Empty, distinct from loading and failure.
- Success.

For mutations, also provide appropriate pending protection and success/failure feedback. Do not invent these states for synchronous behavior that cannot enter them.

## Accessible and findable

For any React or Next.js UI, load `bussin-react` and `bussin-a11y`; for any public page or route, also load `bussin-seo` and `bussin-schema`. For a backend endpoint, server action or Hono route, read `references/backend.md` in `bussin-ts-architecture`. Their review checklists are part of this feature's quality gate.

## Keep it lean

Load `bussin-lean` before writing code and follow its rules while you write: nothing speculative, no abstraction without a second real use, no wasteful allocation or data access. Its cleanup pass is a mandatory step of this workflow (step 6). If that skill is not installed, apply the same cleanup pass by hand: leftovers, over-engineering, structure, allocation.

## Prefer simple, established tools

- Reuse installed project libraries before adding dependencies.
- Prefer local state for local UI state.
- Use Zod for runtime boundary validation when schemas provide real value.
- Use TanStack Query/React Query for remote server state, caching, and request lifecycle handling.
- Use Zustand for genuinely shared client state that does not belong in server-state cache.
- Add a dependency only when it reduces meaningful complexity and the dependency change is within scope; otherwise use the platform or the project's current approach.

## Propagate the change

Trace the affected dependency graph and update every required consumer: imports, exports, route registration, navigation, schemas, API contracts, the composition root, persistence mappings, callers, tests, mocks, fixtures, and user-facing copy. Search for old names and contracts after the edit to find missed consumers.

Consumers outside the feature folder should only be the composition root, thin route files and navigation entries. When the change seems to need an edit inside another feature, that is a boundary crossing: emit an event or declare a port instead.

</implementation_contract>

<workflow>

1. Ground the change in repository evidence and identify the feature boundary.
2. Choose the minimum justified files and roles from `bussin-ts-architecture`.
3. Implement end-to-end behavior, including applicable loading, error, empty, and success paths.
4. Update the complete dependent-file set and remove obsolete paths created by the change.
5. Run focused tests first, then the import-boundary check, type-check, lint, broader tests, and build commands available in the repository.
6. Run the `bussin-lean` cleanup pass on the whole diff and fix what it finds: leftovers from earlier implementations, over-engineering, structure, allocation. Also check for scope growth, imports from other features, comments, duplicated contracts and missed consumers. Re-run the tests after the fixes. This step is mandatory.

</workflow>

<quality_gate>
Do not call the feature complete until the relevant checks pass or their failure is reported:

- The feature folder is portable: no imports from other features, dependencies arrive through `register(app, deps)` or `getKernel()`, and the boundary check passes or its absence is reported.
- Each file has one coherent role; no pass-through layers exist.
- External data is validated or safely mapped at the boundary when needed.
- All applicable runtime/UI states are implemented and distinguishable.
- New application code is comment-free except for required exceptions.
- All known dependents and registrations are updated.
- The solution uses existing or simple primitives unless a library is justified.
- Tests cover changed behavior and available verification commands have been run.
- The `bussin-lean` cleanup pass ran on the final diff and came back clean.
</quality_gate>

<auditable_reasoning>
Keep private chain-of-thought private. Make the work auditable through concrete evidence instead. In the final response, report:

- The feature boundary and layers created, omitted, or changed, and any events or ports used to reach other features.
- Repository anchors that drove non-obvious choices.
- Loading/error/empty/success coverage, including any state that was not applicable.
- Dependent files or registrations updated.
- Verification commands and outcomes.
- What the cleanup pass removed or simplified, or "Cleanup pass: clean".
- Remaining risks or blockers, if any.

Explain decisions briefly enough that another engineer can verify them from the diff.
</auditable_reasoning>
