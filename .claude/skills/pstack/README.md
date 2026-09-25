# Project-local pstack

This directory is the project-local pstack installation for chmonitor. It is a
small, tracked adapter for OpenCode v2 and other skill-aware agents. It keeps
the repository's validation contract close to the code without copying the
upstream plugin into the product tree.

## Upstream research

Researched against `michael-denyer/pstack-claude` on 2026-09-25.

- The upstream portable boundary is
  [`plugins/pstack/skills`](https://github.com/michael-denyer/pstack-claude/tree/main/plugins/pstack/skills).
- The skills-only path includes the skill directories, bundled scripts,
  portable agent references, and license notices.
- The Claude SessionStart hook, Codex prompt stubs, and Claude native subagent
  registration are plugin/runtime concerns and are not part of the skills-only
  boundary.
- OpenCode's shared Agent Skills location is `~/.agents/skills`; the upstream
  reference documents skills-only discovery there. This repository instead
  tracks its project-local router under `.claude/skills/pstack` so the
  chmonitor-specific map travels with the checkout.
- The upstream tree is moving. Re-read the upstream README, reference, and
  skill frontmatter before synchronizing or changing this adapter.

The observed upstream `VERSION` was `0.9.44`. Treat that as a research
snapshot, not a version pin for this repository.

## Optional upstream installation

The upstream package documents this skills-only install:

```bash
npx skills add https://github.com/michael-denyer/pstack-claude/tree/main/plugins/pstack/skills --skill "*" --agent "*" --yes
```

With the current `skills` CLI, the default scope is project-local. The command
can write the upstream tree into agent-specific project directories such as
`.claude/skills/` and `.agents/skills/`, depending on the selected agents.
It is intentionally not run as part of this repository's validation because
the full upstream bundle is not this project's adapter and `.agents/skills` is
reserved for the dashboard's generated end-user skill registry.

For an isolated project that wants the upstream tree copied for only selected
agents, the CLI also supports a command like this (still not run here):

```bash
npx skills add https://github.com/michael-denyer/pstack-claude/tree/main/plugins/pstack/skills --skill "*" --agent claude-code --agent opencode --copy --yes
```

Keep that upstream installation separate from this repository's committed
validation map. If a developer chooses the upstream clone-and-link method,
keep the source checkout outside this repository and link the complete
`plugins/pstack/skills/*` tree into the runtime's shared directory. Do not
replace an existing destination without inspecting it first.

## Runtime boundary

- Invoke the project skill as `pstack`, or ask the OpenCode runtime to load
  `.claude/skills/pstack/SKILL.md`.
- Use the runtime's native task, subagent, browser, and shell primitives. Do
  not copy Claude-only `pstack:poteto-agent`, `Agent`, or `/pstack:*` syntax
  into an OpenCode instruction.
- A skills-only install has no automatic SessionStart routing. Request `pstack`
  explicitly when a task needs the project validation contract.
- The parent session's model remains authoritative. This project does not
  hardcode a model slug or change the configured Space Bunny Free runtime.
- This adapter contains no upstream plugin hooks, agents, or generated prompt
  files. It must not be copied into `.agents/skills` merely to make it visible
  to the end-user agent registry.

## Generated registry boundary

The root `scripts/build-skills-registry.ts` scans `.agents/skills` and writes
`apps/dashboard/src/lib/ai/agent/skills/registry.ts`. That registry is for
end-user monitoring-agent skills and has an explicit allowlist. The pstack
adapter is a developer skill and stays under `.claude/skills`; adding it to
`.agents/skills` would either be skipped or require an unrelated registry
change. Do not regenerate or edit either generated file for this installation.

## What belongs here

Keep the adapter focused:

- `SKILL.md` contains the CI-first launch, doctor, drive, evidence, cleanup,
  and helper rules.
- `features/` is the user-facing validation map.
- [`../../../docs/knowledge/pstack-validation.md`](../../../docs/knowledge/pstack-validation.md)
  records the inventory, gaps, and workflow matrix.
- Existing product skills such as `product-design`, `cloud-saas-mode`, and the
  older `verify-chmonitor` remain separate sources of truth for their scope.

No upstream files are copied into this adapter. If upstream skills are later
vendored or synchronized, retain the source project's MIT license and notice
files with that copy.

Do not add secrets, account identifiers, cookies, private hostnames, or
credential-bearing example values to this directory.
