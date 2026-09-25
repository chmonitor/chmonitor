# Vendored pstack source

This subtree is a file copy of the upstream pstack skills-only distribution.
The project-specific adapter remains one directory above at
`../SKILL.md`; the upstream copy is supplemental and is not a replacement for
the CI-first chmonitor validation contract.

## Provenance

- Upstream repository: <https://github.com/michael-denyer/pstack-claude>
- Release tag: `v0.9.44`
- Upstream commit: `9f3a2ca90a3b0f9fda8024f04f8f23df958444ad`
- Upstream source path: `plugins/pstack/skills`
- Upstream `VERSION`: `0.9.44`
- Retrieved: `2026-09-25`
- Tarball SHA-256: `fe6f17fa0bf9e5673480014118cfae751e7d830a602fbf887f849c5651fcbb73`
- Upstream skills tree inventory: 153 files in 74 directories
- Upstream skills content manifest SHA-256: `9c842ce09bd9429a90288906a48d7e45be5c54c204b5f534910f558da1c39186`

The content manifest hash is a sorted `sha256sum` manifest of relative paths and
file contents for `plugins/pstack/skills`. It identifies the copied upstream
subtree; it is not a hash of this repository's later documentation edits.

## Included files

- `skills/` is the exact upstream skills tree.
- `LICENSE`, `LICENSE-cursor-team-kit`, `NOTICE.md`, and `NOTICE-skills.md` are
  copied from the upstream release.
- `CHANGES.md` is copied so the upstream notice has its referenced provenance
  record beside it.
- `README.md` and this file are local installation metadata, not upstream
  content.

No plugin hooks, agent registrations, model configuration, Claude plugin
manifest, Codex prompt stubs, or generated dashboard registry files are part of
this copy.

## Portability and content checks

Checked on 2026-09-25 with shell-only checks:

- The copied `skills/` tree has no symbolic links or other non-regular entries.
- The copied upstream tree matches the release extraction byte-for-byte.
- Executable files contain no hard-coded absolute or Windows filesystem paths.
  Absolute paths that remain in upstream prose are examples such as `/tmp` or
  `/Users/you`, not runtime dependencies.
- A credential-keyword and common-token scan found no credential values. The
  few keyword hits are upstream prose and URL field handling, not secrets.
- No project adapter file was overwritten; the upstream files are confined to
  `upstream/`.
- The only missing relative link found is an upstream `CHANGES.md` reference
  written against the original `plugins/pstack/skills` layout; its local
  counterpart is `upstream/skills/`. No executable file depends on that path.
- `git diff --check` reports one preserved upstream blank line at the end of
  `skills/automate-me/SKILL.md`; the file remains byte-for-byte identical to
  the release. Local metadata and documentation have no whitespace errors.

## Refresh procedure

Refresh only with a file copy from a pinned release. Inspect the destination
first, preserve the local adapter, and update this metadata with the new tag,
commit, version, inventory, and hashes. Do not hand-edit files under
`upstream/skills/`.
