# Desk playbook: docs and skill drift

AGENTS.md, the SKILL.md files, and `docs/knowledge/*.md` are a **contract**. An
agent loads one cold, mid-task, and follows what it names. A path that moved is
not a cosmetic defect — it costs the reader a whole re-derivation, and the
finding usually never resurfaces.

## The split with CI, so this job is not redundant

`tests/repo/markdown-links.test.ts` runs in the required `unit-tests` job and
**gates** the machine-checkable class: every relative markdown link under
`.claude/skills`, `docs/knowledge`, and `docs/herdr-desk` must resolve. Do not
duplicate that work here. It is already failing the PR that introduces the rot.

This job owns the three classes a deterministic check cannot reach:

1. **Paths named in prose**, not in a markdown link.
2. **Knowledge-graph integrity** — `related:` ids that point at a note that does
   not exist.
3. **Staleness and contradiction** — an `updated:` date older than the code it
   describes, or a note that now says the opposite of what the code does.

## 1. Prose-named paths

The CI test deliberately ignores backticked paths, because most of them are
correct and a false positive is worse than a miss. That leaves real rot. A
backtick is a claim; check the ones that look like file paths:

```sh
rg -no '`[A-Za-z0-9_./-]+\.(md|ts|tsx|yml|yaml|sh|json)`' AGENTS.md docs/knowledge/ .claude/skills/ \
  --glob '!.claude/skills/pstack/upstream/**'
```

Then resolve each against the repo. Expect false positives and discard them
**explicitly** — for example `pstack-validation.md` names
`.claude/skills/plan-and-verify` inside a sentence explaining that the path does
not exist. That is a correct note about a wrong path, not rot. Record it as
checked-and-fine so the next run does not re-derive it.

## 2. Knowledge-graph integrity

Every note declares `id:` and a `related:` list. A `related:` entry that is not
another note's `id` is a dead edge: the reader follows it and finds nothing.
Right now there is exactly one, and it is on the issue record:

```sh
# ids first
rg -oN '^id: (\S+)' -r '$1' docs/knowledge/*.md | sed 's/.*://' | sort -u
# then each related: entry, matched against that set
```

The known one: `agent-tool-catalog.md` declares `related: agent-model-discovery`
and no note carries that id. The note exists on a branch, not on `main`. That is
a **recover-or-drop decision, not a diff** — deleting the edge loses a pointer
to a note someone may be about to land. Write the finding down and let a human
call it.

**Do not confuse `tags:` with `related:`.** Both are YAML lists of `- item`
lines, so a naive line-level scan reports dozens of "dangling" edges that are
really just tags. Parse the frontmatter block and read the `related:` key
specifically. A scan that has not been de-noised is worse than no scan.

## 3. Staleness and contradiction

- `updated:` older than the last commit touching the code it describes. A note
  that predates a rename is a trap:

  ```sh
  git log -1 --format=%cs -- <path the note names>
  # compare against the note's frontmatter updated:
  ```

- A note asserting a path, job name, or workflow that no longer exists. Job
  names move; `unit-tests` and `dashboard` are the required checks, and every
  playbook that names a job should still name live ones.
- Two notes that now disagree. Pick the one the code supports, fix the other,
  and say which you chose and why.
- A **skill** that contradicts a **playbook** or a workflow. These are separate
  files maintained by different jobs; drift between them is the normal failure
  mode, not an edge case.

## Rules

- Fix drift in the same change that discovers it, and bump the note's
  `updated:` date. A fix without the date bump is undone by the next reader.
- Never edit the pinned vendored tree at `.claude/skills/pstack/upstream/` — it
  carries a content-manifest hash, and editing it breaks the pin.
- Never regenerate
  `apps/dashboard/src/lib/ai/agent/skills/registry.ts` as a side effect. It is
  built from `.agents/skills/` by `pnpm run build:skills`.
- One theme per run, like `local:improve`. This job complements it — it owns
  the graph and prose-path classes, improve owns dead code and slowdowns. If
  both would pick the same item, let improve have it.
- If the right output is a decision rather than a diff, write `research-<n>.md`
  in the run dir and stop.

## Report

`changes.md` with: the class, the exact file:line, what it claims versus what
is true now, the fix or the open question, and the notes whose `updated:` you
bumped. List what you checked and found correct too — otherwise next run
re-derives it.

Then toast only when something changed:

```sh
herdr notification show "chmonitor docs" --body "{{runDir}}/changes.md"
```
