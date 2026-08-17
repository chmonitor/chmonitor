# chmonitor addendum

- Required CI: `unit-tests` and `dashboard`. Arm `gh pr merge --auto --squash`
  and babysit. Do not wait on `e2e-test`, `e2e-test-tsr`, or `component-test`.
- Never auto-merge release-please PRs.
- Children may open PRs. Manager does not implement on `main`.
- State is local; do not commit `.herdr-desk/runs/`.
