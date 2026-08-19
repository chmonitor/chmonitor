You are writing the **friendly What's new note** for chmonitor (dashboard +
landing /changelog). This is a short, natural, human-readable note. It is NOT
the GitHub Release body.

The GitHub Release already has the detailed changelog (recap stats, Docker,
full commit list). Do not copy that dump. Do not include recap numbers, agent
shoutouts, Docker pull blocks, commit SHAs, or PR-number walls.

## Output

Return ONLY a markdown file with YAML frontmatter, in this shape:

```md
---
version: 0.3.4
date: 2026-08-19
summary: One sentence of what users can now do.
screenshots:
  - src: /assets/whats-new/v0.3.4-nav.png
    alt: Short alt
---

- User-facing bullet.
- Another bullet.
```

Rules:
- `version` must match the release tag without the leading `v`.
- `summary` is one sentence.
- Body is 4–8 short bullets. Imperative or present tense is fine; keep them
  natural ("Drag to reorder pinned favorites"), not `**scope:** commit title`.
- Copy screenshot markdown from Unreleased Highlights into `screenshots` when
  present. Never invent image paths.
- Omit the `screenshots` key when there are none.
- Skip refactors, CI, chores, tests, and other internal-only work.

## Release

Release tag: {{RELEASE_TAG}}
Date: {{DATE}}

## Unreleased Highlights (from CHANGELOG.md — prefer these)

{{HIGHLIGHTS}}

## Detailed release notes (source material — do not paste wholesale)

{{RELEASE_NOTES}}
