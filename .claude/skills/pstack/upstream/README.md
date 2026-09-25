# Vendored pstack skills

This is the pinned, skills-only copy of
[`michael-denyer/pstack-claude`](https://github.com/michael-denyer/pstack-claude)
at `v0.9.44`. The copied skill directories are under
[`skills/`](skills/), with the upstream notices and license files beside them.
The source commit and integrity metadata are in [`SOURCE.md`](SOURCE.md).

The project-specific chmonitor adapter is intentionally kept at
[`../SKILL.md`](../SKILL.md), with its feature map at
[`../features/README.md`](../features/README.md). Load that adapter first for
chmonitor work. It owns the repository-specific CI-first rules, workflow
routing, evidence labels, and boundaries around local builds and credentials.
This vendored tree supplies the upstream general-purpose skills when a task
needs one.

## Loading a skill

A skill entry point is a `SKILL.md` file under `skills/<name>/`. Ask the
runtime to load the entry point by path, for example:

> Read `.claude/skills/pstack/upstream/skills/how/SKILL.md` and apply it to
> this question.

When the current skill-aware runtime exposes the project tree, its skill
loader may also allow the skill name, such as `how` or `poteto-mode`, after
this subtree is present. Do not assume recursive discovery: if a runtime only
scans direct `.claude/skills/*` entries, copy or link the individual
`skills/<name>` directory into that runtime's configured skill root. Keep each
skill's `references/` and `scripts/` beside its `SKILL.md`.

The bundled skill set includes the upstream workflow skills such as `how`,
`why`, `architect`, `arena`, `interrogate`, `swarm`, `tdd`, `teach`, and
`poteto-mode`, the `principle-*` skills, and the review, writing, and
verification skills. Use the directory listing under `skills/` as the complete
index; upstream adds and renames skills over time.

## Runtime boundary

This is a source copy, not a Claude plugin installation.

- There is no SessionStart hook, plugin manifest, native subagent registry,
  model configuration, or automatic routing in this subtree.
- Do not rely on Claude-only `/pstack:*` commands, `Agent`/`AskUserQuestion`
  names, or `subagent_type: "pstack:..."` values in OpenCode. Translate those
  instructions to the current runtime's native task, subagent, browser, and
  shell tools.
- The `setup-pstack` skill discusses model and hook configuration. Do not run
  it as part of this vendored installation, and do not let it override the
  parent session's configured model.
- Upstream scripts are preserved for portability, but this installation does
  not run them and does not install their dependencies.
- A skill loaded from this directory is supplemental guidance. For a
  chmonitor validation claim, the parent adapter and its CI evidence rules
  remain authoritative.

## Generated registry boundary

The repository scans `.agents/skills` to generate
`apps/dashboard/src/lib/ai/agent/skills/registry.ts`. Do not copy this vendored
tree into `.agents/skills`, regenerate that registry, or add the upstream
skills to the dashboard's end-user agent bundle. Keep the complete copy in
this named subtree and load only an explicitly requested skill file.

## Included upstream files

`LICENSE`, `LICENSE-cursor-team-kit`, `NOTICE.md`, `NOTICE-skills.md`, and
`CHANGES.md` preserve the upstream distribution's license and provenance
notices. `SOURCE.md` records the exact release and file-copy method. The
project adapter's own `README.md`, `SKILL.md`, and `features/` files remain
separate; this vendored copy does not replace or edit them.
