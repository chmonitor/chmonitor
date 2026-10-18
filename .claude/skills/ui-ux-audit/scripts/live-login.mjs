#!/usr/bin/env bun
/**
 * Populate the persistent Clerk browser profile used by the live audit target.
 *
 * Runs HEADED (Cloudflare Turnstile on pk_live only auto-passes in a real,
 * non-headless browser). Signs the dedicated test account in; Clerk persists the
 * full client state into the userDataDir, so `audit.mjs --target=live` can then
 * run headless and stay authorized.
 *
 * If a verification code is required, it is emailed to duyet.cs@gmail.com (the
 * plus-addressed inbox). Read it via the Gmail MCP and write it to
 * /tmp/chm-otp.txt; this script polls that file.
 *
 *   HEADLESS=0 bun live-login.mjs          # normal (headed)
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'

const HOME = process.env.HOME
const creds = JSON.parse(readFileSync(`${HOME}/.config/chmonitor/test-account.json`, 'utf8'))
const USERDATA = `${HOME}/.config/chmonitor/clerk-userdata`
const TARGET = 'https://dash.chmonitor.dev/overview?host=0'
const OTP_FILE = '/tmp/chm-otp.txt'
const SHOT = '/tmp/chm-login'
mkdirSync(USERDATA, { recursive: true })
mkdirSync(SHOT, { recursive: true })
const headless = process.env.HEADLESS === '1'
const log = (...a) => console.log(`[login ${new Date().toISOString().slice(11, 19)}]`, ...a)

const ctx = await chromium.launchPersistentContext(USERDATA, {
  headless,
  viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
})
const page = ctx.pages()[0] || (await ctx.newPage())
const shot = (n) => page.screenshot({ path: `${SHOT}/${n}.png` }).catch(() => {})

async function firstVisible(selectors, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const s of selectors) {
      const loc = page.locator(s).first()
      if (await loc.isVisible().catch(() => false)) return loc
    }
    await page.waitForTimeout(250)
  }
  return null
}
async function authorized() {
  return await page.evaluate(async () => {
    try { const r = await fetch('/api/v1/hosts'); return r.ok } catch { return false }
  })
}

try {
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(3500)
  if (await authorized()) { log('already signed in (profile still valid) — nothing to do'); writeFileSync('/tmp/chm-login-status.txt', 'ALREADY\n'); await ctx.close(); process.exit(0) }

  const trigger = await firstVisible(['[data-testid="nav-user-trigger"]', 'button:has-text("Sign In")', 'button:has-text("Sign in")'], 10000)
  if (!trigger) throw new Error('Sign In trigger not found')
  await trigger.click()
  await page.waitForTimeout(2500)
  await shot('01-modal')

  // Sign-in form: identifier (email) first
  const email = await firstVisible(['input[name="identifier"]', 'input[type="email"]', 'input[name="emailAddress"]'], 8000)
  if (!email) throw new Error('email field not found')
  await email.fill(creds.email)
  let cont = await firstVisible(['.cl-formButtonPrimary', 'button:has-text("Continue")', 'button[type="submit"]'], 5000)
  if (cont) { await cont.click(); await page.waitForTimeout(2500) }

  // Password step (may be same step or next)
  const pw = await firstVisible(['input[name="password"]:not([disabled])', 'input[type="password"]:not([disabled])'], 8000)
  if (pw) {
    await pw.fill(creds.password)
    cont = await firstVisible(['.cl-formButtonPrimary', 'button:has-text("Continue")', 'button[type="submit"]'], 5000)
    if (cont) { await cont.click(); await page.waitForTimeout(3500) }
  }
  await shot('02-after-password')

  // Turnstile (headed auto-passes); wait for either authorization or an OTP prompt
  for (let i = 0; i < 30; i++) {
    if (await authorized()) break
    const otp = await firstVisible(['input[name="codeInput-0"]', 'input[autocomplete="one-time-code"]', 'input[inputmode="numeric"]'], 1000)
    if (otp) {
      log('verification code required — waiting for', OTP_FILE)
      writeFileSync('/tmp/chm-login-status.txt', 'AWAITING_OTP\n')
      let code = null
      const deadline = Date.now() + 5 * 60 * 1000
      while (Date.now() < deadline) {
        if (existsSync(OTP_FILE)) { const c = readFileSync(OTP_FILE, 'utf8').trim().replace(/\D/g, ''); if (c.length === 6) { code = c; break } }
        await page.waitForTimeout(2000)
      }
      if (!code) throw new Error('timed out waiting for OTP')
      await otp.click().catch(() => {})
      await page.keyboard.type(code, { delay: 120 })
      await page.waitForTimeout(3500)
      const c2 = await firstVisible(['.cl-formButtonPrimary', 'button:has-text("Continue")'], 2000)
      if (c2 && await c2.isVisible().catch(() => false)) await c2.click().catch(() => {})
    }
    await page.waitForTimeout(2000)
  }

  await page.waitForTimeout(2000)
  await shot('03-final')
  const ok = await authorized()
  log(ok ? 'SIGNED IN — profile populated at ' + USERDATA : 'UNCERTAIN — check /tmp/chm-login/03-final.png')
  writeFileSync('/tmp/chm-login-status.txt', (ok ? 'SIGNED_IN' : 'UNCERTAIN') + '\n')
} catch (e) {
  log('ERROR', e.message)
  await shot('99-error')
  writeFileSync('/tmp/chm-login-status.txt', 'ERROR: ' + e.message + '\n')
} finally {
  await ctx.close()
}
