# Project-local pstack

This directory is the project-local pstack installation for chmonitor. It
combines a small, tracked CI-first adapter for OpenCode v2 and other
skill-aware agents with a pinned supplemental copy of the upstream skills-only
tree at [`upstream/`](upstream/). The adapter keeps the repository's
validation contract and feature map close to the code; the upstream copy is
kept in a named subtree and is not wired into product runtime hooks or the
generated dashboard skill registry.

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

The vendored copy is pinned to upstream `VERSION` `0.9.44`, tag `v0.9.44`.
Its source commit, release URL, file counts, and content-manifest hash are in
[`upstream/SOURCE.md`](upstream/SOURCE.md). Refresh it only by copying a
new pinned release and updating that metadata.

## Vendored upstream installation

The upstream skills-only tree is now vendored at
[`upstream/`](upstream/), rather than installed through the `skills` CLI. The
local index at [`upstream/README.md`](upstream/README.md) explains explicit
loading and runtime adaptation. This avoids writing into `.agents/skills`,
which this repository reserves for the generated dashboard agent registry.

The upstream package also documents this optional CLI installation, which was
not run for this repository:

```bash
npx skills add https://github.com/michael-denyer/pstack-claude/tree/main/plugins/pstack/skills --skill "*" --agent "*" --yes
```

With the current `skills` CLI, the default scope is project-local and the
command can write into agent-specific directories such as `.claude/skills/`
and `.agents/skills/`. Keep the vendored copy under `upstream/skills/` and do
not replace an existing destination without inspecting it first.

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
- The adapter itself contains no upstream plugin hooks, agents, or generated
  prompt files. The supplemental upstream skill files are stored under
  `upstream/skills/`; they are not installed into `.agents/skills` and do not
  register themselves with the end-user agent registry.

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
- `upstream/` contains the pinned upstream skills, source metadata, and license
  notices; it is supplemental to the adapter and does not replace the map.

Keep the upstream license and notice files with any future synchronized copy.
Do not add secrets, account identifiers, cookies, private hostnames, or
credential-bearing example values to this directory.
