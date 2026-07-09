/**
 * Open Graph social card generator for chmonitor.dev.
 *
 * Flat, on-brand 1200×630 card: enlarged brand lockup + headline on the left, a
 * faithful "Overview" dashboard panel (query count, p50/95/99 latency, failed
 * queries, memory) on the right, over a faint monitoring-waveform backdrop. One
 * shared template, per-page copy (eyebrow/headline/subhead) — see PAGES below.
 *
 * Rendered with resvg (deterministic text via the vendored TTFs — no system
 * fontconfig dependency) at 2× then downscaled with sharp for crisp type, and
 * palette-quantized (still visually lossless for this flat, few-color art) to
 * stay well under the ~100KB budget social platforms expect. OG scrapers don't
 * render SVG, so we ship PNG; the SVG stays the editable source.
 *
 *   cd apps/landing && bun run scripts/build-og.ts
 *
 * Emits public/og/og.png + og-light.png (home) and one dark image per
 * additional page in PAGES (public/og/og-<page>.png).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const fontsDir = join(here, 'og-fonts')
const outDir = join(here, '..', 'public', 'og')

const W = 1200
const H = 630
const ORANGE = '#f97316'
const EMERALD = '#10b981'
const VIOLET = '#8b5cf6'
const BLUE = '#3b82f6'
const ROSE = '#f43f5e'

const INK_R = 'Inter'
const INK_M = 'Inter Medium'
const INK_SB = 'Inter SemiBold'
const MONO_M = 'JetBrains Mono Medium'
const MONO_SB = 'JetBrains Mono SemiBold'

type Theme = typeof dark
const dark = {
  bg: '#0b0b0d',
  grid: '#ffffff',
  gridOp: 0.03,
  waveFill: 0.05,
  waveLine: 0.1,
  wordmark: '#fafafa',
  eyebrow: ORANGE,
  h1: '#fafafa',
  accent: ORANGE,
  sub: '#9a9aa3',
  domain: '#e4e4e7',
  slash: '#52525b',
  tagline: '#71717a',
  panelFill: '#101013',
  panelStroke: '#2a2a30',
  panelHead: '#161619',
  tileFill: '#16161a',
  tileStroke: '#26262c',
  metaDim: '#6b6b73',
  title: '#8a8a93',
  value: '#fafafa',
  live: EMERALD,
  axis: '#2e2e34',
  sparkFillOp: 0.16,
}
const light: Theme = {
  bg: '#ffffff',
  grid: '#09090b',
  gridOp: 0.045,
  waveFill: 0.05,
  waveLine: 0.14,
  wordmark: '#09090b',
  eyebrow: '#ea580c',
  h1: '#09090b',
  accent: '#ea580c',
  sub: '#52525b',
  domain: '#18181b',
  slash: '#d4d4d8',
  tagline: '#71717a',
  panelFill: '#ffffff',
  panelStroke: '#e4e4e7',
  panelHead: '#fafafa',
  tileFill: '#ffffff',
  tileStroke: '#ececef',
  metaDim: '#a1a1aa',
  title: '#71717a',
  value: '#09090b',
  live: '#059669',
  axis: '#ececef',
  sparkFillOp: 0.12,
}

// ── logo mark ────────────────────────────────────────────────────────────────
const BARS = [
  { x: 3.3, y: 13.05, h: 15.45 },
  { x: 8.7, y: 3.5, h: 25 },
  { x: 14.1, y: 13.25, h: 15.25 },
  { x: 19.5, y: 6.25, h: 22.25 },
  { x: 24.9, y: 16.8, h: 11.7 },
]
const BW = 3.8
const mark = (s: number, tx: number, ty: number) =>
  `<g transform="translate(${tx} ${ty}) scale(${s})">` +
  BARS.map(
    (b) =>
      `<rect x="${b.x}" y="${b.y}" width="${BW}" height="${b.h}" fill="${ORANGE}"/>`
  ).join('') +
  `<rect x="3.3" y="9.75" width="${BW}" height="3.3" fill="${EMERALD}"/></g>`

// ── path helpers ─────────────────────────────────────────────────────────────
type Pt = [number, number]
function smoothPath(pts: Pt[]) {
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i],
      p1 = pts[i],
      p2 = pts[i + 1],
      p3 = pts[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6,
      c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6,
      c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0]} ${p2[1]}`
  }
  return d
}
const linePath = (pts: Pt[]) =>
  `M ${pts.map((p) => `${p[0]} ${p[1]}`).join(' L ')}`
const mapPts = (
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  vals: number[]
): Pt[] =>
  vals.map((v, i) => [
    +(sx + (sw * i) / (vals.length - 1)).toFixed(1),
    +(sy + sh - v * sh).toFixed(1),
  ])

interface Copy {
  eyebrow: string
  h1Line1: string
  h1Line2: string
  sub1: string
  sub2: string
}

const HOME_COPY: Copy = {
  eyebrow: 'OPEN-SOURCE CLICKHOUSE MONITORING',
  h1Line1: 'A simple UI to',
  h1Line2: 'monitor ClickHouse',
  sub1: 'Queries, merges, parts, replication, health',
  sub2: '&#8212; and an AI agent. Self-host or cloud.',
}

function buildSvg(T: Theme, copy: Copy = HOME_COPY) {
  // chart series → area + line (optionally spiky / with end dot)
  const series = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    vals: number[],
    color: string,
    o: { fill?: boolean; spiky?: boolean; dot?: boolean } = {}
  ) => {
    const { fill = true, spiky = false, dot = false } = o
    const pts = mapPts(sx, sy, sw, sh, vals)
    const d = spiky ? linePath(pts) : smoothPath(pts)
    let out = ''
    if (fill)
      out += `<path d="${d} L ${pts.at(-1)![0]} ${sy + sh} L ${pts[0][0]} ${sy + sh} Z" fill="${color}" fill-opacity="${T.sparkFillOp}"/>`
    out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    if (dot)
      out += `<circle cx="${pts.at(-1)![0]}" cy="${pts.at(-1)![1]}" r="3.4" fill="${color}"/>`
    return out
  }
  const tile = (
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    value: string,
    body: string
  ) => {
    const px = 15
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="11" fill="${T.tileFill}" stroke="${T.tileStroke}" stroke-width="1"/>
<text x="${x + px}" y="${y + 26}" font-family="${MONO_M}" font-size="10.5" letter-spacing="0.8" fill="${T.title}">${title}</text>
<text x="${x + w - px}" y="${y + 26}" text-anchor="end" font-family="${MONO_SB}" font-size="14" letter-spacing="-0.2" fill="${T.value}">${value}</text>
${body}`
  }

  // ── background ─────────────────────────────────────────────────────────────
  const STEP = 48
  let gridLines = ''
  for (let x = STEP; x < W; x += STEP)
    gridLines += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${T.grid}" stroke-opacity="${T.gridOp}" stroke-width="1"/>`
  for (let y = STEP; y < H; y += STEP)
    gridLines += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${T.grid}" stroke-opacity="${T.gridOp}" stroke-width="1"/>`

  const wsamp = [
    0.18, 0.34, 0.24, 0.46, 0.3, 0.54, 0.4, 0.68, 0.5, 0.62, 0.44, 0.72, 0.58,
    0.84, 0.66, 0.78, 0.6, 0.9, 0.72, 1.0,
  ]
  const wBase = H + 2
  const wpts: Pt[] = wsamp.map((v, i) => [
    +((W * i) / (wsamp.length - 1)).toFixed(1),
    +(wBase - v * 188).toFixed(1),
  ])
  const wLine = smoothPath(wpts)
  const bgWave = `<path d="${wLine} L ${W} ${wBase} L 0 ${wBase} Z" fill="${ORANGE}" fill-opacity="${T.waveFill}"/><path d="${wLine}" fill="none" stroke="${ORANGE}" stroke-opacity="${T.waveLine}" stroke-width="2"/>`

  // ── overview panel ─────────────────────────────────────────────────────────
  const PX = 658,
    PY = 116,
    PW = 478,
    PH = 398
  const HEAD = 44
  const padX = 18
  const gx = PX + padX,
    gw = PW - padX * 2
  const gapX = 13,
    gapY = 13
  const tileW = (gw - gapX) / 2
  const gridTop = PY + HEAD + 56
  const gridBottom = PY + PH - 18
  const tileH = (gridBottom - gridTop - gapY) / 2
  const col2 = gx + tileW + gapX
  const row2 = gridTop + tileH + gapY
  const cb = (tx: number, ty: number) => ({
    sx: tx + 15,
    sy: ty + 42,
    sw: tileW - 30,
    sh: tileH - 42 - 14,
  })

  const c1 = cb(gx, gridTop)
  const t1 = tile(
    gx,
    gridTop,
    tileW,
    tileH,
    'QUERY COUNT',
    '2.7k',
    `<line x1="${c1.sx}" y1="${c1.sy + c1.sh}" x2="${c1.sx + c1.sw}" y2="${c1.sy + c1.sh}" stroke="${T.axis}" stroke-width="1"/>` +
      series(
        c1.sx,
        c1.sy,
        c1.sw,
        c1.sh,
        [
          0.32, 0.5, 0.4, 0.62, 0.52, 0.78, 0.6, 0.7, 0.55, 0.82, 0.68, 0.9,
          0.74, 1.0,
        ],
        ORANGE,
        { dot: true }
      )
  )

  const c2 = cb(col2, gridTop)
  const t2 = tile(
    col2,
    gridTop,
    tileW,
    tileH,
    'DURATION P50/95/99',
    '1.2s',
    `<line x1="${c2.sx}" y1="${c2.sy + c2.sh}" x2="${c2.sx + c2.sw}" y2="${c2.sy + c2.sh}" stroke="${T.axis}" stroke-width="1"/>` +
      series(
        c2.sx,
        c2.sy,
        c2.sw,
        c2.sh,
        [0.7, 0.55, 0.9, 0.5, 0.78, 0.62, 1.0, 0.6, 0.85, 0.7, 0.95, 0.66],
        ORANGE,
        { fill: false }
      ) +
      series(
        c2.sx,
        c2.sy,
        c2.sw,
        c2.sh,
        [0.4, 0.34, 0.52, 0.3, 0.46, 0.38, 0.58, 0.36, 0.5, 0.42, 0.56, 0.4],
        VIOLET,
        { fill: false }
      ) +
      series(
        c2.sx,
        c2.sy,
        c2.sw,
        c2.sh,
        [0.18, 0.15, 0.24, 0.14, 0.2, 0.17, 0.26, 0.16, 0.22, 0.19, 0.25, 0.18],
        EMERALD,
        { fill: false }
      )
  )

  const c3 = cb(gx, row2)
  const t3 = tile(
    gx,
    row2,
    tileW,
    tileH,
    'FAILED QUERIES',
    '12',
    `<line x1="${c3.sx}" y1="${c3.sy + c3.sh}" x2="${c3.sx + c3.sw}" y2="${c3.sy + c3.sh}" stroke="${T.axis}" stroke-width="1"/>` +
      series(
        c3.sx,
        c3.sy,
        c3.sw,
        c3.sh,
        [
          0.08, 0.05, 0.6, 0.1, 0.06, 0.85, 0.12, 0.07, 0.4, 0.05, 1.0, 0.15,
          0.06, 0.5,
        ],
        ROSE,
        { spiky: true }
      )
  )

  const c4 = cb(col2, row2)
  const t4 = tile(
    col2,
    row2,
    tileW,
    tileH,
    'MEMORY USAGE',
    '18.6G',
    `<line x1="${c4.sx}" y1="${c4.sy + c4.sh}" x2="${c4.sx + c4.sw}" y2="${c4.sy + c4.sh}" stroke="${T.axis}" stroke-width="1"/>` +
      series(
        c4.sx,
        c4.sy,
        c4.sw,
        c4.sh,
        [
          0.42, 0.45, 0.43, 0.5, 0.48, 0.92, 0.6, 0.52, 0.5, 0.55, 0.5, 0.58,
          0.54, 0.6,
        ],
        BLUE,
        { dot: true }
      )
  )

  // GitHub octocat mark (24×24 path) scaled into the footer.
  const gh = `<g transform="translate(285 543) scale(0.75)" fill="${T.tagline}"><path d="M12 .5C5.37.5 0 5.78 0 12.292c0 5.211 3.438 9.63 8.205 11.188.6.111.82-.254.82-.567 0-.28-.01-1.022-.015-2.005-3.338.711-4.042-1.582-4.042-1.582-.546-1.361-1.335-1.725-1.335-1.725-1.087-.731.084-.716.084-.716 1.205.082 1.838 1.215 1.838 1.215 1.07 1.803 2.809 1.282 3.495.981.108-.763.417-1.282.76-1.577-2.665-.295-5.466-1.309-5.466-5.827 0-1.287.465-2.339 1.235-3.164-.135-.298-.54-1.497.105-3.121 0 0 1.005-.316 3.3 1.209.96-.262 1.98-.392 3-.398 1.02.006 2.04.136 3 .398 2.28-1.525 3.285-1.209 3.285-1.209.645 1.624.24 2.823.12 3.121.765.825 1.23 1.877 1.23 3.164 0 4.53-2.805 5.527-5.475 5.817.42.354.81 1.077.81 2.182 0 1.578-.015 2.846-.015 3.229 0 .309.21.678.825.561C20.565 21.917 24 17.495 24 12.292 24 5.78 18.63.5 12 .5z"/></g>`

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
<clipPath id="phead"><rect x="${PX}" y="${PY}" width="${PW}" height="${HEAD}" rx="16"/></clipPath>

<rect width="${W}" height="${H}" fill="${T.bg}"/>
${gridLines}
${bgWave}

${mark(1.75, 80, 64)}
<text x="158" y="112" font-family="${INK_R}" font-size="35" font-weight="700" letter-spacing="-1.1" fill="${T.wordmark}">chmonitor</text>

<text x="82" y="232" font-family="${MONO_SB}" font-size="15" letter-spacing="3.5" fill="${T.eyebrow}">${copy.eyebrow}</text>

<text x="79" y="312" font-family="${INK_R}" font-size="59" font-weight="700" letter-spacing="-2.4" fill="${T.h1}">${copy.h1Line1}</text>
<text x="79" y="378" font-family="${INK_R}" font-size="59" font-weight="700" letter-spacing="-2.4" fill="${T.accent}">${copy.h1Line2}</text>

<text x="81" y="448" font-family="${INK_R}" font-size="25" letter-spacing="-0.3" fill="${T.sub}">${copy.sub1}</text>
<text x="81" y="482" font-family="${INK_R}" font-size="25" letter-spacing="-0.3" fill="${T.sub}">${copy.sub2}</text>

<circle cx="89" cy="552" r="5" fill="${EMERALD}"/>
<text x="105" y="558" font-family="${MONO_SB}" font-size="18" letter-spacing="-0.2" fill="${T.domain}">chmonitor.dev</text>
<text x="263" y="558" font-family="${INK_R}" font-size="18" fill="${T.slash}">/</text>
${gh}
<text x="312" y="558" font-family="${MONO_M}" font-size="17" letter-spacing="-0.2" fill="${T.tagline}">github.com/chmonitor</text>

<rect x="${PX}" y="${PY}" width="${PW}" height="${PH}" rx="16" fill="${T.panelFill}" stroke="${T.panelStroke}" stroke-width="1"/>
<rect x="${PX}" y="${PY}" width="${PW}" height="${HEAD}" fill="${T.panelHead}" clip-path="url(#phead)"/>
<line x1="${PX}" y1="${PY + HEAD}" x2="${PX + PW}" y2="${PY + HEAD}" stroke="${T.panelStroke}" stroke-width="1"/>
<circle cx="${PX + 22}" cy="${PY + 22}" r="5" fill="#ff5f57"/>
<circle cx="${PX + 39}" cy="${PY + 22}" r="5" fill="#febc2e"/>
<circle cx="${PX + 56}" cy="${PY + 22}" r="5" fill="#28c840"/>
<text x="${PX + 78}" y="${PY + 27}" font-family="${INK_SB}" font-size="13.5" letter-spacing="-0.2" fill="${T.value}">Overview</text>
<text x="${PX + PW - 18}" y="${PY + 27}" text-anchor="end" font-family="${MONO_M}" font-size="12" letter-spacing="0.3" fill="${T.metaDim}">24h</text>

<circle cx="${gx + 4}" cy="${PY + HEAD + 26}" r="4.5" fill="${T.live}"/>
<text x="${gx + 16}" y="${PY + HEAD + 31}" font-family="${INK_M}" font-size="13" letter-spacing="-0.1" fill="${T.value}">Cluster online</text>
<text x="${gx + 116}" y="${PY + HEAD + 31}" font-family="${MONO_M}" font-size="12" fill="${T.metaDim}">6 running · 2,689 today</text>
<text x="${gx + gw}" y="${PY + HEAD + 31}" text-anchor="end" font-family="${MONO_M}" font-size="12" fill="${T.metaDim}">v26.3 · 25d up</text>

${t1}
${t2}
${t3}
${t4}
</svg>`
}

const fontFiles = [
  'inter-400',
  'inter-500',
  'inter-600',
  'inter-700',
  'jbm-500',
  'jbm-600',
].map((f) => join(fontsDir, `${f}.ttf`))

async function render(theme: Theme, file: string, copy: Copy = HOME_COPY) {
  const svg = buildSvg(theme, copy)
  // Render at 2× (resvg's text is deterministic via the loaded TTFs), then
  // downscale to the 1200×630 OG spec for crisp anti-aliased type.
  const png2x = new Resvg(svg, {
    fitTo: { mode: 'width', value: W * 2 },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  })
    .render()
    .asPng()
  await sharp(png2x)
    .resize(W, H, { kernel: 'lanczos3' })
    // Palette-quantized PNG: this is flat, few-color synthetic art (grid,
    // waveform, sparklines, type) so 256-color quantization is visually
    // lossless here, and it cuts file size ~3× (150KB → ~48KB) to stay well
    // under the <100KB OG budget. Verified by eye against the true-color
    // render before landing this — re-check if the template's color count
    // grows a lot (e.g. photos/gradients).
    .png({ palette: true, quality: 90, effort: 10 })
    .toFile(join(outDir, file))
  console.log(`✓ ${file}`)
}

// Per-page copy for the additional marketing pages that share this template
// (see Base.astro `image` prop on each page). The home page keeps its
// dedicated dark + light pair; every other page gets one dark card.
const PAGES: { file: string; copy: Copy }[] = [
  {
    file: 'og-pricing.png',
    copy: {
      eyebrow: 'PRICING',
      h1Line1: 'Simple pricing',
      h1Line2: 'that scales with you',
      sub1: 'Self-host free under GPL-3.0, or use',
      sub2: 'the hosted cloud &#8212; early access now.',
    },
  },
  {
    file: 'og-changelog.png',
    copy: {
      eyebrow: 'CHANGELOG',
      h1Line1: "What's new in",
      h1Line2: 'chmonitor',
      sub1: 'Release notes for every version &#8212;',
      sub2: 'dashboard, AI agent, monitoring.',
    },
  },
  // SEO use-case pages (plans/64) — src/data/use-cases.ts, wired via
  // src/layouts/LandingPage.astro's `image` prop.
  {
    file: 'og-monitor-queries.png',
    copy: {
      eyebrow: 'QUERY MONITORING',
      h1Line1: 'Monitor ClickHouse',
      h1Line2: 'queries, live',
      sub1: 'Running, slow, failed, expensive',
      sub2: 'kill it, or get an EXPLAIN fix.',
    },
  },
  {
    file: 'og-cluster-health.png',
    copy: {
      eyebrow: 'CLUSTER HEALTH',
      h1Line1: 'ClickHouse cluster',
      h1Line2: 'health, at a glance',
      sub1: 'Every health signal in one board,',
      sub2: 'with alerts to Slack or Discord.',
    },
  },
  {
    file: 'og-replication.png',
    copy: {
      eyebrow: 'REPLICATION',
      h1Line1: 'Monitor ClickHouse',
      h1Line2: 'replication lag',
      sub1: 'Topology, read-only replicas,',
      sub2: 'replication and DDL queues.',
    },
  },
  {
    file: 'og-performance.png',
    copy: {
      eyebrow: 'PERFORMANCE',
      h1Line1: 'ClickHouse query',
      h1Line2: 'performance tuning',
      sub1: 'Slowest queries, EXPLAIN suggestions,',
      sub2: 'capacity and TTL advisor.',
    },
  },
  // Comparison pages (plans/68) — src/pages/vs-*.astro.
  {
    file: 'og-vs-clickhouse-cloud.png',
    copy: {
      eyebrow: 'VS CLICKHOUSE CLOUD',
      h1Line1: 'chmonitor vs',
      h1Line2: 'ClickHouse Cloud',
      sub1: 'An independent ops and advisor layer,',
      sub2: 'not a hosting replacement.',
    },
  },
  {
    file: 'og-vs-datadog.png',
    copy: {
      eyebrow: 'VS DATADOG',
      h1Line1: 'chmonitor vs',
      h1Line2: 'Datadog',
      sub1: 'ClickHouse specialist vs full-stack',
      sub2: 'APM &#8212; honest, feature by feature.',
    },
  },
  {
    file: 'og-vs-grafana.png',
    copy: {
      eyebrow: 'VS GRAFANA',
      h1Line1: 'chmonitor vs',
      h1Line2: 'Grafana',
      sub1: 'ClickHouse-native pages vs a',
      sub2: 'general-purpose dashboard canvas.',
    },
  },
]

await render(dark, 'og.png')
await render(light, 'og-light.png')
for (const page of PAGES) await render(dark, page.file, page.copy)
console.log('done')
