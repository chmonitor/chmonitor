import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const DASHBOARD = resolve(import.meta.dir, '../../apps/dashboard')
const SRC = join(DASHBOARD, 'src')

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (/\.test\.tsx?$/.test(entry.name)) files.push(full)
  }
  return files
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Bodies of every `afterAll(...)` / `afterEach(...)` call in the source. */
function hookBodies(source: string): string[] {
  const bodies: string[] = []
  const open = /\bafter(?:All|Each)\s*\(/g
  for (let m = open.exec(source); m; m = open.exec(source)) {
    let depth = 1
    let i = m.index + m[0].length
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++
      else if (source[i] === ')') depth--
    }
    bodies.push(source.slice(m.index, i))
  }
  return bodies
}

/**
 * bun's `mock.module` patches the module registry for the whole test process.
 * A file that mocks a module must put the real one back from an `afterAll` /
 * `afterEach` hook (`mock.module(spec, () => real)` or `mock.restore()`),
 * otherwise later files in the same `bun test` run see the fake.
 */
export function mocksWithoutRestore(source: string): boolean {
  const code = stripComments(source)
  if (!/\bmock\.module\s*\(/.test(code)) return false
  return !hookBodies(code).some((body) =>
    /\bmock\.(?:module|restore)\s*\(/.test(body)
  )
}

/** Test files under apps/dashboard/src that mock a module and never restore it. */
export function findOffenders(): string[] {
  return walk(SRC)
    .filter((file) => mocksWithoutRestore(readFileSync(file, 'utf8')))
    .map((file) => relative(DASHBOARD, file))
    .sort()
}

export const DASHBOARD_ROOT = DASHBOARD
