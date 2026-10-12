# pstack adapter audit — 2026-10-12

## Audited

- `.claude/skills/pstack/{SKILL.md,README.md,features/*.md}` and `upstream/{SOURCE.md,VERSION,README.md}`,
  plus `docs/knowledge/pstack-validation.md`.
- Checked against `.github/workflows/{test,a11y,cloudflare,ci,k8s-lint,helm-release,cli-rust-ci,cli-report,cli-rust-release}.yml`,
  `docker-compose.yml`, root `package.json`, and `apps/dashboard/scripts/verify-deploy.ts`.
- All 26 paths that the adapter cites exist: tests, Cypress specs, the `verify-chmonitor` scripts, `ui-ux-audit`,
  and the Helm test.
- Cited workflow steps exist:
  - `Type-check dashboard tests`, `Verify deployment`, and `Chart smoke test` in `cloudflare.yml`.
  - The `validate-docker` checks of `/`, `/api/healthz`, and `/api/version`.
  - The cargo fmt/clippy/build/test/publish-dry-run steps.
  - The five a11y routes, with `continue-on-error`.
- The upstream tree has not been touched since it was vendored in #3429. It has 153 files in 74 directories, which matches `SOURCE.md`.
- `tests/repo/markdown-links.test.ts` passes after the edits.

## Changed

1. `features/README.md`: names the required checks, `unit-tests` (test.yml) and `dashboard` (cloudflare.yml). Also marks
   `e2e-test`, `coverage-upload`, and `axe-core` as non-required. Source: AGENTS.md. The branch-protection API returned 404.
2. `features/README.md`: the PeerDB row now names `.github/workflows/agent-eval.yml` instead of "agent eval".
3. `SKILL.md` Launch: `verify-deploy.ts` without `--base-url` defaults to production `dash.chmonitor.dev`. The example now
   passes `--base-url https://preview.dash.chmonitor.dev --skip-auth`.
4. `features/deploy-cli.md`: the compose healthcheck uses `/healthz`, but `pnpm run docker:health` hits the ClickHouse-gated
   `/api/healthz`. The old gotcha implied that both used `/healthz`.
5. `features/dashboard-ui.md`: notes that `e2e-test` is non-required, so check that it ran.
6. `README.md` and `SKILL.md`: the runtime wording is now neutral. The adapter no longer says it is OpenCode-only.
   - The leaked machine-specific name "Space Bunny Free" is removed. It appeared only at `README.md:64`.
   - The runtime boundary now says that `Agent` and `poteto-agent` work as written on Claude Code, and that other runtimes translate them.
   - The repo has no `opencode.json` or `.opencode*`, and `.claude/settings.json` wires Claude hooks.

**Commit note:** an environment auto-commit hook committed items 1–5 and pushed them directly to `origin/main` as
`eb56b6f0` (`auto-commit: M, M, M, M`). The author is `Duyệt <me@duyet.net>` with a `Co-authored-by: duyetbot` trailer. I did not
make that commit. The message is not semantic and the change skipped the PR flow. I left it alone because the
rule is never to force-push. Item 6 (`README.md`, `SKILL.md`) is still uncommitted in the working tree unless the hook fires again.

## Open follow-ups (PR ideas)

1. **`feat(pstack): add query-config feature entry`**: the biggest gap. `test.yml` jobs `test-queries-config`
   (ClickHouse 26.7 + Keeper, `CHM_LIVE_CLICKHOUSE=1`, runs on every PR, not required) and
   `test-postgres-integration` have no entry in the feature map.
   - Gotchas the entry needs: CI covers only ClickHouse 26.7, so `since` branches below it are not exercised. Without
     `CHM_LIVE_CLICKHOUSE=1`, live cases pass vacuously (`output-columns-live.test.ts:141-150`).
   - The poteto-agent drafted `features/query-config.md`. Postgres integration fits as a bullet in
     `api-auth-security.md`, since it covers the SSRF guard in `execute-pg-query.integration.test.ts`.
2. **`fix(pstack): make upstream manifest hash reproducible`**: `upstream/SOURCE.md` gives the content-manifest
   hash `9c842ce0…` only in prose. No command variant reproduces it.
   - Record the exact command: run `find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum` from
     `upstream/skills`. The current tree gives `d27b3902…dacce`.
   - Before swapping the hash, re-verify against the `v0.9.44` tarball (SHA-256 `fe6f17fa…`).
3. **`docs(knowledge)`**: `docs/knowledge/pstack-validation.md` still says `updated: 2026-09-25`.
   - Bump the date in the same change as follow-up 1.
   - Add the required/non-required split there too, so the doc and the skill don't drift.
4. **Upstream drift**: the pin is `v0.9.44` from 2026-09-25. Check upstream for newer releases. That needs a network
   fetch and a refresh using the procedure in `SOURCE.md`.

Confidence: high on the factual fixes, which were checked against workflow files. Medium on the required-check list,
which comes from AGENTS.md because the branch-protection API returned 404.
