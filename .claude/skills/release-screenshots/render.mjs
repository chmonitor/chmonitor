#!/usr/bin/env node
// Render framed release screenshots from a spec file.
//
//   node .claude/skills/release-screenshots/render.mjs <spec.json> <out-dir>
//
// spec.json is an array of shots (fields in SKILL.md). Each shot is drawn by
// frame.html at 1600x1000 CSS px, captured at DPR 2 with agent-browser, then
// written as <out-dir>/<name>.webp (2000px wide) via cwebp. Needs
// agent-browser, cwebp, and sips (macOS) on PATH.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [specPath, outDir] = process.argv.slice(2)
if (!specPath || !outDir) {
  console.error('usage: render.mjs <spec.json> <out-dir>')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const frameUrl = pathToFileURL(join(here, 'frame.html')).href
const specDir = dirname(resolve(specPath))
const shots = JSON.parse(readFileSync(specPath, 'utf8'))
const ab = (...args) => execFileSync('agent-browser', args, { encoding: 'utf8', timeout: 30_000 })

function imageSize(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' })
  return {
    w: Number(out.match(/pixelWidth: (\d+)/)[1]),
    h: Number(out.match(/pixelHeight: (\d+)/)[1]),
  }
}

// Resolve every src relative to the spec file and attach its pixel size, so
// frame.html can lay out crops before the image has loaded.
function withSource(pane) {
  const file = resolve(specDir, pane.src)
  return { ...pane, src: pathToFileURL(file).href, dims: imageSize(file) }
}

mkdirSync(outDir, { recursive: true })
const tmp = join(tmpdir(), `release-frame-${process.pid}.png`)
ab('set', 'viewport', '1600', '1000', '2')

for (const shot of shots) {
  const resolved = shot.layout === 'split'
    ? { ...shot, panes: shot.panes.map(withSource) }
    : withSource(shot)
  const hash = Buffer.from(JSON.stringify(resolved), 'utf8').toString('base64')
  // Query string per shot: a hash-only change would not reload the page.
  ab('open', `${frameUrl}?shot=${encodeURIComponent(shot.name)}#${hash}`)
  ab('wait', '--fn', 'document.body.dataset.ready === "1"')
  ab('screenshot', tmp)
  const out = join(outDir, `${shot.name}.webp`)
  execFileSync('cwebp', ['-quiet', '-q', '86', '-resize', '2000', '0', tmp, '-o', out])
  console.log(`✓ ${out}`)
}

rmSync(tmp, { force: true })
ab('close')
