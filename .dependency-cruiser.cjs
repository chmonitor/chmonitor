/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── No circular dependencies ──────────────────────────────────────────
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies cause hard-to-debug issues.',
      from: {
        pathNot: 'migration/',
      },
      to: { circular: true },
    },

    // ── Packages must not reach into apps ─────────────────────────────────
    {
      name: 'no-packages-to-apps',
      severity: 'error',
      comment:
        'Packages (@chm/*) must not import from apps/. This breaks publishability.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },

    // ── Apps must not import from other apps ──────────────────────────────
    // Generalized: forbid ANY apps/X → apps/Y (X !== Y). Covers every app
    // (blog, bug-handler, dashboard, docs, landing, mcp, telemetry, …) so new
    // apps are guarded automatically. Intra-app imports (apps/X → apps/X) are
    // allowed via the $1 back-reference to the captured app name.
    {
      name: 'no-cross-app-imports',
      severity: 'error',
      comment:
        'Apps must not import from other apps. Extract shared code into a @chm/* package instead.',
      from: { path: '^apps/([^/]+)/' },
      to: {
        path: '^apps/([^/]+)/',
        pathNot: '^apps/$1/',
      },
    },

    // ── Leaf packages must stay leaf-only ─────────────────────────────────
    // @chm/types, @chm/sql-builder, @chm/logger, @chm/platform, @chm/pricing,
    // @chm/postgres-client (types-only, may only reach @chm/types)
    {
      name: 'leaf-packages-no-internal-deps',
      severity: 'error',
      comment:
        'Leaf packages must not depend on higher-layer @chm/* packages.',
      from: {
        path: '^packages/(types|sql-builder|logger|platform|pricing|postgres-client)/',
      },
      to: {
        path: '^packages/(clickhouse-client|mcp-server)/',
      },
    },

    // ── lib/target must stay a platform-detection leaf (issue #2187) ──────
    // Orthogonal to deployment-mode (oss|cloud), edition, cloud, and any store.
    // It only detects the deploy platform and exposes bindings/env — it must
    // never reach "up" into product/config layers.
    {
      name: 'target-module-is-leaf',
      severity: 'error',
      comment:
        'lib/target must not import deployment-mode / edition / cloud / any store — it is a pure platform-detection leaf (issue #2187).',
      from: { path: '^apps/dashboard/src/lib/target/' },
      to: {
        // Match both resolved paths and the raw `@/` alias specifier
        // (depcruise has no alias resolver configured, so aliased imports keep
        // their `@/…` source string).
        path: [
          '^apps/dashboard/src/lib/cloud/',
          '^apps/dashboard/src/lib/config/deployment-mode',
          '^apps/dashboard/src/lib/edition/',
          '^apps/dashboard/src/lib/stores/',
          '^@/lib/cloud/',
          '^@/lib/config/deployment-mode',
          '^@/lib/edition/',
          '^@/lib/stores/',
          '/(zustand|redux|@reduxjs)/',
        ],
      },
    },

    // ── @chm/clickhouse-client must not depend on @chm/mcp-server ────────
    {
      name: 'clickhouse-client-layer',
      severity: 'error',
      comment:
        '@chm/clickhouse-client may only depend on leaf packages.',
      from: {
        path: '^packages/clickhouse-client/',
      },
      to: {
        path: '^packages/mcp-server/',
      },
    },
  ],

  options: {
    tsPreCompilationDeps: true,
    doNotFollow: {
      path: 'node_modules',
    },
  },
}
