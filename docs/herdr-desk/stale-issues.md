# Desk playbook: stale issues

Open issues are a work queue. A queue nobody prunes stops being a queue and
becomes a graveyard: the real items are buried under years of noise, and
"check the open issues" stops being a usable first step.

`desk:github-issues` triages what arrives. This job is the other half — what
accumulated and was never resolved.

## The starting evidence

Issue **#14 "Dependency Dashboard"** was opened 2023-11-18 by Renovate and is
still open. It lists seven PRs from the repository's previous name
(`duyet/clickhouse-monitoring`) and a blocked "PR Edited" branch for a
dependency set that has long since moved on. Nobody is ever going to fix it,
and it is 3 years of noise in the oldest position in the queue.

## The sweep

1. **Read the queue with dates**, not just titles:

   ```sh
   gh issue list --state open --limit 100 \
     --json number,title,createdAt,updatedAt,labels,author,assignees \
     --template '{{range .}}#{{.number}}\t{{.createdAt}}\t{{.updatedAt}}\t{{len .labels}}L\t{{if .assignees}}assigned{{else}}unassigned{{end}}\t{{.title}}{{"\n"}}{{end}}'
   ```

2. **Bucket each issue into exactly one class**, and do not skip the hard ones:

   | Class | Test | Action |
   |---|---|---|
   | Stale-bot | authored by a bot (`app/renovate`, a dashboard generator), content self-evidently obsolete | close with a reason naming the cause |
   | Fixed | the described behaviour already holds, or the code path is gone | close with `gh issue close --reason completed` and the evidence |
   | Superseded | a newer issue covers it | close with the superseding number |
   | Duplicate | an existing issue says the same thing | close with that number |
   | Live | still accurate, still actionable | leave it, and make sure it is not duplicated |
   | `needs-design` | a human owes a decision | leave it and do not implement — it is a hard stop for every other job |

3. **Verify before closing.** A stale-bot issue is safe to close from its own
   content. "Fixed" is not: prove it against the code, not against your memory
   of the code.

   ```sh
   gh issue view <n> --json body,comments --jq '.body' | head -40
   rg -n "<the path or symbol the issue names>" --glob '!**/__tests__/**'
   ```

   An issue whose named path no longer exists is usually *superseded*, not
   *fixed* — those close with different reasons and the distinction matters to
   whoever reads the history later.

4. **Never close a live issue to reduce the count.** The count is not the
   metric. An issue closed wrongly costs a real bug; an old issue left open
   costs one minute of someone's attention.

## Bot issues specifically

A generated dashboard issue is a snapshot, not a queue. When its content no
longer matches reality, the snapshot is the defect:

```sh
gh issue list --state open --author 'app/renovate' --json number,title,createdAt
```

Renovate reopens its dashboard on each run, so closing #14 is not permanent —
it comes back. That is fine and expected; what matters is that a human reading
it sees "this was reviewed and is obsolete" rather than a 2023 snapshot that
looks authoritative.

## Rules

- **Close with a reason, never bare.** The reason is the only thing that makes
  the closure useful six months later.
- **Never delete an issue.** Close it; the audit trail is the point.
- **Never implement.** This job triages the queue. Implementation is
  `desk:github-issues`.
- **Never touch `needs-design`.** It is a human decision marker. Leaving it
  open is correct.
- At most 8 closures per run, oldest first. A run that closes forty issues is
  not a review, it is a bulk operation wearing a review's clothes.

## Report

`changes.md` with a table: issue, class, action, reason. Then the queue depth
before and after, and an explicit list of what you deliberately left open and
why. If nothing was closable, say that in one line and stop.
