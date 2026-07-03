// Global bun-test preload (wired via bunfig.toml `[test].preload`).
//
// Under `bun test` the app is neither the workerd nor the Nitro-node build, so
// the virtual module `cloudflare:workers` has no resolver — any test that
// transitively imports a route (→ `import { env } from 'cloudflare:workers'`)
// would crash at module load. The Node build aliases that specifier to
// cloudflare-workers-shim.ts (env backed by process.env); we register the same
// resolution here so every test file resolves it deterministically, instead of
// each file having to mock it and risking `--isolate` cross-file ordering flake.

import { env } from '../lib/cloudflare-workers-shim'
import { mock } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env }))
