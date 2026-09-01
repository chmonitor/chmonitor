# Canonical prove: local-connections

Live checkout of `cursor/verify-chmonitor-skill-f587` (git `545f8867`), 2026-09-01.

Path: `launch.sh` → identity-only `doctor.sh` (no dash.chmonitor.dev HTTP) →
`drive.sh local-connections` (add / ls / use / rm on isolated `--config`) →
`redact-check.sh` → `cleanup.sh`. Evidence directory still exists after
cleanup; scratch was removed.

No `credentials` sidecar. No `doctor-connectivity.json` (HTTP skipped).

Allowlist comments on a few lines are for the repo secret scanner (product
engine name, not a password). Original transcripts are in `prove-log.txt`.
