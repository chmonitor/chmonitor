# Desk playbook: red jobs

This job owns the CI jobs that are red and that `local:babysit` is forbidden to
touch. Babysit must not spend a run on them, because they do not block merge.
That is correct for throughput and wrong for ownership: with nobody assigned,
they rot indefinitely and become the background noise every other signal is
read past.

The two this job exists for, on `main` right now:

| Job | State | Why babysit skips it |
|---|---|---|
| `Claude Issues` / `triage-issue` | 20/20 recent failure, 100/100 all-time | not required; nothing depends on it |
| `promptfoo` | red on a gateway `404 model_unavailable` | not required, and it spends real tokens |

## The distinction that matters

Two different failures, two different owners:

- **A code defect.** The workflow is wrong and the fix is in this repo. File an
  issue with the failing log, and let `desk:github-issues` do the work.
- **An external fact.** The gateway, the model registry, or a third-party
  service is down or has changed. There is no repo fix. Record it, and do not
  file a code issue — a stale "the eval is broken" issue is itself rot.

`promptfoo` red with `404 model_unavailable` is the second kind. A missing
Anthropic credential is the first.

## The sweep

1. **Required-check health on `main`.** This is the one that matters and the one
   nobody is watching outside babysit:

   ```sh
   gh run list --branch main --limit 20 \
     --json workflowName,conclusion,headSha,createdAt \
     --jq 'group_by(.workflowName) | map({wf: .[0].workflowName, fails: (map(select(.conclusion=="failure"))|length), total: length})'
   ```

   A red `unit-tests` or `dashboard` on `main` outranks everything else in this
   playbook. Escalate it immediately and say so loudly.

2. **Failure ratio per workflow.** One red run is noise; a ratio is a verdict:

   ```sh
   gh run list --workflow <name>.yml --limit 100 \
     --json conclusion --jq '[.[].conclusion] | group_by(.) | map({(.[0]): length}) | add'
   ```

   Read `{"failure":100}` as "this has never worked", not "this is flaky".
   Check whether it ever succeeded at all, and when it last passed.

3. **Skip versus fail.** A path-filtered workflow shows no runs because nothing
   matched. `agent-eval.yml` has **zero** runs on `main` — it is PR-only plus
   `workflow_dispatch`. That is not red. Confirm the trigger before calling
   anything broken:

   ```sh
   awk '/^on:/{f=1} f{print} /^jobs:/{if(f)exit}' .github/workflows/agent-eval.yml
   ```

4. **Classify each red job** as code defect or external fact, and record which.

## What this job may do

- File issues with the evidence attached.
- Comment on an existing issue with a fresh log, so the record stays current.
- Open a **small** PR only when the fix is unambiguous and confined: a wrong
  secret name, a missing file the prompt references, a typo in a job id. Those
  are mechanical and reviewable.
- Close an issue whose cause is now proven external, with the reason.

## What this job must not do

- Never touch a required check. That is `local:babysit`'s job, and two jobs
  fixing one red run means two conflicting branches.
- Never "fix" an external fact by changing a model default, a base URL, a
  timeout, or a retry count. Those are product and cost decisions, and a
  gateway 404 is not a repo bug.
- Never delete or disable a workflow to make the board green.
- Never spend tokens to make an eval pass. If the eval is red for an external
  reason, the honest report is red.

## Report

`changes.md` with a table: workflow, last run, failure ratio, required?, skip
or fail, classification, and the issue it maps to. If everything is still
classified correctly and no new evidence appeared, say so and stop — a repeated
"no change" is the expected healthy outcome, and silence is how rot starts.

Then toast only when something changed:

```sh
herdr notification show "chmonitor CI" --body "{{runDir}}/changes.md"
```
