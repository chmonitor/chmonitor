---
title: "Local Development"
editUrl: "https://github.com/duyet/clickhouse-monitoring/edit/main/docs/content/getting-started/local.mdx"
---

Run chmonitor from source for development or to test changes before deploying.

## The dashboard app

The dashboard is `apps/dashboard` (TanStack Start, v0.3+). Client env vars use the `VITE_*` prefix. The legacy Next.js app has been removed. The steps below target `apps/dashboard`.

## Steps

**1. Clone the repo**

```bash
git clone https://github.com/duyet/clickhouse-monitoring
cd clickhouse-monitoring
```

**2. Install dependencies**

The project uses [Bun](https://bun.sh). Install it first if you don't have it.

```bash
pnpm install
```

**3. Create `.env.local`**

In `apps/dashboard/`, create `.env.local`:

```bash
## Required
CLICKHOUSE_HOST=http://localhost:8123
CLICKHOUSE_USER=monitoring
CLICKHOUSE_PASSWORD=your-password

## Optional
CLICKHOUSE_NAME=local-dev
CLICKHOUSE_MAX_EXECUTION_TIME=60
CLICKHOUSE_TZ=UTC
EVENTS_TABLE_NAME=system.monitoring_events
```

Client-side variables in the TanStack app use `VITE_*` prefix. The Next.js app uses `NEXT_PUBLIC_*` for the same variables. For example:

| TanStack (`VITE_*`) | Next.js (`NEXT_PUBLIC_*`) |
|---|---|
| `VITE_AUTH_PROVIDER` | `NEXT_PUBLIC_AUTH_PROVIDER` |
| `VITE_CLERK_PUBLISHABLE_KEY` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` |
| `VITE_TITLE_SHORT` | `NEXT_PUBLIC_TITLE_SHORT` |

Client vars are inlined at build time. Never put secrets in `VITE_*` variables.

**4. Configure ClickHouse**

Make sure the user you set in step 3 has the right grants. See:

- [ClickHouse user & grants](/getting-started/clickhouse-requirements)
- [Enable system tables](/getting-started/clickhouse-enable-system-tables)

**5. Start the dev server**

```bash
cd apps/dashboard
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Common issues

**`localhost` connection refused** — If ClickHouse is not running locally, update `CLICKHOUSE_HOST` to point at your remote instance.

**Type errors on first run** — Run `pnpm run type-check` from the repo root. Some generated types require a build pass first.

**Missing system tables** — See [Enable system tables](/getting-started/clickhouse-enable-system-tables).
