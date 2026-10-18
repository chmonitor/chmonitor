# Project-local pstack

Two parts:

- The chmonitor adapter: [`SKILL.md`](SKILL.md) (rules) and
  [`features/`](features/README.md) (the validation map). The inventory and CI
  matrix are in
  [`docs/knowledge/pstack-validation.md`](../../../docs/knowledge/pstack-validation.md).
- A pinned copy of the upstream skills-only tree from
  [`michael-denyer/pstack-claude`](https://github.com/michael-denyer/pstack-claude/tree/main/plugins/pstack/skills)
  at [`upstream/`](upstream/), version `0.9.44` (tag `v0.9.44`). Commit,
  release URL, file counts, and manifest hash are in
  [`upstream/SOURCE.md`](upstream/SOURCE.md); loading notes are in
  [`upstream/README.md`](upstream/README.md).

## Boundaries

- Do not edit `upstream/`. Refresh it only by copying a new pinned release and
  updating `SOURCE.md`, with its license and notice files. Re-read the
  upstream README and skill frontmatter first; the tree moves.
- The upstream copy was vendored instead of installed with `npx skills add`,
  because that CLI writes into `.agents/skills`.
- `.agents/skills` belongs to end-user agent skills:
  `scripts/build-skills-registry.ts` scans it and writes
  `apps/dashboard/src/lib/ai/agent/skills/registry.ts` from an allowlist. Keep
  pstack out of it and do not regenerate the registry for pstack work.
- The upstream SessionStart hook, Codex prompt stubs, and subagent
  registration are not part of the skills-only copy, so nothing routes to
  pstack automatically. Ask for `pstack` by name or load
  `.claude/skills/pstack/SKILL.md` by path.
- On runtimes other than Claude Code, translate Claude-only names (`Agent`,
  `pstack:poteto-agent`, `/pstack:*`) instead of copying them. The parent
  session picks the model.
- No secrets, account ids, cookies, private hostnames, or credential-bearing
  examples in this directory.
