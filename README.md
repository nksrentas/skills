<p align="center">
  <img src="./bussin-feature/assets/Bussin-logo.svg" alt="Bussin" width="360">
</p>

<h1 align="center">Skills</h1>

<p align="center">Reusable Agent Skills for shipping focused, production-quality work across AI coding tools.</p>

<p align="center">
  <a href="https://skills.sh/nksrentas/skills"><img src="https://skills.sh/b/nksrentas/skills" alt="skills.sh installs"></a>
</p>

## Included skills

- [bussin-autoloop](./bussin-autoloop): Autonomous build loop. `init` expands a task into a feature list with verify gates and a commit guard, then `run` finishes one item per fresh session until every item passes with evidence.
- [bussin-feature](./bussin-feature): Build and refactor TypeScript/JavaScript features with clean layers, complete runtime states, dependent-file updates, and verification.
- [bussin-ts-architecture](./bussin-ts-architecture): Feature-based folders for TypeScript backends, where each feature owns its controller, service, DTOs and jobs.
- [bussin-drizzle](./bussin-drizzle): Drizzle ORM data access with schemas per feature, drizzle-kit migrations, typed queries inside services, and tests against a real database.
- [bussin-ui](./bussin-ui): House UI system for landing pages and dashboards in Next.js, Tailwind CSS v4, GSAP and Lenis.
- [bussin-honest-feedback](./bussin-honest-feedback): Direct assessments instead of agreeable ones: verdict first, a rating out of 10 against fixed anchors, weak assumptions named, "you're wrong" with the reason, and "I don't know" when that is the truth.
- [bussin-write-like-a-human](./bussin-write-like-a-human): Check and revise drafts against the narrative choices that separate human from AI fiction, using measured rates from the StoryScope study of 61,608 stories.

## Install

This repository follows the open Agent Skills format and works with the `skills` CLI.

Install globally and choose from the AI tools detected on your machine:

```bash
npx skills add nksrentas/skills --skill bussin-feature -g
```

Install globally for specific tools:

```bash
npx skills add nksrentas/skills --skill bussin-feature -g -a codex -a claude-code -a cursor -a gemini-cli -a github-copilot
```

Install every skill in this repository for every supported agent:

```bash
npx skills add nksrentas/skills -g --all
```

Omit `-g` for a project-local installation. Use `npx skills update bussin-feature -g` to pull future updates.

## Compatibility

The portable behavior lives in each skill's `SKILL.md`, with optional `references/`, `scripts/`, and `assets/`. Agent-specific metadata such as `agents/openai.yaml` enhances supported clients without changing the shared skill instructions.
