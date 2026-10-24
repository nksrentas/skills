---
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
---

Our invoices page fetches in useEffect and keeps the list in useState, so it refetches on every visit and the filter dropdown is a hand-made div. Rework it with TanStack Query and a shadcn Select, and split the table into a toolbar, rows and pagination that share sorting.
