<p align="center">
  <img src="./bussin-code-feature/assets/Bussin-logo.svg" alt="Bussin" width="360">
</p>

<h1 align="center">Skills</h1>

<p align="center">Reusable Agent Skills for shipping focused, production-quality work across AI coding tools.</p>

<p align="center">
  <a href="https://skills.sh/nksrentas/skills"><img src="https://skills.sh/b/nksrentas/skills" alt="skills.sh installs"></a>
</p>

## Included skills

- [bussin-code-feature](./bussin-code-feature): Build and refactor TypeScript/JavaScript features with clean layers, complete runtime states, dependent-file updates, and verification.

## Install

This repository follows the open Agent Skills format and works with the `skills` CLI.

Install globally and choose from the AI tools detected on your machine:

```bash
npx skills add nksrentas/skills --skill bussin-code-feature -g
```

Install globally for specific tools:

```bash
npx skills add nksrentas/skills --skill bussin-code-feature -g -a codex -a claude-code -a cursor -a gemini-cli -a github-copilot
```

Install every skill in this repository for every supported agent:

```bash
npx skills add nksrentas/skills -g --all
```

Omit `-g` for a project-local installation. Use `npx skills update bussin-code-feature -g` to pull future updates.

## Compatibility

The portable behavior lives in each skill's `SKILL.md`, with optional `references/`, `scripts/`, and `assets/`. Agent-specific metadata such as `agents/openai.yaml` enhances supported clients without changing the shared skill instructions.
