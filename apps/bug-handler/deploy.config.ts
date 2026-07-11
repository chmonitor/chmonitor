// Deploy manifest for scripts/deploy-worker.ts — declares which env vars and
// secrets this worker needs so the unified deploy script never guesses.
//
// wrangler.toml already ships committed defaults for the vars below ([vars] /
// [env.preview.vars]); listing them here only lets an operator override them
// via env files without editing wrangler.toml. See apps/bug-handler/wrangler.toml
// for the full behavioural description.
export default {
  vars: [
    'GITHUB_REPOSITORY',
    'BUG_ISSUE_LABELS',
    'BUG_ISSUE_ASSIGNEES',
    'BUG_ISSUE_TITLE_PREFIX',
    'BUG_HANDLER_TARGET_ADDRESS',
  ],
  secrets: ['GITHUB_TOKEN'],
}
