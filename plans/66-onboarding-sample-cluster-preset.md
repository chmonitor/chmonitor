# 66 — Onboarding: sample-cluster preset ("Try with sample ClickHouse")

## Goal
Add a "Try with sample ClickHouse" one-click preset to the dashboard first-run empty state + add-host dialog that autofills a read-only demo endpoint, plus a "connect your own cluster" convert CTA once the sample is connected. Track sample→real conversion.

## Current reality (audited)
First-run requires connecting a real cluster before the product does anything — a hard activation barrier. Pointers (verify at head):
- First-run: `apps/dashboard/src/components/host/first-run-empty-state.tsx` (siblings `first-run-gate.tsx`, `first-run-unauthorized-state.tsx`).
- Connection dialog: `apps/dashboard/src/components/connections/add-host-dialog.tsx` (also `connection-form.tsx`, `connection-manager-dialog.tsx`, `connection-help-panel.tsx`).
- Sample endpoint is a read-only demo ClickHouse (non-secret demo creds, not a committed secret).
- Connection persistence + host limit live in the connections store / `user-connections` route (verify); the preset just prefills the form — go through the normal add-host path, not a bypass.

## Implement now (depth F — file-level)
### A. First-run CTA — `first-run-empty-state.tsx`
- Add a secondary "Try with sample ClickHouse" action next to the existing primary CTA (keep primary unchanged + first). Clicking either opens `add-host-dialog` pre-filled with the sample preset, or initiates the sample connection through the normal add-host flow (pick the path reusing the most existing validation). Copy: *read-only sample dataset*.
### B. Sample preset in `add-host-dialog.tsx`
- Add a "Sample ClickHouse (read-only)" preset autofilling host/port/TLS/user for the demo endpoint (from a preset constant/env, not hand-typed). Runs the dialog's normal connectivity validation before saving; on success appears like any other connection. Do NOT expose control/kill actions for the sample host in copy.
### C. Convert CTA — after sample connected
- Once the sample host is active, surface a persistent, dismissible "Connect your own cluster" affordance (banner/card near host switcher or empty-state follow-up) opening `add-host-dialog` on the standard manual preset.
### D. Tracking — via plan-62 analytics wrapper
- Fire `sample_cluster_connected` when the sample connects and `sample_to_real_converted` when a non-sample host is subsequently added. Async, DNT-respecting, no PII (never log endpoint creds).

## STOP conditions & drift check
- STOP if a sample/demo preset already exists — reconcile/extend.
- STOP if wiring the preset requires bypassing normal add-host validation or the host-limit check — must use the same path (prefill only).
- DRIFT: if a preset abstraction already exists in `add-host-dialog.tsx`, extend it; don't add a second preset system.
- Don't gate first-run/preset behind Clerk/billing; fail open. Don't commit real customer creds.

## Done criteria
- "Try with sample ClickHouse" preset on first-run + add-host dialog autofills a read-only demo endpoint through the normal path.
- "Connect your own cluster" convert CTA appears after the sample is connected.
- `sample_cluster_connected`/`sample_to_real_converted` fire (DNT, no PII).
- Copy honestly states read-only; OSS first-run unchanged when unused; type-check/targeted test/lint green.
