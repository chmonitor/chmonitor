# Desk playbook: secrets audit

Every workflow that reads `secrets.X` is a promise that `X` exists. This job
checks that promise, because nothing else does and a missing secret produces a
run that fails for a reason nobody reads.

## Why this job exists

`claude-issues.yml` referenced `secrets.ANTHROPIC_API_KEY` for its entire
life. That secret was never in the repo. The job failed **100 runs out of
100** across three days and nobody noticed, because the workflow gates nothing:
no required check depends on it, so `local:babysit` — which only looks at
required CI — never sees it. This job is the second pair of eyes for the class
of failure that is invisible precisely *because* nothing depends on it.

## The check

Collect every `secrets.NAME` referenced in `.github/workflows/`, then diff
against what actually exists. The list of names is the deliverable:

```sh
rg -oN 'secrets\.[A-Z0-9_]+' .github/workflows/ \
  | sed 's/.*secrets\.//' | sort -u > /tmp/opencode/referenced.txt
gh secret list --json name --jq '.[].name' | sort -u > /tmp/opencode/actual.txt
comm -23 /tmp/opencode/referenced.txt /tmp/opencode/actual.txt   # referenced, MISSING
comm -13 /tmp/opencode/referenced.txt /tmp/opencode/actual.txt   # present, unreferenced
```

The first list is the finding. The second is context, not a defect — an unused
secret is a rotation candidate, worth one line in the report and nothing more.

Names in the same commit from different jobs are expected to differ, so compare
per workflow, not only repo-wide:

```sh
for f in .github/workflows/*.yml; do
  echo "== $f"
  rg -oN 'secrets\.[A-Z0-9_]+' "$f" | sed 's/.*secrets\.//' | sort -u
done
```

## Also check

1. **Every job that has run at least once.** A workflow with zero successful
   runs is this job's real subject, whatever the secret audit says:

   ```sh
   gh run list --workflow <name>.yml --limit 100 \
     --json conclusion --jq '[.[].conclusion] | group_by(.) | map({(.[0]): length}) | add'
   ```

   `{"failure":100}` on a workflow nothing depends on is the exact shape of the
   `Claude Issues` failure. Treat it as a finding even when the secret audit is
   clean.
2. **Sibling disagreement.** Two jobs in one file that authenticate
   differently is the tell. `claude-issues.yml` had `triage-issue` on
   `anthropic_api_key` and `resolve-issue` on `claude_code_oauth_token` in the
   same 219-line file. Diff the auth inputs across jobs before reading a log.
3. **Prompt-referenced paths.** A prompt or comment naming a file that was never
   committed is the same class of defect as a missing secret, and it is invisible
   until the agent runs:

   ```sh
   rg -n 'claude-code-action' -A6 .github/workflows/claude-issues.yml   # then verify each named path exists
   ```

## Report

`changes.md` with: the referenced/actual counts, every missing name with the
workflow and line that references it, any workflow with zero successful runs,
and any sibling auth disagreement. If clean, say so in one line and stop.

## Rules

- **Read-only.** Never create, rotate, or delete a secret. Adding the secret you
  just found is a human decision: it costs money and changes what the workflow
  can reach.
- Never print a secret **value**. `gh secret list` shows names only; keep it
  that way. If a name itself looks sensitive, that is a separate finding.
- Never disable or delete a failing workflow to make this report clean. A
  red workflow nobody depends on is a bug to file, not noise to mute.
- File an issue per distinct defect, with the evidence attached. Do not fix
  workflows here — that is `desk:github-issues` work, and a workflow change
  that starts *doing* something needs its own review.
