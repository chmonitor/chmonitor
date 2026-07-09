// Transform the working docs (docs/content/**) into Fumadocs content
// (apps/docs/content/docs/**). Runs as a prebuild step.
//
// docs/content/** is the single committed source of truth; everything written
// under content/docs/** is a generated artifact (gitignored). There is no
// per-release versioning: the working docs are served at the site root.
//
// Key differences from the old Starlight sync-docs.mjs:
//  - Output goes to content/docs/ (not src/content/docs/)
//  - Frontmatter uses only `title` and optional `description`; no Starlight-
//    specific `sidebar:`, `editUrl:`, or `order:` fields.
//  - The h1 heading is KEPT in the body as a comment-strip (Fumadocs renders
//    the DocsTitle from frontmatter.title separately, so the body h1 would
//    duplicate it — we strip it). Remaining `# ` headings are left as-is
//    (Fumadocs doesn't demote them automatically).
//  - /docs/X links are NOT rewritten — the docs site serves at the root so
//    the existing /docs/X hrefs resolve correctly.
//  - Local image paths are rewritten to raw.githubusercontent.com URLs (same
//    as before, because the built Worker has no access to the repo filesystem).
//  - meta.json files are generated at root and per-section to control the
//    Fumadocs sidebar order and display names.

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')
const SRC_DIR = resolve(REPO_ROOT, 'docs/content')
const DEST_DIR = resolve(__dirname, '../content/docs')
const RAW_BASE = 'https://raw.githubusercontent.com/chmonitor/chmonitor/main'

// Information architecture: three top-level tabs (Fumadocs "Layout Tabs"),
// rendered as a sidebar dropdown (tabMode: 'auto'). Only the active tab's tree
// is shown. The source tree under docs/content/** mirrors this structure, so
// page URLs are /<tab>/<section>/<page>. Old flat URLs are redirected in
// src/routes/$.tsx (DOC_REDIRECTS).
//
// Tab order in the dropdown.
const ROOT_PAGES = ['guide', 'operate', 'reference']

// Per-folder metadata, keyed by the folder's path relative to content/docs.
// `root: true` promotes a folder to a layout tab. `pages` sets sidebar order;
// "index" is the folder landing, "---Text---" renders a group separator.
// Folders without an entry fall back to a humanized name and default order.
const FOLDER_META = {
  // ── Tab 1: Guide ────────────────────────────────────────────────────────
  guide: {
    title: 'Guide',
    icon: 'BookOpen',
    root: true,
    pages: ['index', 'getting-started', 'features', 'ai-agent', 'guides'],
  },
  'guide/getting-started': {
    title: 'Getting Started',
    icon: 'Rocket',
    pages: [
      'index',
      'clickhouse-requirements',
      'clickhouse-enable-system-tables',
      'local',
    ],
  },
  'guide/features': {
    title: 'Features',
    icon: 'LayoutGrid',
    pages: [
      'index',
      '---Monitoring---',
      'overview',
      'queries',
      'tables',
      'explorer',
      'metrics',
      'cluster',
      '---Health & Insights---',
      'health',
      'insights',
      'logs',
      '---Operations---',
      'operations',
      'security',
      'dashboard',
      '---Integrations---',
      'mcp',
      'peerdb',
      'browser-connections',
      'user-connections',
      'settings',
    ],
  },
  'guide/ai-agent': {
    title: 'AI Agent',
    icon: 'Bot',
    pages: ['index', 'capabilities', 'configuration', 'conversation-history'],
  },
  'guide/guides': {
    title: 'Guides',
    icon: 'Compass',
    pages: [
      'proxy-auth-setup',
      'slack-app',
      'troubleshooting',
      'too-many-parts',
      'merges-slower-than-inserts',
      'memory-limit-exceeded',
      'memory-limit-total-exceeded',
      'upgrade-clickhouse',
      '---Query optimization---',
      'clickhouse-query-optimization',
      'partition-key-best-practices',
      'partition-granularity',
      'prewhere-vs-where',
      'projections-vs-materialized-views',
      'skip-indices-guide',
      'external-group-by',
    ],
  },
  // ── Tab 2: Deploy & Operate ────────────────────────────────────────────
  operate: {
    title: 'Deploy & Operate',
    icon: 'Ship',
    root: true,
    pages: ['index', 'deploy', 'authentication', 'advanced'],
  },
  'operate/deploy': {
    title: 'Deployment',
    icon: 'Container',
    pages: [
      'index',
      'docker',
      'k8s',
      'cloudflare',
      'vercel',
      'self-host',
      'traefik',
      'one-click',
      'production-checklist',
    ],
  },
  'operate/authentication': {
    title: 'Authentication',
    icon: 'ShieldCheck',
    pages: [
      'index',
      'public',
      'api-keys',
      'clerk',
      'cloudflare-access',
      'trusted-header',
      'trusted-proxy',
    ],
  },
  'operate/advanced': {
    title: 'Advanced',
    icon: 'Settings2',
    pages: [
      'feature-permissions',
      'multiple-hosts',
      'editions',
      'queries-history',
      'self-tracking',
      'telemetry',
      'agent-conversation-storage',
      'custom-name',
      'peerdb-monitoring',
    ],
  },
  // ── Tab 3: Reference ───────────────────────────────────────────────────
  reference: {
    title: 'Reference',
    icon: 'BookMarked',
    root: true,
    pages: [
      'index',
      'environment-variables',
      'configuration',
      'connection-presets',
      'support-matrix',
      '---MCP---',
      'mcp-server',
      'mcp-clients',
      '---Integrations---',
      'grafana-bridge',
      'catalog-contributing',
      '---Project---',
      'releases',
      'migrating',
      'faq',
      'settings',
    ],
  },
  'reference/releases': {
    title: 'Releases',
    icon: 'Tag',
    pages: ['index', 'v0-3'],
  },
  'reference/migrating': {
    title: 'Migrating',
    icon: 'ArrowRightLeft',
    pages: ['v0-3'],
  },
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else if (/\.mdx?$/.test(entry.name)) files.push(full)
  }
  return files
}

// Split off a leading `--- ... ---` YAML block. Returns { data, body }.
function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { data: {}, body: src }
  const data = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (!kv) continue
    let value = kv[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    data[kv[1]] = value
  }
  return { data, body: src.slice(m[0].length) }
}

function stripImports(src) {
  return src.replace(
    /^import\s+.*\s+from\s+['"](?:nextra\/components|lucide-react)['"]\s*\n/gm,
    '',
  )
}

// Remove the first top-level `# Heading` (it becomes frontmatter.title).
// Unlike the Starlight sync, we do NOT demote remaining `# ` headings
// (Fumadocs allows multiple h1 levels in body content).
function extractTitle(src, fallback) {
  const lines = src.split('\n')
  let title = fallback
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.+)$/)
    if (m) {
      title = m[1].trim()
      lines.splice(i, 1)
      // Remove a blank line immediately after the heading
      if (lines[i] !== undefined && lines[i].trim() === '') lines.splice(i, 1)
      break
    }
  }
  return { title, body: lines.join('\n') }
}

// Rewrite local image references to raw.githubusercontent.com URLs.
function rewriteImages(src, srcFileAbs) {
  const fileDirRel = posix.dirname(relative(REPO_ROOT, srcFileAbs))
  return src.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    if (/^https?:\/\//.test(url)) return match
    let repoPath
    if (url.startsWith('/')) repoPath = `apps/dashboard/public${url}`
    else repoPath = posix.normalize(posix.join(fileDirRel, url))
    return `![${alt}](${RAW_BASE}/${repoPath})`
  })
}

// Rewrite legacy `/docs/...` internal links to root-relative `/...`.
// The Starlight site served docs under `/docs`; Fumadocs serves them at the
// site root, so any `/docs/` href is a dead link. This normalizes both Markdown
// links `](/docs/x)` and JSX `href="/docs/x"` (used in <Card>) to `/x`.
function rewriteDocLinks(src) {
  return src
    .replace(/\]\(\/docs\//g, '](/') // [text](/docs/x) → [text](/x)
    .replace(/\]\(\/docs\)/g, '](/)') // [text](/docs)   → [text](/)
    .replace(/href="\/docs\//g, 'href="/') // href="/docs/x" → href="/x"
    .replace(/href="\/docs"/g, 'href="/"') // href="/docs"   → href="/"
}

function humanize(slug) {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Set of every directory path (relative to `root`, posix-style) at any depth.
async function collectDirs(root, base = root, out = new Set()) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(root, entry.name)
    out.add(relative(base, full).split(sep).join('/'))
    await collectDirs(full, base, out)
  }
  return out
}

async function main() {
  if (!existsSync(SRC_DIR)) {
    throw new Error(`Source docs not found at ${SRC_DIR}`)
  }

  // Collect every directory (at any depth) relative to SRC_DIR. A file whose
  // path-without-extension matches a directory is that folder's landing page,
  // e.g. guide/features.mdx + guide/features/ → guide/features/index.mdx.
  const sectionDirs = await collectDirs(SRC_DIR)

  await rm(DEST_DIR, { recursive: true, force: true })
  await mkdir(DEST_DIR, { recursive: true })

  const files = await walk(SRC_DIR)
  let total = 0
  for (const fileAbs of files) {
    const rel = relative(SRC_DIR, fileAbs).split(sep).join('/')
    const noExt = rel.replace(/\.mdx?$/, '')
    const isSectionLanding = sectionDirs.has(noExt)

    let content = await readFile(fileAbs, 'utf8')
    const { data: fm, body: afterFm } = parseFrontmatter(content)
    content = stripImports(afterFm)
    content = rewriteImages(content, fileAbs)
    // Legacy /docs/* links → root-relative (the site now serves at /).
    content = rewriteDocLinks(content)

    const fallback = humanize(noExt.split('/').pop())
    const { title: h1Title, body } = extractTitle(content, fallback)
    const title = fm.title || h1Title

    // Fumadocs frontmatter: title, optional description, optional Lucide icon.
    let frontmatter = `---\ntitle: ${JSON.stringify(title)}\n`
    if (fm.description) frontmatter += `description: ${JSON.stringify(fm.description)}\n`
    if (fm.icon) frontmatter += `icon: ${JSON.stringify(fm.icon)}\n`
    frontmatter += `---\n\n`

    // Section landings: write as <section>/index.mdx so Fumadocs creates a
    // linked section root that appears as "Overview" first in its group.
    //
    // Output is .mdx (not .md) so MDX expression syntax — `<Tabs items={[…]}>`,
    // `<Mermaid chart={`…`} />` — is evaluated. The `.md` (CommonMark) format
    // treats `{…}` as literal text, which would render those components broken.
    const destRel = isSectionLanding ? `${noExt}/index.mdx` : `${noExt}.mdx`
    const dest = join(DEST_DIR, destRel)

    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, `${frontmatter}${body.trim()}\n`, 'utf8')
    total++
  }

  // Root meta.json — controls tab order in the dropdown.
  await writeFile(
    join(DEST_DIR, 'meta.json'),
    JSON.stringify({ pages: ROOT_PAGES }, null, 2) + '\n',
    'utf8',
  )

  // Per-folder meta.json — display name, sidebar icon, page order, and tab
  // promotion (`root: true`). Non-root folders get `defaultOpen: false` so the
  // tree stays tidy; Fumadocs auto-expands the folder of the active page.
  for (const [folder, cfg] of Object.entries(FOLDER_META)) {
    const folderDir = join(DEST_DIR, folder)
    if (!existsSync(folderDir)) continue
    const meta = cfg.root
      ? { title: cfg.title, icon: cfg.icon, root: true }
      : { title: cfg.title, icon: cfg.icon, defaultOpen: false }
    if (cfg.pages) meta.pages = cfg.pages
    await writeFile(
      join(folderDir, 'meta.json'),
      JSON.stringify(meta, null, 2) + '\n',
      'utf8',
    )
  }

  console.log(
    `[sync-docs] ${total} page(s) → content/docs (Fumadocs, served at /)`,
  )
}

await main()
