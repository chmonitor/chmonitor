---
table: system.processes
---

# system.processes Schema History

## Change History

| Version | Change |
|---------|--------|
| 24.1+ | Seeded `peak_threads_usage` (availability on processes historically lagged docs; verify on target host) |
| 26.6+ | Added `client_agent` — detected AI coding agent for the client session |

## Version Compatibility Matrix

| Column | Since | Description |
|--------|-------|-------------|
| peak_threads_usage | 24.1+ | Peak threads for the running query (confirm on older 24.x hosts before selecting) |
| client_agent | 26.6 | Detected client AI agent name |

## Notes

- Prefer VersionedSql when selecting version-new process columns so older hosts still resolve.

