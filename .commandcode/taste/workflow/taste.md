# workflow
- Use auto-merge with squash strategy for GitHub PRs. Confidence: 0.85
- Use git worktrees for parallel agent/subagent development. Confidence: 0.70
- Standard flow for finishing a change: fix, deploy, create a PR, then run the /babysit workflow until the PR is merge-ready. Confidence: 0.85
- Uses the attached "babysit" skill for PRs (triage comments, resolve conflicts, fix in-scope CI, don't touch CI configs just to pass). Confidence: 0.8
- Use Conventional Commits (`type(scope): summary`) for commit messages and PR titles; PR bodies carry a structured Summary plus a test-plan checklist. Confidence: 0.8
- Add a `Co-authored-by: duyetbot <bot@duyet.net>` trailer to commits and PR descriptions. Confidence: 0.8
- Never bypass git hooks to unblock a push — fix the root cause instead (install missing deps, strip stray NODE_ENV with `env -u`). Confidence: 0.75
- When updating docs, first verify every claim against actual repo state (configs, lockfiles, scripts); sweep all similar stale references across sibling READMEs/CONTRIBUTING/AGENTS/skills, but leave historical records (CHANGELOGs, retrospective handoff docs) untouched. Confidence: 0.75
