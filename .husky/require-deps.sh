#!/usr/bin/env sh
# Shared guard for every git hook: they all shell out to `pnpm exec` / pnpm
# scripts, which crash with a raw error when root node_modules is missing
# (fresh clone, isolated apps/dashboard install). Source it: `. "$(dirname "$0")/require-deps.sh"`

[ -d node_modules ] || {
  echo "Root node_modules missing - run 'pnpm install' at the repo root first." >&2
  exit 1
}
