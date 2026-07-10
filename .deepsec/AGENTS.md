# Agent setup

This is a deepsec scanning workspace. Each registered project has its
own setup prompt at `data/<id>/SETUP.md` — open the relevant one when
asked to set a project up.

**pnpm pin**: this workspace intentionally pins its own `packageManager`
(currently `pnpm@11.2.2`), independent of the repo root's `pnpm@10.18.0`. It is
an isolated `packages: []` workspace (not a member of the root pnpm-workspace)
with its own lockfile, so corepack switching pnpm majors here does not affect
the root install. Do not "fix" this pin to match root without regenerating
`.deepsec/pnpm-lock.yaml` under the new pnpm version first.

## Common tasks

- **Set up a project for scanning**: read `data/<id>/SETUP.md` and
  follow it (read `node_modules/deepsec/SKILL.md`, then fill
  `data/<id>/INFO.md` from the target codebase).
- **Add a new project**: run `deepsec init-project <root>` — it
  scaffolds `data/<id>/` and prints/writes the setup prompt for the
  new project.
- **Write a custom matcher** (only after a real true-positive shows you
  a pattern worth keeping): read
  `node_modules/deepsec/dist/docs/writing-matchers.md`.

## Reference

The deepsec skill is at `node_modules/deepsec/SKILL.md` (after
`pnpm install`). The full docs ship at
`node_modules/deepsec/dist/docs/`.
