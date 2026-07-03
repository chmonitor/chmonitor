# 67 — Docs + blog content engine

## Kickoff prompt

```text
Execute plans/67-docs-blog-content-engine.md ALONE (do not read other plans).
Goal: stand up a repeatable docs+blog content engine — a 12-week editorial calendar,
post templates, docs<->blog cross-links, an RSS feed, a GitHub-release->blog sync
script, and a "latest posts" widget in the landing footer.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE: content + build tooling only; no app/runtime/billing
  changes.
- Marketing claims MUST match shipped features: release posts and how-tos describe
  ONLY what actually shipped (advisor RECOMMENDS DDL / never auto-applies; alerting
  channels as implemented; works on self-host/Docker/K8s/Cloud). Draft template must
  include a "verify each claim against the code/changelog" checklist step.
- Analytics/DNT: if posts embed any analytics, reuse the existing wrapper (plan 62)
  and respect DNT; no PII.
- Postgres/multi-DB: NO. ClickHouse-only positioning.

When done, run the Verification block at the bottom and paste the output.
```

## Current reality (audited)

Why (roadmap §4/67, P1/M/E): the blog has essentially one post and no cadence, so there is
no SEO/nurture engine feeding the funnel. There is no release→content loop, no RSS, and the
landing does not surface recent writing. Content is the cheapest durable growth lever for an
open-core dev tool.

Pointers (verify at head):
- Blog app: `apps/blog/` — Astro content collection under `src/content/blog/`,
  `astro.config.mjs`. (Round-2 plan 03 already touched blog surfaces, so the collection
  exists.)
- Docs app: `apps/docs/` — cross-linking target; confirm its build script name
  (`bun run build:docs` per the task; `(verify)` in root `package.json`).
- Landing footer: `apps/landing/src/components/Footer.astro` — where the "latest posts"
  widget belongs.
- Release source: GitHub releases for the repo — the sync script consumes these.

## Goal

A running content system: a documented 12-week calendar (mix of release notes, how-tos,
troubleshooting, case studies), reusable post templates, bidirectional docs↔blog links, a
working RSS feed, a script that turns a GitHub release into a draft blog post, and a landing
footer widget listing the latest posts — such that a ≥2-posts/month cadence is
operationally easy and every claim is verifiable.

## Implement now (depth E — approach + key files + open questions)

### Approach
1. **Editorial calendar** — a committed `apps/blog/CONTENT-CALENDAR.md` (or similar) with 12
   weeks of planned posts by type (release / how-to / troubleshooting / case-study), each
   with target keyword and the docs page it should cross-link. This is the plan-of-record for
   cadence.
2. **Templates** — post templates (frontmatter + skeleton sections) per type under the blog
   content dir, each ending with a **claim-verification checklist** ("does this feature ship
   at the referenced version? link the changelog/PR"). Templates are how honesty is enforced
   at authoring time.
3. **Docs↔blog cross-linking** — establish the convention (how-to posts link the canonical
   docs page; docs pages link the deeper blog write-up) and add the first links so the loop
   is real, not just documented.
4. **RSS** — add an RSS feed to the blog (`@astrojs/rss` or Astro's feed endpoint) so the
   content is syndicable; link it from the footer widget.
5. **Release→blog sync** — a script (`apps/blog/scripts/release-to-post.mjs` `(verify path)`)
   that reads a GitHub release (tag, notes) and scaffolds a draft release post from the
   release template, pre-filled and ready for the claim-verification pass. It **drafts**, it
   does not auto-publish.
6. **Landing "latest" widget** — a small block in `Footer.astro` (or a dedicated component it
   imports) rendering the N most-recent posts (built from the blog content collection or its
   RSS at build time).

### Key files
- New: blog content calendar doc; post templates; `apps/blog/scripts/release-to-post.mjs`;
  RSS feed route/config in the blog.
- Edit: `apps/blog/astro.config.mjs` (RSS/integration); `apps/landing/src/components/Footer.astro`
  (latest-posts widget); the first docs pages + posts that form the cross-link loop.
- Reuse: existing blog content-collection schema; docs build pipeline.

### Open questions (resolve during discovery)
- **Calendar ownership:** who authors on the cadence, and is 12 weeks / 2-per-month the right
  target given available author time? The templates + sync script must make even a solo
  cadence sustainable.
- **Release-sync trigger:** does the script run manually, on a GitHub Actions `release`
  event, or on demand? Decide before wiring; keep it draft-only regardless.
- **Latest-posts data source:** does the landing build have access to the blog content
  collection directly, or must it read the built RSS/JSON (separate Astro apps)? This
  determines how the footer widget sources posts.
- **Two markdown pipelines:** the repo already ships two markdown renderers (README DEP-02) —
  reuse the blog's existing one; do not add a third.

## STOP conditions & drift check

- STOP if an RSS feed / release-sync / latest-posts widget already exists — reconcile instead
  of duplicating.
- STOP the release-sync script short of publishing — it drafts only; a human runs the
  claim-verification checklist before anything goes live.
- DRIFT: if templates would let an author state a roadmap feature as shipped, tighten the
  checklist; honesty is enforced in the template, not left to the author's memory.
- Do NOT add a new markdown/rendering pipeline; reuse the blog's.

## Verification

```
bun run build:docs
```

Also build the blog (`cd apps/blog && bun install --frozen-lockfile && bun run build`
`(verify script)`) and confirm: the RSS feed is emitted, at least two example/template posts
render, the release-sync script produces a valid draft post from a sample release, and the
landing footer's latest-posts widget builds (`cd apps/landing && bun run build`). Verify
docs↔blog cross-links resolve.

## Done criteria

- A committed 12-week calendar + per-type templates (with a claim-verification checklist)
  exist.
- RSS feed builds; docs↔blog cross-links resolve; the landing footer shows latest posts.
- The GitHub-release→blog sync script scaffolds a draft post (never auto-publishes).
- `bun run build:docs` and the blog/landing builds are green; no unshipped-feature claims in
  shipped templates/posts.

Priority: P1 · Effort: M · Depth: E · Wave: G (Growth) · Lever: SEO / Adoption
