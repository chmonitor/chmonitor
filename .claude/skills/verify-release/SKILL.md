---
name: verify-release
description: >-
  Check the chmonitor release pipeline before and after a release: the
  release-please config test, stale `autorelease: pending` labels, and the
  published dashboard tag, deploy, Docker image, Helm index, crates.io crate,
  and blog post. Use before merging a `chore(main): release …` PR, when
  release-please aborts with "untagged, merged release PRs outstanding", when
  a README version stays stale, or when `cargo publish --locked` fails.
---

# Verify a release

Pipeline background: [release-automation.md](../../../docs/knowledge/release-automation.md).
Three components release independently: dashboard (`vX.Y.Z`), CLI
(`chm-vX.Y.Z`), Helm chart (`helm-chmonitor-X.Y.Z`).

## 1. Preflight

Run both. Both must pass before anyone merges a release PR.

```sh
bun test tests/repo/release-please-config.test.ts
scripts/check-release-labels.sh
```

The test checks repo state: each config has a matching manifest, the manifest
version equals the package's own file (`Chart.yaml`, `Cargo.toml`,
`apps/dashboard/src/package.json`), README is a `generic` extra-file with one
version per line inside its release block, and the CLI publish step runs
`cargo update -p chmonitor` before `cargo publish`.

The script checks GitHub state: merged PRs still labeled
`autorelease: pending`. It prints a fix command per PR and exits 1 if any.

## 2. Cutting a release

Never merge a release PR on your own, and never arm auto-merge on one. Merge
only when the user explicitly asks for that PR. The global rule covers every
`chore(main): release …` PR and `release-please--*` branch.

## 3. Post-release checks

```sh
gh release list -R chmonitor/chmonitor --limit 5          # new tag is present
gh api repos/chmonitor/chmonitor/git/ref/tags/<tag>       # tag ref exists
gh run list -R chmonitor/chmonitor --workflow release.yml --limit 3
gh run list -R chmonitor/chmonitor --workflow cloudflare.yml --branch main --limit 3
docker manifest inspect ghcr.io/chmonitor/chmonitor:<X.Y.Z>   # no `v` prefix
curl -s https://charts.chmonitor.dev/index.yaml | grep -n 'version: <chart X.Y.Z>'
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'User-Agent: chmonitor-release-check (https://github.com/chmonitor/chmonitor)' \
  https://crates.io/api/v1/crates/chmonitor/<cli X.Y.Z>    # 200; crates.io 403s without a User-Agent
```

- Dashboard deploy: the `cloudflare.yml` run on the release commit is green,
  then follow the `verify-production` skill for the live product.
- Blog: a release post exists for dashboard releases (`blog.yml` run green).
- Run `scripts/check-release-labels.sh` again; a fresh merge must not leave a
  stale label.

## 4. Known failure modes

| Symptom | Cause | Fix |
|---|---|---|
| release-please aborts all components: "There are untagged, merged release PRs outstanding" | A merged release PR kept `autorelease: pending` (#4158). Helm uses `skip-github-release: true`, so its PRs are the usual offenders | `scripts/check-release-labels.sh`, then run its printed `gh pr edit … --add-label 'autorelease: tagged'` only for PRs whose tag exists |
| README shows a new version on one spot and the old version on another | The `generic` updater bumps only the first version on each line inside `x-release-please-start-version`/`end` | One version per line in the block (#4183). The config test enforces it |
| `cargo publish --locked` fails after a CLI release | The rust release PR bumps `Cargo.toml`, not `rust/Cargo.lock` | `cargo update -p chmonitor` before `cargo publish` in `cli-rust-release.yml` (#4187). The config test enforces it |
