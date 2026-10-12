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
- Tarball SHA-256 at retrieval: `fe6f17fa0bf9e5673480014118cfae751e7d830a602fbf887f849c5651fcbb73`
- Upstream skills tree inventory: 153 files in 74 directories
- Upstream skills content manifest SHA-256: `d27b3902464dd3013986b4b8ef0ee9dc9567fc18214b4bff05eb01b3441dacce`

The content manifest hash comes from [`manifest.sh`](manifest.sh). From inside
the tree, it lists regular files as `./<path>`, sorts the paths bytewise
(`LC_ALL=C sort -z`), runs `sha256sum` over them in that order, and hashes the
resulting `<hash>  ./<path>` lines:

```sh
cd skills
find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
```

Run `./manifest.sh --check` to compare the vendored tree with the value above,
or `./manifest.sh <dir>` to hash an extracted upstream `plugins/pstack/skills`.
It identifies the copied upstream subtree; it is not a hash of this
repository's later documentation edits.

Re-verified on 2026-10-13: `diff -r` found the vendored `skills/` identical to
`plugins/pstack/skills` in a fresh `v0.9.44` archive, whose tag resolves to the
upstream commit above. `manifest.sh` gives the same hash for both trees. The
hash recorded at retrieval (`9c842ce0…`) used an unrecorded recipe and cannot
be reproduced, so it was replaced. GitHub's generated archives are not
byte-stable (the re-download hashed `fc1e1b0f…`), so the commit and the
content manifest, not the tarball hash, are the integrity anchors.

## Included files

- `skills/` is the exact upstream skills tree.
- `LICENSE`, `LICENSE-cursor-team-kit`, `NOTICE.md`, and `NOTICE-skills.md` are
  copied from the upstream release.
- `CHANGES.md` is copied so the upstream notice has its referenced provenance
  record beside it.
- `README.md`, `manifest.sh`, and this file are local installation metadata,
  not upstream content.

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
commit, version, inventory, and hashes. Record the content manifest with
`./manifest.sh`, then confirm it with `./manifest.sh --check`. Do not hand-edit
files under `upstream/skills/`.
