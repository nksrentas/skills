---
name: bussin-code-feature
description: Create, update, or refactor TypeScript/JavaScript application features with feature-based organization, deliberate layer boundaries, complete runtime states, dependency-aware edits, and code-quality verification. Use for frontend, backend, or full-stack feature implementation; do not invoke for explanation-only requests or isolated non-feature edits.
---

# Bussin Code Feature

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

## Organize by feature

- Place feature-owned code under one feature root.
- Keep relative directory depth at three or fewer below that root. The feature root is depth 0; `components/forms/fields/` is depth 3.
- Prefer a few cohesive files over deep nesting or one-file-per-function fragmentation.
- Do not reorganize unrelated code merely to make the repository match this skill.

## Create only justified layers

Choose files from actual responsibilities, not from a mandatory template:

- `dto.ts`: boundary types, schemas, parsing, and validation.
- `api.ts`: transport calls and wire-format mapping; no business rules.
- `service.ts`: use cases, domain rules, and orchestration.
- `controller.ts`: HTTP, RPC, CLI, or framework request/response adaptation.
- `repository.ts`: persistence access and persistence mapping.
- `hooks.ts`: UI-facing orchestration and reusable framework hooks.
- `store.ts`: shared client state only when local state or server-state caching is insufficient.
- Components/views: rendering and user interaction, not transport or domain logic.

Omit layers that would only forward arguments. Split mixed responsibilities already touched by the change when doing so is necessary for quality, while keeping unrelated refactors out of scope.

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

## Prefer simple, established tools

- Reuse installed project libraries before adding dependencies.
- Prefer local state for local UI state.
- Use Zod for runtime boundary validation when schemas provide real value.
- Use TanStack Query/React Query for remote server state, caching, and request lifecycle handling.
- Use Zustand for genuinely shared client state that does not belong in server-state cache.
- Add a dependency only when it reduces meaningful complexity and the dependency change is within scope; otherwise use the platform or the project's current approach.

## Propagate the change

Trace the affected dependency graph and update every required consumer: imports, exports, barrel files, route registration, navigation, schemas, API contracts, dependency injection, persistence mappings, callers, tests, mocks, fixtures, and user-facing copy. Search for old names and contracts after the edit to find missed consumers.

</implementation_contract>

<workflow>

1. Ground the change in repository evidence and identify the feature boundary.
2. Choose the minimum justified files and layers; keep directory depth within the limit.
3. Implement end-to-end behavior, including applicable loading, error, empty, and success paths.
4. Update the complete dependent-file set and remove obsolete paths created by the change.
5. Run focused tests first, then relevant type-check, lint, broader tests, and build commands available in the repository.
6. Inspect the final diff for accidental scope growth, comments, duplicated contracts, unnecessary abstractions, and missed consumers.

</workflow>

<quality_gate>
Do not call the feature complete until the relevant checks pass or their failure is reported:

- Feature ownership is clear and nesting is no deeper than three directories below the feature root.
- Each file has one coherent layer responsibility; no pass-through layers exist.
- External data is validated or safely mapped at the boundary when needed.
- All applicable runtime/UI states are implemented and distinguishable.
- New application code is comment-free except for required exceptions.
- All known dependents and registrations are updated.
- The solution uses existing or simple primitives unless a library is justified.
- Tests cover changed behavior and available verification commands have been run.
</quality_gate>

<auditable_reasoning>
Keep private chain-of-thought private. Make the work auditable through concrete evidence instead. In the final response, report:

- The feature boundary and layers created, omitted, or changed.
- Repository anchors that drove non-obvious choices.
- Loading/error/empty/success coverage, including any state that was not applicable.
- Dependent files or registrations updated.
- Verification commands and outcomes.
- Remaining risks or blockers, if any.

Explain decisions briefly enough that another engineer can verify them from the diff.
</auditable_reasoning>
