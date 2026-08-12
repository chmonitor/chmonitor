---
id: sql-validator-threat-model
title: SQL Validator Threat Model & False-Positive Class
type: decision
status: active
updated: 2026-08-12
tags:
  - security
  - sql
  - validation
  - mcp
related:
  - mcp-server
  - query-config-format
---

# SQL Validator Threat Model & False-Positive Class

`validateSqlQuery` (`packages/sql-builder/src/sql-validator.ts`) is the gate for
**every free-form SQL entry point**: AI agent tools, the MCP `query` tool, the
explorer custom-query box, and the `/api/v1/data` + `/api/v1/explain` routes.

## Threat model (important)

The validator receives the **entire query** as supplied by the caller — there is
**no** "trusted query + untrusted fragment" string concatenation. So classic
SQL-injection signatures that defend against *fragment* injection are the wrong
model here and only generate false positives:

- **UNION-append** (`… UNION SELECT secret …`) — pointless to block, because the
  validator already permits `SELECT secret FROM system.users` on its own. UNION
  of two SELECTs adds no read surface.
- **OR-tautology on identifiers** (`col = 'A' OR col = 'B'`) — an ordinary
  disjunctive filter, not an attack.
- **Keyword/function collisions** — `REPLACE` (the read-only `replace()` string
  function) collided with the `\bREPLACE\b` DDL keyword.

The controls that actually matter (all retained):

1. Statement must start with `SELECT` / `WITH` / `DESCRIBE` / `EXPLAIN`.
2. DDL/DML keyword block (`DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|TRUNCATE|RENAME`)
   + `CHAINED_DANGEROUS` for `; <ddl>`.
3. Dangerous **table-function** block (`remote|url|s3|file|executable|…`).
4. ClickHouse-side readonly user + parameterized `{name:Type}` placeholders.

## The false-positive incident (2026-06-20)

8 **shipped** query-configs were rejected by their own validator
(anomaly-summary, explorer-all/table-dependencies, expensive-queries,
slow-queries, error-rate-baseline). Root causes + fixes:

| Pattern | Was | Now |
|---------|-----|-----|
| `UNION_INJECTION` | enforced | kept as exported constant, **removed from enforcement array** |
| `DANGEROUS_KEYWORDS` | included `REPLACE` | **`REPLACE` removed** (DDL form still blocked by prefix-check + `CHAINED_DANGEROUS`) |
| `STRING_INJECTION_OR_SINGLE` / `_DOUBLE` | broad `'.*OR.*'.*=.*'` | precise `\bOR\s+('[^']*'?\|\d+)\s*=\s*('[^']*'?\|\d+)` — requires a **literal** (not identifier) on the left of `=` |

The tightened OR-patterns are also **ReDoS-safe** (the old nested `.*` runs risked
catastrophic backtracking).

## Comment-bypass hardening (2026-07-10, issue #2465)

The keyword/function blocklists are raw-text regexes, and `DANGEROUS_FUNCTIONS`
matched `<name>\s*(`. `\s*` matches whitespace but **not** a comment, so
`remote/*x*/('h','d','t')` and `url/**/('http://169.254.169.254/…')` parsed
identically for ClickHouse (a comment is insignificant whitespace between tokens)
yet slipped past the guard — an unauthenticated SSRF/exfiltration vector on the
default `auth: none` self-hosted install.

Fix: `validateSqlQuery` now runs **all** injection/function patterns (and the
statement-type prefix check) against a comment-normalized copy produced by
`stripSqlComments`. That helper walks the string and replaces every `/* */`
block, `--` line, and `#` line comment with a single space — matching
ClickHouse's own tokenization (`remote/**/(` → `remote (` → blocked; a comment
*inside* an identifier stays split, as ClickHouse reads it). Crucially it leaves
string literals (`'…'`), double-quoted and backtick identifiers untouched
(honoring `\` escapes and doubled quotes), so a benign literal like
`'-- text'` or `'/* text */'` is never mistaken for a comment. Regression cases
live in `sql-validator.test.ts` ("dangerous functions via comment bypass").

## String literals are data, not SQL (2026-08-12, issue #2949)

The blocklists are raw-text regexes, so they also matched *inside* string
literals: `SELECT query FROM system.query_log WHERE query LIKE '%DROP TABLE%'`
was rejected as a DROP statement. Auditing DDL history or hunting `s3()`/`url()`
usage in `system.query_log` is routine read-only monitoring, and it was
impossible on every free-form surface.

Fix: `stripSqlComments(sql, { blankLiterals: true })` produces a second copy in
which the **contents** of single-quoted literals are replaced by spaces
(newlines preserved) while the delimiting quotes stay put — the query keeps its
structure, so `STRING_INJECTION_OR_SINGLE` still sees `OR ' '=' '` and rejects
the tautology. All `SQL_INJECTION_PATTERNS` scan that copy; the statement-type
prefix check still runs on the comment-only-normalized copy. Double-quoted and
backtick identifiers are **never** blanked (they are names, and
`STRING_INJECTION_DOUBLE` needs them). Escapes (`''` and `\'`) are blanked as
content, so a literal can never be split in half. Regression cases live in
`sql-validator.test.ts` ("blocked keywords inside string literals").

Anything outside a literal is still blocked, unchanged — chained DDL, table
functions, comment-obfuscated calls (the two passes compose).

## Rule: keep shipped SQL and the validator in sync

Any query the dashboard ships must pass `validateSqlQuery`. This is guarded by a
corpus-wide regression test:
`apps/dashboard/src/lib/query-config/__tests__/shipped-sql-passes-validator.test.ts`
(runs **every** query-config SQL variant through the validator). If you add a
config that uses a construct the validator blocks, fix the **validator's threat
model**, not the query — and add a targeted case to
`packages/sql-builder/src/__tests__/sql-validator.test.ts`. A throughput + ReDoS
benchmark lives at `…/__tests__/sql-validator.bench.ts`.
