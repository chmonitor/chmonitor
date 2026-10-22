/**
 * Regression for #4103: React #418 on `/explorer` during the Cypress sweep.
 *
 * React claims a non-hoistable element in `<head>` by position, starting at the
 * first child. Cypress's proxy inserts whitespace and a `<script>` at the very
 * start of `<head>` (a proxy, CDN or extension can do the same to a real user),
 * so the inline deploy-target `<script>` in `RootDocument` hit a text node,
 * could not be claimed, and React client-rendered the whole document. A `<meta>`
 * is hoistable: React matches it by lookup, so foreign head content is harmless.
 */

import type { ReactNode } from 'react'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

/** What a proxy or test runner puts at the start of the served `<head>`. */
function injectForeignHeadStart() {
  const head = document.head
  head.insertBefore(document.createElement('script'), head.firstChild)
  head.insertBefore(document.createTextNode(' '), head.firstChild)
}

async function hydrate(tree: () => ReactNode): Promise<string[]> {
  const { renderToString } = await import('react-dom/server')
  const { hydrateRoot } = await import('react-dom/client')
  document.open()
  document.write(`<!DOCTYPE html>${renderToString(<>{tree()}</>)}`)
  document.close()
  injectForeignHeadStart()

  const errors: string[] = []
  const root = hydrateRoot(document, <>{tree()}</>, {
    onRecoverableError: (error) => errors.push(String(error)),
  })
  await new Promise((resolve) => setTimeout(resolve, 100))
  root.unmount()
  return errors
}

const Body = () => (
  <body>
    <p>hello</p>
  </body>
)

describe('head hydration with foreign content at the start of <head>', () => {
  test('a deploy-target <meta> hydrates cleanly', async () => {
    const errors = await hydrate(() => (
      <html lang="en">
        <head>
          <meta name="chm-deploy-target" content="docker" />
          <title>t</title>
        </head>
        <Body />
      </html>
    ))
    expect(errors).toEqual([])
  })

  test('control: an inline <script> in <head> does not (the old markup)', async () => {
    const errors = await hydrate(() => (
      <html lang="en">
        <head>
          <title>t</title>
          <script
            dangerouslySetInnerHTML={{ __html: 'window.__X = "docker";' }}
          />
        </head>
        <Body />
      </html>
    ))
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join('\n')).toContain('hydrat')
  })
})

describe('getDeployTarget reads the server-rendered <meta>', () => {
  test('returns the meta content when it names a known target', async () => {
    const { DEPLOY_TARGET_META, getDeployTarget } = await import(
      '@/lib/telemetry/environment'
    )
    const meta = document.createElement('meta')
    meta.name = DEPLOY_TARGET_META
    meta.content = 'helm'
    document.head.appendChild(meta)
    try {
      expect(getDeployTarget()).toBe('helm')
      meta.content = 'not-a-target'
      expect(getDeployTarget()).not.toBe('not-a-target')
    } finally {
      meta.remove()
    }
  })
})

describe('__root.tsx', () => {
  const src = readFileSync(
    fileURLToPath(new URL('./__root.tsx', import.meta.url)),
    'utf8'
  )

  test('RootDocument renders no inline <script> inside <head>', () => {
    const doc = src.slice(src.indexOf('<html lang="en"'))
    const head = doc.slice(doc.indexOf('<head>'), doc.indexOf('</head>'))
    expect(head).toContain('<HeadContent />')
    expect(head).not.toContain('<script')
  })

  test('route head() carries the deploy-target meta', () => {
    expect(src).toContain('name: DEPLOY_TARGET_META')
  })
})
